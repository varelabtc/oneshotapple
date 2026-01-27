const db = require('../lib/db');
const game = require('../lib/gameLogic');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  await db.ensureInit();

  const { sessionId, sessionHash, level, hit, livesLeft } = req.body || {};
  if (!sessionId || !sessionHash || !level) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  try {
    const result = await game.submitShot(sessionId, sessionHash, level, !!hit, livesLeft);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Shot submission failed' });
  }
};
