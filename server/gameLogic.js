const db = require('./db');

// Config
const CONFIG = {
  FEE_PER_GAME: 1.0,           // Taxa por jogo (unidade genérica)
  PRIZE_POOL_PCT: 0.70,         // 70% vai pro prize pool
  BURN_POOL_PCT: 0.20,          // 20% vai pro burn pool
  OPERATIONAL_PCT: 0.10,        // 10% operacional
  BURN_TRIGGER: 10,             // A cada 10 completions, burn acontece
  PRIZE_1ST: 0.10,              // 10% do pool pro 1º
  PRIZE_2ND: 0.06,              // 6% pro 2º
  PRIZE_3RD: 0.04,              // 4% pro 3º
  MAX_WINNERS: 3,
  TOTAL_LEVELS: 100,
  MIN_SHOT_INTERVAL_MS: 800,    // Mínimo 800ms entre tiros (anti-cheat)
};

// Get active season
function getActiveSeason() {
  let season = db.prepare("SELECT * FROM seasons WHERE status = 'active' LIMIT 1").get();
  if (!season) {
    db.prepare("INSERT INTO seasons (status) VALUES ('active')").run();
    season = db.prepare("SELECT * FROM seasons WHERE status = 'active' LIMIT 1").get();
  }
  return season;
}

// Register player
function registerPlayer(username, walletAddress) {
  const existing = db.prepare('SELECT * FROM players WHERE username = ?').get(username);
  if (existing) return existing;
  const result = db.prepare('INSERT INTO players (username, wallet_address) VALUES (?, ?)').run(username, walletAddress || '');
  return db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
}

// Start new game session
function startGame(playerId) {
  const season = getActiveSeason();
  const crypto = require('crypto');
  const sessionHash = crypto.randomBytes(16).toString('hex');

  // Register fee
  const fee = CONFIG.FEE_PER_GAME;
  const prizeAdd = fee * CONFIG.PRIZE_POOL_PCT;
  const burnAdd = fee * CONFIG.BURN_POOL_PCT;

  const result = db.prepare(`
    INSERT INTO game_sessions (player_id, season_id, fee_paid, session_hash)
    VALUES (?, ?, ?, ?)
  `).run(playerId, season.id, fee, sessionHash);

  // Update season pools
  db.prepare(`
    UPDATE seasons SET prize_pool = prize_pool + ?, burn_pool = burn_pool + ?, total_fees = total_fees + ?
    WHERE id = ?
  `).run(prizeAdd, burnAdd, fee, season.id);

  return {
    sessionId: result.lastInsertRowid,
    sessionHash,
    seasonId: season.id,
    fee
  };
}

// Get level config with dynamic difficulty
function getLevelConfig(level) {
  const base = getBaseLevelConfig(level);
  const stats = db.prepare('SELECT * FROM global_stats WHERE level = ?').get(level);

  let difficultyMultiplier = 1.0;
  if (stats && stats.total_attempts > 10) {
    if (stats.success_rate > 0.70) {
      difficultyMultiplier = 1.1; // harder
    } else if (stats.success_rate < 0.30) {
      difficultyMultiplier = 0.9; // easier
    }
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
    successRate: stats ? stats.success_rate : 0.5
  };
}

// Base level configuration
function getBaseLevelConfig(level) {
  const t = (level - 1) / 99; // 0 to 1 progression

  return {
    targetSize: lerp(40, 12, t),
    distance: lerp(300, 600, t),
    windSpeed: lerp(0, 4, Math.max(0, (t - 0.05) / 0.95)),
    targetMovement: level >= 20,
    movementSpeed: level >= 20 ? lerp(0, 3, (Math.min(level, 100) - 20) / 80) : 0,
    hasObstacles: level >= 40,
    obstacleCount: level >= 40 ? Math.min(3, Math.floor((level - 40) / 20) + 1) : 0,
    timeLimit: level >= 60 ? lerp(8000, 3000, (level - 60) / 40) : 0,
    arrowSpeed: lerp(12, 6, t),
    windVariation: level >= 80,
  };
}

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// Submit shot result
function submitShot(sessionId, sessionHash, level, hit) {
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ? AND session_hash = ?').get(sessionId, sessionHash);
  if (!session) return { error: 'Invalid session' };
  if (session.completed) return { error: 'Session already completed' };
  if (session.current_level !== level) return { error: 'Wrong level' };

  // Anti-cheat: check time between shots
  const now = Date.now();
  if (session.last_shot_at) {
    const lastShot = new Date(session.last_shot_at).getTime();
    if (now - lastShot < CONFIG.MIN_SHOT_INTERVAL_MS) {
      return { error: 'Too fast' };
    }
  }

  // Update global stats
  db.prepare(`
    UPDATE global_stats SET
      total_attempts = total_attempts + 1,
      total_successes = total_successes + ?,
      success_rate = CAST(total_successes + ? AS REAL) / (total_attempts + 1)
    WHERE level = ?
  `).run(hit ? 1 : 0, hit ? 1 : 0, level);

  if (hit) {
    const newLevel = level + 1;
    const isComplete = level >= CONFIG.TOTAL_LEVELS;

    db.prepare(`
      UPDATE game_sessions SET
        current_level = ?,
        total_shots = total_shots + 1,
        total_hits = total_hits + 1,
        last_shot_at = datetime('now'),
        completed = ?,
        finished_at = CASE WHEN ? THEN datetime('now') ELSE NULL END
      WHERE id = ?
    `).run(isComplete ? level : newLevel, isComplete ? 1 : 0, isComplete ? 1 : 0, sessionId);

    if (isComplete) {
      return handleCompletion(session);
    }

    return { success: true, nextLevel: newLevel, gameOver: false };
  } else {
    // Miss = game over
    db.prepare(`
      UPDATE game_sessions SET
        total_shots = total_shots + 1,
        total_misses = total_misses + 1,
        last_shot_at = datetime('now'),
        finished_at = datetime('now')
      WHERE id = ?
    `).run(sessionId);

    return { success: true, gameOver: true, reason: 'miss' };
  }
}

