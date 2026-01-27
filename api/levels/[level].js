const db = require('../../lib/db');
const game = require('../../lib/gameLogic');

module.exports = async function handler(req, res) {
  await db.ensureInit();
  const level = parseInt(req.query.level);
  if (level < 1 || level > 100) return res.status(400).json({ error: 'Level 1-100' });
  const config = await game.getLevelConfig(level);
  res.json(config);
};
