const { createClient } = require('@libsql/client');

let _client = null;

function getClient() {
  if (!_client) {
    const url = (process.env.TURSO_DATABASE_URL || '').trim();
    const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim();
    console.log('Turso URL:', url);
    console.log('Turso token length:', authToken.length);
    _client = createClient({ url, authToken });
  }
  return _client;
}

async function execute(sql, args) {
  const client = getClient();
  return client.execute({ sql, args: args || [] });
}

async function query(sql, args) {
  const result = await execute(sql, args);
  return result.rows;
}

async function queryOne(sql, args) {
  const rows = await query(sql, args);
  return rows.length > 0 ? rows[0] : null;
}

async function run(sql, args) {
  const result = await execute(sql, args);
  return { lastInsertRowid: Number(result.lastInsertRowid), changes: result.rowsAffected };
}

async function initDb() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, wallet_address TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT DEFAULT 'active', prize_pool REAL DEFAULT 0, burn_pool REAL DEFAULT 0, total_fees REAL DEFAULT 0, total_completions INTEGER DEFAULT 0, started_at DATETIME DEFAULT CURRENT_TIMESTAMP, finished_at DATETIME)`,
    `CREATE TABLE IF NOT EXISTS game_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL, season_id INTEGER NOT NULL, current_level INTEGER DEFAULT 1, total_shots INTEGER DEFAULT 0, total_hits INTEGER DEFAULT 0, total_misses INTEGER DEFAULT 0, started_at DATETIME DEFAULT CURRENT_TIMESTAMP, finished_at DATETIME, completed INTEGER DEFAULT 0, fee_paid REAL DEFAULT 0, session_hash TEXT, last_shot_at DATETIME)`,
    `CREATE TABLE IF NOT EXISTS winners (id INTEGER PRIMARY KEY AUTOINCREMENT, season_id INTEGER NOT NULL, player_id INTEGER NOT NULL, session_id INTEGER, position INTEGER NOT NULL, prize_amount REAL DEFAULT 0, awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS global_stats (level INTEGER PRIMARY KEY, total_attempts INTEGER DEFAULT 0, total_successes INTEGER DEFAULT 0, success_rate REAL DEFAULT 0.5)`,
    `CREATE TABLE IF NOT EXISTS burn_log (id INTEGER PRIMARY KEY AUTOINCREMENT, season_id INTEGER, amount REAL, trigger_completions INTEGER, burned_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL, username TEXT NOT NULL, message TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, player_name TEXT, level INTEGER, detail TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
  ];

  for (const sql of tables) {
    try {
      await execute(sql, []);
    } catch (e) {
      console.error('Table create error:', e.message, 'SQL:', sql.substring(0, 60));
      throw e;
    }
  }

  const statsCount = await queryOne('SELECT COUNT(*) as c FROM global_stats');
  if (!statsCount || Number(statsCount.c) === 0) {
    for (let i = 1; i <= 100; i++) {
      await run('INSERT OR IGNORE INTO global_stats (level, total_attempts, total_successes, success_rate) VALUES (?, 0, 0, 0.5)', [i]);
    }
  }

  const active = await queryOne("SELECT id FROM seasons WHERE status = 'active' LIMIT 1");
  if (!active) {
    await run("INSERT INTO seasons (status) VALUES ('active')");
  }
}

let _initialized = false;
async function ensureInit() {
  if (!_initialized) {
    await initDb();
    _initialized = true;
  }
}

module.exports = { query, queryOne, run, ensureInit };
