const db = require('./db');
const crypto = require('crypto');

const CONFIG = {
  FEE_PER_GAME: 1.0,
  PRIZE_POOL_PCT: 0.70,
  BURN_POOL_PCT: 0.20,
  OPERATIONAL_PCT: 0.10,
  BURN_TRIGGER: 10,
  PRIZE_1ST: 0.10,
  PRIZE_2ND: 0.06,
  PRIZE_3RD: 0.04,
  MAX_WINNERS: 3,
  TOTAL_LEVELS: 100,
  MIN_SHOT_INTERVAL_MS: 800,
};

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

async function getActiveSeason() {
  let season = await db.queryOne("SELECT * FROM seasons WHERE status = 'active' LIMIT 1");
  if (!season) {
    await db.run("INSERT INTO seasons (status) VALUES ('active')");
    season = await db.queryOne("SELECT * FROM seasons WHERE status = 'active' LIMIT 1");
  }
  return season;
}

async function registerPlayer(username, walletAddress) {
  const existing = await db.queryOne('SELECT * FROM players WHERE username = ?', [username]);
  if (existing) return existing;
  const result = await db.run('INSERT INTO players (username, wallet_address) VALUES (?, ?)', [username, walletAddress || '']);
  return db.queryOne('SELECT * FROM players WHERE id = ?', [result.lastInsertRowid]);
}

async function startGame(playerId) {
  const season = await getActiveSeason();
  const sessionHash = crypto.randomBytes(16).toString('hex');
  const fee = CONFIG.FEE_PER_GAME;
  const prizeAdd = fee * CONFIG.PRIZE_POOL_PCT;
  const burnAdd = fee * CONFIG.BURN_POOL_PCT;

  const result = await db.run(
    'INSERT INTO game_sessions (player_id, season_id, fee_paid, session_hash) VALUES (?, ?, ?, ?)',
    [playerId, season.id, fee, sessionHash]
  );

  await db.run(
    'UPDATE seasons SET prize_pool = prize_pool + ?, burn_pool = burn_pool + ?, total_fees = total_fees + ? WHERE id = ?',
    [prizeAdd, burnAdd, fee, season.id]
  );

  return { sessionId: result.lastInsertRowid, sessionHash, seasonId: season.id, fee };
}

function getBaseLevelConfig(level) {
  const t = (level - 1) / 99;
  return {
    targetSize: lerp(40, 12, t),
    distance: lerp(300, 600, t),
    windSpeed: lerp(0, 4, Math.max(0, (t - 0.05) / 0.95)),
    targetMovement: level >= 20,
    movementSpeed: level >= 20 ? lerp(0, 3, (Math.min(level, 100) - 20) / 80) : 0,
    hasObstacles: level >= 40,
    obstacleCount: level >= 40 ? Math.min(3, Math.floor((level - 40) / 20) + 1) : 0,
    timeLimit: level >= 60 ? lerp(8000, 3000, (level - 60) / 40) : 0,
    arrowSpeed: lerp(14, 7, t),
    windVariation: level >= 80,
  };
}

async function getLevelConfig(level) {
  const base = getBaseLevelConfig(level);
  const stats = await db.queryOne('SELECT * FROM global_stats WHERE level = ?', [level]);

  let difficultyMultiplier = 1.0;
  if (stats && Number(stats.total_attempts) > 10) {
    if (Number(stats.success_rate) > 0.70) difficultyMultiplier = 1.1;
    else if (Number(stats.success_rate) < 0.30) difficultyMultiplier = 0.9;
  }

  return {
    level,
    targetSize: Math.max(8, base.targetSize / difficultyMultiplier),
    distance: base.distance * difficultyMultiplier,
    windSpeed: base.windSpeed * difficultyMultiplier,
    targetMovement: base.targetMovement,
    movementSpeed: base.movementSpeed * difficultyMultiplier,
    hasObstacles: base.hasObstacles,
    obstacleCount: base.obstacleCount,
    timeLimit: base.timeLimit > 0 ? Math.max(2000, base.timeLimit / difficultyMultiplier) : 0,
    arrowSpeed: base.arrowSpeed / difficultyMultiplier,
    windVariation: base.windVariation,
    successRate: stats ? Number(stats.success_rate) : 0.5
  };
}