// Handle game completion
function handleCompletion(session) {
  const season = getActiveSeason();

  // Update completions count
  db.prepare('UPDATE seasons SET total_completions = total_completions + 1 WHERE id = ?').run(season.id);

  // Check winners count
  const winnerCount = db.prepare('SELECT COUNT(*) as c FROM winners WHERE season_id = ?').get(season.id).c;

  let prize = 0;
  let position = 0;

  if (winnerCount < CONFIG.MAX_WINNERS) {
    position = winnerCount + 1;
    const pcts = [CONFIG.PRIZE_1ST, CONFIG.PRIZE_2ND, CONFIG.PRIZE_3RD];
    prize = season.prize_pool * pcts[position - 1];

    db.prepare('INSERT INTO winners (season_id, player_id, session_id, position, prize_amount) VALUES (?, ?, ?, ?, ?)')
      .run(season.id, session.player_id, session.id, position, prize);

    // If 3 winners reached, end season
    if (position === CONFIG.MAX_WINNERS) {
      endSeason(season.id);
    }
  }

  // Check burn trigger
  const updatedSeason = db.prepare('SELECT * FROM seasons WHERE id = ?').get(season.id);
  if (updatedSeason.total_completions % CONFIG.BURN_TRIGGER === 0 && updatedSeason.burn_pool > 0) {
    db.prepare('INSERT INTO burn_log (season_id, amount, trigger_completions) VALUES (?, ?, ?)')
      .run(season.id, updatedSeason.burn_pool, updatedSeason.total_completions);
    db.prepare('UPDATE seasons SET burn_pool = 0 WHERE id = ?').run(season.id);
  }

  return {
    success: true,
    gameOver: true,
    completed: true,
    position: position || null,
    prize: prize || null,
    reason: 'completed'
  };
}

// End season and start new one
function endSeason(seasonId) {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  const totalPrizes = db.prepare('SELECT SUM(prize_amount) as total FROM winners WHERE season_id = ?').get(seasonId).total || 0;
  const carryOver = season.prize_pool - totalPrizes;

  db.prepare("UPDATE seasons SET status = 'finished', finished_at = datetime('now') WHERE id = ?").run(seasonId);

  // Start new season with carry-over
  db.prepare("INSERT INTO seasons (status, prize_pool) VALUES ('active', ?)").run(Math.max(0, carryOver));
}

// Get ranking
function getRanking(seasonId) {
  const season = seasonId
    ? db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId)
    : getActiveSeason();

  const ranking = db.prepare(`
    SELECT
      gs.id as session_id,
      p.username,
      gs.current_level,
      gs.total_shots,
      gs.total_hits,
      gs.total_misses,
      gs.completed,
      gs.started_at,
      gs.finished_at,
      CASE WHEN gs.total_shots > 0 THEN ROUND(CAST(gs.total_hits AS REAL) / gs.total_shots * 100, 1) ELSE 0 END as accuracy
    FROM game_sessions gs
    JOIN players p ON p.id = gs.player_id
    WHERE gs.season_id = ?
    ORDER BY gs.current_level DESC, gs.total_hits DESC, gs.started_at ASC
    LIMIT 100
  `).all(season.id);

  const winners = db.prepare(`
    SELECT w.*, p.username FROM winners w
    JOIN players p ON p.id = w.player_id
    WHERE w.season_id = ?
    ORDER BY w.position ASC
  `).all(season.id);

  return { season, ranking, winners };
}

// Get season info
function getSeasonInfo() {
  const season = getActiveSeason();
  const winnerCount = db.prepare('SELECT COUNT(*) as c FROM winners WHERE season_id = ?').get(season.id).c;
  const totalPlayers = db.prepare('SELECT COUNT(DISTINCT player_id) as c FROM game_sessions WHERE season_id = ?').get(season.id).c;
  const totalBurned = db.prepare('SELECT SUM(amount) as total FROM burn_log WHERE season_id = ?').get(season.id).total || 0;

  return {
    ...season,
    winners_count: winnerCount,
    spots_remaining: CONFIG.MAX_WINNERS - winnerCount,
    total_players: totalPlayers,
    total_burned: totalBurned,
    fee: CONFIG.FEE_PER_GAME
  };
}

module.exports = {
  CONFIG,
  registerPlayer,
  startGame,
  getLevelConfig,
  submitShot,
  getRanking,
  getSeasonInfo,
  getActiveSeason
};
