const db = require('../lib/db');
const game = require('../lib/gameLogic');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await db.ensureInit();
  } catch (e) {
    console.error('DB init error:', e);
    return res.status(500).json({ error: 'DB init failed', detail: e.message });
  }

  const { username, wallet } = req.body || {};
  if (!username || username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be 2-20 characters' });
  }
  try {
    const player = await game.registerPlayer(username.trim(), (wallet || '').trim());
    res.json({ player });
  } catch (e) {
    console.error('Register error:', e);
    try {
      const existing = await db.queryOne('SELECT * FROM players WHERE username = ?', [username.trim()]);
      if (existing) return res.json({ player: existing });
    } catch (e2) { /* ignore */ }
    res.status(500).json({ error: 'Registration failed', detail: e.message });
  }
};