async function submitShot(sessionId, sessionHash, level, hit, livesLeft) {
  const session = await db.queryOne('SELECT * FROM game_sessions WHERE id = ? AND session_hash = ?', [sessionId, sessionHash]);
  if (!session) return { error: 'Invalid session' };
  if (Number(session.completed)) return { error: 'Session already completed' };
  if (Number(session.current_level) !== level) return { error: 'Wrong level' };

  const now = Date.now();
  if (session.last_shot_at) {
    const lastShot = new Date(session.last_shot_at).getTime();
    if (now - lastShot < CONFIG.MIN_SHOT_INTERVAL_MS) return { error: 'Too fast' };
  }

  await db.run(
    'UPDATE global_stats SET total_attempts = total_attempts + 1, total_successes = total_successes + ?, success_rate = CAST(total_successes + ? AS REAL) / (total_attempts + 1) WHERE level = ?',
    [hit ? 1 : 0, hit ? 1 : 0, level]
  );

  if (hit) {
    const newLevel = level + 1;
    const isComplete = level >= CONFIG.TOTAL_LEVELS;

    await db.run(
      'UPDATE game_sessions SET current_level = ?, total_shots = total_shots + 1, total_hits = total_hits + 1, last_shot_at = datetime(\'now\'), completed = ?, finished_at = CASE WHEN ? THEN datetime(\'now\') ELSE NULL END WHERE id = ?',
      [isComplete ? level : newLevel, isComplete ? 1 : 0, isComplete ? 1 : 0, sessionId]
    );

    if (isComplete) return handleCompletion(session);

    const playerName = await db.queryOne('SELECT username FROM players WHERE id = ?', [session.player_id]);
    if (playerName) {
      await db.run("INSERT INTO activity_log (type, player_name, level, detail) VALUES ('hit', ?, ?, 'Passed level')", [playerName.username, level]);
    }

    return { success: true, nextLevel: newLevel, gameOver: false };
  } else {
    // Miss - check if game over (no lives left) or just lost a life
    const isGameOver = (livesLeft !== undefined) ? livesLeft <= 0 : true;

    await db.run(
      "UPDATE game_sessions SET total_shots = total_shots + 1, total_misses = total_misses + 1, last_shot_at = datetime('now')" + (isGameOver ? ", finished_at = datetime('now')" : "") + " WHERE id = ?",
      [sessionId]
    );

    const playerName = await db.queryOne('SELECT username FROM players WHERE id = ?', [session.player_id]);
    if (playerName) {
      const detail = isGameOver ? 'Game over (0 lives)' : 'Lost a life (' + livesLeft + ' left)';
      await db.run("INSERT INTO activity_log (type, player_name, level, detail) VALUES ('miss', ?, ?, ?)", [playerName.username, level, detail]);
    }

    return { success: true, gameOver: isGameOver, reason: 'miss', livesLeft: livesLeft };
  }
}

