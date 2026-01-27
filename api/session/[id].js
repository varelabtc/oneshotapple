const db = require('../../lib/db');

module.exports = async function handler(req, res) {
  await db.ensureInit();
  const session = await db.queryOne('SELECT * FROM game_sessions WHERE id = ?', [parseInt(req.query.id)]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
};
