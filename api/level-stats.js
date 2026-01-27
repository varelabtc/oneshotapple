const db = require('../lib/db');

module.exports = async function handler(req, res) {
  await db.ensureInit();
  const stats = await db.query('SELECT level, total_attempts, total_successes, success_rate FROM global_stats ORDER BY level ASC');
  res.json(stats);
};