async function handleCompletion(session) {
  const season = await getActiveSeason();
  await db.run('UPDATE seasons SET total_completions = total_completions + 1 WHERE id = ?', [season.id]);

  const playerName = await db.queryOne('SELECT username FROM players WHERE id = ?', [session.player_id]);
  if (playerName) {
    await db.run("INSERT INTO activity_log (type, player_name, level, detail) VALUES ('complete', ?, 100, 'Completed all 100 levels!')", [playerName.username]);
  }

  const winnerCountRow = await db.queryOne('SELECT COUNT(*) as c FROM winners WHERE season_id = ?', [season.id]);
  const winnerCount = Number(winnerCountRow.c);

  let prize = 0;
  let position = 0;

  if (winnerCount < CONFIG.MAX_WINNERS) {
    position = winnerCount + 1;
    const pcts = [CONFIG.PRIZE_1ST, CONFIG.PRIZE_2ND, CONFIG.PRIZE_3RD];
    prize = Number(season.prize_pool) * pcts[position - 1];

    await db.run('INSERT INTO winners (season_id, player_id, session_id, position, prize_amount) VALUES (?, ?, ?, ?, ?)',
      [season.id, session.player_id, session.id, position, prize]);

    if (position === CONFIG.MAX_WINNERS) await endSeason(season.id);
  }

  const updatedSeason = await db.queryOne('SELECT * FROM seasons WHERE id = ?', [season.id]);
  if (Number(updatedSeason.total_completions) % CONFIG.BURN_TRIGGER === 0 && Number(updatedSeason.burn_pool) > 0) {
    await db.run('INSERT INTO burn_log (season_id, amount, trigger_completions) VALUES (?, ?, ?)',
      [season.id, updatedSeason.burn_pool, updatedSeason.total_completions]);
    await db.run('UPDATE seasons SET burn_pool = 0 WHERE id = ?', [season.id]);
  }

  return { success: true, gameOver: true, completed: true, position: position || null, prize: prize || null, reason: 'completed' };
}

async function endSeason(seasonId) {
  const season = await db.queryOne('SELECT * FROM seasons WHERE id = ?', [seasonId]);
  const totalPrizesRow = await db.queryOne('SELECT SUM(prize_amount) as total FROM winners WHERE season_id = ?', [seasonId]);
  const totalPrizes = Number(totalPrizesRow.total) || 0;
  const carryOver = Number(season.prize_pool) - totalPrizes;

  await db.run("UPDATE seasons SET status = 'finished', finished_at = datetime('now') WHERE id = ?", [seasonId]);
  await db.run("INSERT INTO seasons (status, prize_pool) VALUES ('active', ?)", [Math.max(0, carryOver)]);
}

async function getRanking(seasonId) {
  const season = seasonId
    ? await db.queryOne('SELECT * FROM seasons WHERE id = ?', [seasonId])
    : await getActiveSeason();

  const ranking = await db.query(`
    SELECT gs.id as session_id, p.username, gs.current_level, gs.total_shots, gs.total_hits, gs.total_misses, gs.completed, gs.started_at, gs.finished_at,
      CASE WHEN gs.total_shots > 0 THEN ROUND(CAST(gs.total_hits AS REAL) / gs.total_shots * 100, 1) ELSE 0 END as accuracy
    FROM game_sessions gs JOIN players p ON p.id = gs.player_id
    WHERE gs.season_id = ?
    ORDER BY gs.current_level DESC, gs.total_hits DESC, gs.started_at ASC LIMIT 100
  `, [season.id]);

  const winners = await db.query(`
    SELECT w.*, p.username FROM winners w JOIN players p ON p.id = w.player_id
    WHERE w.season_id = ? ORDER BY w.position ASC
  `, [season.id]);

  return { season, ranking, winners };
}

async function getSeasonInfo() {
  const season = await getActiveSeason();
  const winnerCountRow = await db.queryOne('SELECT COUNT(*) as c FROM winners WHERE season_id = ?', [season.id]);
  const totalPlayersRow = await db.queryOne('SELECT COUNT(DISTINCT player_id) as c FROM game_sessions WHERE season_id = ?', [season.id]);
  const totalBurnedRow = await db.queryOne('SELECT SUM(amount) as total FROM burn_log WHERE season_id = ?', [season.id]);

  return {
    ...season,
    winners_count: Number(winnerCountRow.c),
    spots_remaining: CONFIG.MAX_WINNERS - Number(winnerCountRow.c),
    total_players: Number(totalPlayersRow.c),
    total_burned: Number(totalBurnedRow.total) || 0,
    fee: CONFIG.FEE_PER_GAME
  };
}

module.exports = { CONFIG, registerPlayer, startGame, getLevelConfig, submitShot, getRanking, getSeasonInfo, getActiveSeason };
