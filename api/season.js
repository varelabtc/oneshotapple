const db = require('../lib/db');
const game = require('../lib/gameLogic');

module.exports = async function handler(req, res) {
  await db.ensureInit();
  const data = await game.getSeasonInfo();
  res.json(data);
};
