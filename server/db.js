const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'appleshot.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    wallet_address TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT DEFAULT 'active',
    prize_pool REAL DEFAULT 0,
    burn_pool REAL DEFAULT 0,
    total_fees REAL DEFAULT 0,
    total_completions INTEGER DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS game_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    season_id INTEGER NOT NULL,
    current_level INTEGER DEFAULT 1,
    total_shots INTEGER DEFAULT 0,
    total_hits INTEGER DEFAULT 0,
    total_misses INTEGER DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    completed INTEGER DEFAULT 0,
    fee_paid REAL DEFAULT 0,
    session_hash TEXT,
    last_shot_at DATETIME,
    FOREIGN KEY (player_id) REFERENCES players(id),
    FOREIGN KEY (season_id) REFERENCES seasons(id)
  );

  CREATE TABLE IF NOT EXISTS winners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    session_id INTEGER,
    position INTEGER NOT NULL,
    prize_amount REAL DEFAULT 0,
    awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (season_id) REFERENCES seasons(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
  );

  CREATE TABLE IF NOT EXISTS global_stats (
    level INTEGER PRIMARY KEY,
    total_attempts INTEGER DEFAULT 0,
    total_successes INTEGER DEFAULT 0,
    success_rate REAL DEFAULT 0.5
  );

  CREATE TABLE IF NOT EXISTS burn_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER,
    amount REAL,
    trigger_completions INTEGER,
    burned_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id)
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    player_name TEXT,
    level INTEGER,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Prize pool state (tracks current pool and distribution timing)
  CREATE TABLE IF NOT EXISTS prize_pool_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    current_amount REAL DEFAULT 0,
    last_distribution DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Tax log (records all incoming taxes)
  CREATE TABLE IF NOT EXISTS tax_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    tx_signature TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Prize distributions (records all prize payouts)
  CREATE TABLE IF NOT EXISTS prize_distributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    session_id INTEGER,
    amount REAL NOT NULL,
    wallet_address TEXT,
    tx_signature TEXT,
    distributed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id),
    FOREIGN KEY (session_id) REFERENCES game_sessions(id)
  );
`);

// Initialize global_stats for all 35 levels if empty
const statsCount = db.prepare('SELECT COUNT(*) as c FROM global_stats').get();
if (statsCount.c === 0) {
  const insert = db.prepare('INSERT INTO global_stats (level, total_attempts, total_successes, success_rate) VALUES (?, 0, 0, 0.5)');
  const insertMany = db.transaction((levels) => {
    for (const l of levels) insert.run(l);
  });
  insertMany(Array.from({ length: 35 }, (_, i) => i + 1));
}

// Initialize prize pool state if empty
const prizePoolState = db.prepare('SELECT id FROM prize_pool_state LIMIT 1').get();
if (!prizePoolState) {
  db.prepare('INSERT INTO prize_pool_state (current_amount, last_distribution) VALUES (0, datetime("now"))').run();
}

// Ensure there's an active season
const activeSeason = db.prepare("SELECT id FROM seasons WHERE status = 'active' LIMIT 1").get();
if (!activeSeason) {
  db.prepare("INSERT INTO seasons (status) VALUES ('active')").run();
}

module.exports = db;
