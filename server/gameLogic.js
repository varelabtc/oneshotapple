const db = require('./db');

// ============================================
// APPLE SHOT - NEW TOKENOMICS v2
// ============================================
// - 35 levels total
// - Prize pool = 15min accumulated taxes
// - First place gets 100% of 15min pool
// - All games reset when pool distributes
// - Solana/PumpFun integration
// ============================================

const CONFIG = {
  TOTAL_LEVELS: 35,
  MIN_SHOT_INTERVAL_MS: 800,

  // Prize distribution timing
  PRIZE_INTERVAL_MS: 15 * 60 * 1000, // 15 minutes

  // Solana config (will be set via env)
  DEV_WALLET: process.env.DEV_WALLET || '',
  SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',

  // Tax tracking
  TAX_PERCENTAGE: 0.05, // 5% of each token transaction goes to prize pool
};

// Prize pool state (in-memory, synced with DB)
let currentPrizePool = 0;
let lastDistributionTime = Date.now();
let nextDistributionTime = Date.now() + CONFIG.PRIZE_INTERVAL_MS;

// Initialize prize pool from DB
function initPrizePool() {
  const state = db.prepare('SELECT * FROM prize_pool_state ORDER BY id DESC LIMIT 1').get();
  if (state) {
    currentPrizePool = state.current_amount;
    lastDistributionTime = new Date(state.last_distribution).getTime();
    nextDistributionTime = lastDistributionTime + CONFIG.PRIZE_INTERVAL_MS;
  } else {
    db.prepare('INSERT INTO prize_pool_state (current_amount, last_distribution) VALUES (0, datetime("now"))').run();
  }
}

// Get time remaining until next distribution (in ms)
function getTimeToNextDistribution() {
  const now = Date.now();
  const remaining = nextDistributionTime - now;
  return Math.max(0, remaining);
}

// Get prize pool info
function getPrizePoolInfo() {
  return {
    currentPool: currentPrizePool,
    nextDistributionIn: getTimeToNextDistribution(),
    nextDistributionAt: nextDistributionTime,
    lastDistributionAt: lastDistributionTime
  };
}

// Add taxes to prize pool (called when taxes are detected)
function addTaxesToPool(amount) {
  currentPrizePool += amount;
  db.prepare('UPDATE prize_pool_state SET current_amount = ? WHERE id = (SELECT MAX(id) FROM prize_pool_state)').run(currentPrizePool);

  // Log the tax addition
  db.prepare('INSERT INTO tax_log (amount, timestamp) VALUES (?, datetime("now"))').run(amount);

  return currentPrizePool;
}

