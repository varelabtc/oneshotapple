const db = require('../lib/db');

module.exports = async function handler(req, res) {
  await db.ensureInit();

  if (req.method === 'GET') {
    const after = req.query.after ? parseInt(req.query.after) : 0;
    const messages = await db.query('SELECT id, username, message, created_at FROM chat_messages WHERE id > ? ORDER BY id DESC LIMIT 50', [after]);
    return res.json(messages.reverse());
  }

  if (req.method === 'POST') {
    const { playerId, message } = req.body || {};
    if (!playerId || !message || message.trim().length === 0 || message.length > 200) {
      return res.status(400).json({ error: 'Invalid message' });
    }
    const player = await db.queryOne('SELECT * FROM players WHERE id = ?', [playerId]);
    if (!player) return res.status(400).json({ error: 'Player not found' });

    const result = await db.run('INSERT INTO chat_messages (player_id, username, message) VALUES (?, ?, ?)', [playerId, player.username, message.trim()]);
    return res.json({ id: result.lastInsertRowid, username: player.username, message: message.trim() });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
