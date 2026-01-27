const db = require('../lib/db');
const game = require('../lib/gameLogic');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  await db.ensureInit();

  const { username, wallet } = req.body || {};
  if (!username || username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be 2-20 characters' });
  }
  try {
    const player = await game.registerPlayer(username.trim(), (wallet || '').trim());
    res.json({ player });
  } catch (e) {
    const existing = await db.queryOne('SELECT * FROM players WHERE username = ?', [username.trim()]);
    if (existing) return res.json({ player: existing });
    res.status(500).json({ error: 'Registration failed' });
  }
};