// Distribute prize pool to first place winner
function distributePrizePool() {
  const now = Date.now();

  // Get current leader (highest level completed, fastest time)
  const leader = db.prepare(`
    SELECT
      gs.id as session_id,
      gs.player_id,
      p.username,
      p.wallet_address,
      gs.current_level,
      gs.finished_at,
      gs.started_at
    FROM game_sessions gs
    JOIN players p ON p.id = gs.player_id
    WHERE gs.started_at >= datetime(?, 'unixepoch')
    AND gs.current_level = (
      SELECT MAX(current_level) FROM game_sessions
      WHERE started_at >= datetime(?, 'unixepoch')
    )
    ORDER BY gs.current_level DESC,
             (julianday(gs.finished_at) - julianday(gs.started_at)) ASC
    LIMIT 1
  `).get(lastDistributionTime / 1000, lastDistributionTime / 1000);

  const prizeAmount = currentPrizePool;
  let winner = null;

  if (leader && prizeAmount > 0) {
    winner = {
      username: leader.username,
      wallet: leader.wallet_address,
      level: leader.current_level,
      prize: prizeAmount
    };

    // Record the distribution
    db.prepare(`
      INSERT INTO prize_distributions
      (player_id, session_id, amount, wallet_address, distributed_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(leader.player_id, leader.session_id, prizeAmount, leader.wallet_address);

    // Log activity
    db.prepare(`
      INSERT INTO activity_log (type, player_name, level, detail)
      VALUES ('prize', ?, ?, ?)
    `).run(leader.username, leader.current_level, `Won ${prizeAmount.toFixed(4)} SOL prize pool!`);
  }

  // Reset pool and update times
  currentPrizePool = 0;
  lastDistributionTime = now;
  nextDistributionTime = now + CONFIG.PRIZE_INTERVAL_MS;

  db.prepare(`
    INSERT INTO prize_pool_state (current_amount, last_distribution)
    VALUES (0, datetime('now'))
  `).run();

  return { winner, prizeAmount, nextDistributionAt: nextDistributionTime };
}

// Check if it's time to distribute
function checkDistribution() {
  if (Date.now() >= nextDistributionTime) {
    return distributePrizePool();
  }
  return null;
}

// Get active season (simplified - now just tracks overall stats)
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
  if (existing) {
    // Update wallet if provided
    if (walletAddress && walletAddress !== existing.wallet_address) {
      db.prepare('UPDATE players SET wallet_address = ? WHERE id = ?').run(walletAddress, existing.id);
      existing.wallet_address = walletAddress;
    }
    return existing;
  }
  const result = db.prepare('INSERT INTO players (username, wallet_address) VALUES (?, ?)').run(username, walletAddress || '');
  return db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
}

// Start new game session (FREE - no fee)
function startGame(playerId) {
  const season = getActiveSeason();
  const crypto = require('crypto');
  const sessionHash = crypto.randomBytes(16).toString('hex');

  const result = db.prepare(`
    INSERT INTO game_sessions (player_id, season_id, fee_paid, session_hash)
    VALUES (?, ?, 0, ?)
  `).run(playerId, season.id, sessionHash);

  // Check if distribution is due
  const distribution = checkDistribution();

  return {
    sessionId: result.lastInsertRowid,
    sessionHash,
    seasonId: season.id,
    prizePool: getPrizePoolInfo(),
    distribution
  };
}

// ============================================
// DIFFICULTY SYSTEM - 35 LEVELS
// ============================================
// Harder at the start, balanced progression
// No gradual ramp - immediate challenge
// ============================================

function getBaseLevelConfig(level) {
  // Normalize to 0-1 (level 1 = 0, level 35 = 1)
  const t = (level - 1) / 34;

  // Difficulty curve - starts hard, gets progressively harder
  // Using exponential curve for steeper initial difficulty
  const difficultyFactor = Math.pow(t, 0.7); // 0.7 = harder early game

  // Target size: starts at 32px, ends at 10px (smaller = harder)
  const targetSize = lerp(32, 10, difficultyFactor);

  // Distance: starts at 350px, ends at 550px (farther = harder)
  const distance = lerp(350, 550, difficultyFactor);

  // Wind: starts at level 3, increases
  const hasWind = level >= 3;
  const windSpeed = hasWind ? lerp(0.5, 4.5, Math.max(0, (level - 3) / 32)) : 0;

  // Target movement: starts at level 8
  const hasMovement = level >= 8;
  const movementSpeed = hasMovement ? lerp(0.8, 3.5, (level - 8) / 27) : 0;

  // Obstacles: starts at level 15
  const hasObstacles = level >= 15;
  const obstacleCount = hasObstacles ? Math.min(3, Math.floor((level - 15) / 7) + 1) : 0;

  // Time limit: starts at level 22
  const hasTimeLimit = level >= 22;
  const timeLimit = hasTimeLimit ? lerp(10000, 4000, (level - 22) / 13) : 0;

  // Arrow speed: starts fast, gets slower (harder to aim)
  const arrowSpeed = lerp(13, 7, difficultyFactor);

  // Wind variation (changes mid-flight): level 28+
  const windVariation = level >= 28;

  // Moving obstacles: level 30+
  const movingObstacles = level >= 30;

  return {
    level,
    targetSize: Math.round(targetSize),
    distance: Math.round(distance),
    windSpeed: Math.round(windSpeed * 100) / 100,
    hasWind,
    targetMovement: hasMovement,
    movementSpeed: Math.round(movementSpeed * 100) / 100,
    hasObstacles,
    obstacleCount,
    timeLimit: hasTimeLimit ? Math.round(timeLimit) : 0,
    arrowSpeed: Math.round(arrowSpeed * 100) / 100,
    windVariation,
    movingObstacles
  };
}

// Get level config with dynamic difficulty adjustment
function getLevelConfig(level) {
  if (level < 1 || level > CONFIG.TOTAL_LEVELS) {
    return { error: 'Invalid level' };
  }

  const base = getBaseLevelConfig(level);
  const stats = db.prepare('SELECT * FROM global_stats WHERE level = ?').get(level);

  // Dynamic adjustment based on global success rate
  let difficultyMultiplier = 1.0;
  if (stats && stats.total_attempts > 20) {
    if (stats.success_rate > 0.65) {
      difficultyMultiplier = 1.15; // Make harder
    } else if (stats.success_rate < 0.25) {
      difficultyMultiplier = 0.85; // Make easier
    }
  }

  return {
    ...base,
    targetSize: Math.max(8, Math.round(base.targetSize / difficultyMultiplier)),
    distance: Math.round(base.distance * difficultyMultiplier),
    windSpeed: Math.round(base.windSpeed * difficultyMultiplier * 100) / 100,
    movementSpeed: Math.round(base.movementSpeed * difficultyMultiplier * 100) / 100,
    timeLimit: base.timeLimit > 0 ? Math.max(3000, Math.round(base.timeLimit / difficultyMultiplier)) : 0,
    arrowSpeed: Math.round(base.arrowSpeed / difficultyMultiplier * 100) / 100,
    successRate: stats ? stats.success_rate : 0.5,
    totalAttempts: stats ? stats.total_attempts : 0
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
  const existingStats = db.prepare('SELECT * FROM global_stats WHERE level = ?').get(level);
  if (existingStats) {
    db.prepare(`
      UPDATE global_stats SET
        total_attempts = total_attempts + 1,
        total_successes = total_successes + ?,
        success_rate = CAST(total_successes + ? AS REAL) / (total_attempts + 1)
      WHERE level = ?
    `).run(hit ? 1 : 0, hit ? 1 : 0, level);
  } else {
    db.prepare(`
      INSERT INTO global_stats (level, total_attempts, total_successes, success_rate)
      VALUES (?, 1, ?, ?)
    `).run(level, hit ? 1 : 0, hit ? 1.0 : 0.0);
  }

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

    // Log activity
    const playerName = db.prepare('SELECT username FROM players WHERE id = ?').get(session.player_id);
    if (playerName) {
      if (isComplete) {
        db.prepare("INSERT INTO activity_log (type, player_name, level, detail) VALUES ('complete', ?, ?, 'Completed all 35 levels!')").run(playerName.username, level);
      } else {
        db.prepare("INSERT INTO activity_log (type, player_name, level, detail) VALUES ('hit', ?, ?, 'Passed level')").run(playerName.username, level);
      }
    }

    // Check distribution
    const distribution = checkDistribution();

    return {
      success: true,
      nextLevel: isComplete ? null : newLevel,
      gameOver: isComplete,
      completed: isComplete,
      prizePool: getPrizePoolInfo(),
      distribution
    };
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

    // Log activity
    const playerName = db.prepare('SELECT username FROM players WHERE id = ?').get(session.player_id);
    if (playerName) {
      db.prepare("INSERT INTO activity_log (type, player_name, level, detail) VALUES ('miss', ?, ?, 'Game over')").run(playerName.username, level);
    }

    return {
      success: true,
      gameOver: true,
      reason: 'miss',
      prizePool: getPrizePoolInfo()
    };
  }
}

// Get ranking (current 30-min period)
function getRanking() {
  const ranking = db.prepare(`
    SELECT
      gs.id as session_id,
      p.username,
      p.wallet_address,
      gs.current_level,
      gs.total_shots,
      gs.total_hits,
      gs.completed,
      gs.started_at,
      gs.finished_at,
      CASE WHEN gs.total_shots > 0 THEN ROUND(CAST(gs.total_hits AS REAL) / gs.total_shots * 100, 1) ELSE 0 END as accuracy,
      CASE WHEN gs.finished_at IS NOT NULL
        THEN ROUND((julianday(gs.finished_at) - julianday(gs.started_at)) * 86400, 1)
        ELSE NULL
      END as time_seconds
    FROM game_sessions gs
    JOIN players p ON p.id = gs.player_id
    WHERE gs.started_at >= datetime(?, 'unixepoch')
    ORDER BY gs.current_level DESC, gs.completed DESC, time_seconds ASC
    LIMIT 50
  `).all(lastDistributionTime / 1000);

  return {
    ranking,
    prizePool: getPrizePoolInfo(),
    periodStart: lastDistributionTime,
    periodEnd: nextDistributionTime
  };
}

// Get all-time stats
function getAllTimeStats() {
  const topPlayers = db.prepare(`
    SELECT
      p.username,
      COUNT(gs.id) as total_games,
      MAX(gs.current_level) as best_level,
      SUM(gs.completed) as total_completions,
      ROUND(AVG(CAST(gs.total_hits AS REAL) / NULLIF(gs.total_shots, 0) * 100), 1) as avg_accuracy
    FROM players p
    JOIN game_sessions gs ON gs.player_id = p.id
    GROUP BY p.id
    ORDER BY best_level DESC, total_completions DESC
    LIMIT 20
  `).all();

  const recentDistributions = db.prepare(`
    SELECT pd.*, p.username
    FROM prize_distributions pd
    JOIN players p ON p.id = pd.player_id
    ORDER BY pd.distributed_at DESC
    LIMIT 10
  `).all();

  return { topPlayers, recentDistributions };
}

// Get season info (for compatibility)
function getSeasonInfo() {
  const season = getActiveSeason();
  const totalPlayers = db.prepare('SELECT COUNT(DISTINCT player_id) as c FROM game_sessions WHERE season_id = ?').get(season.id).c;

  return {
    ...season,
    total_players: totalPlayers,
    prizePool: getPrizePoolInfo(),
    totalLevels: CONFIG.TOTAL_LEVELS
  };
}

// Initialize on module load
try {
  initPrizePool();
} catch (e) {
  console.log('Prize pool init will happen after DB setup');
}

module.exports = {
  CONFIG,
  registerPlayer,
  startGame,
  getLevelConfig,
  submitShot,
  getRanking,
  getSeasonInfo,
  getActiveSeason,
  getPrizePoolInfo,
  addTaxesToPool,
  checkDistribution,
  distributePrizePool,
  getAllTimeStats,
  initPrizePool
};
