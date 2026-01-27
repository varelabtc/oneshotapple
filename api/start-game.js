const db = require('../lib/db');
const game = require('../lib/gameLogic');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  await db.ensureInit();

  const { playerId } = req.body || {};
  if (!playerId) return res.status(400).json({ error: 'Player ID required' });
  try {
    const session = await game.startGame(playerId);
    res.json(session);
  } catch (e) {
    res.status(500).json({ error: 'Failed to start game' });
  }
};
