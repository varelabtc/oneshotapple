const db = require('../lib/db');
const game = require('../lib/gameLogic');

module.exports = async function handler(req, res) {
  await db.ensureInit();
  const seasonId = req.query.season ? parseInt(req.query.season) : null;
  const data = await game.getRanking(seasonId);
  res.json(data);
};
