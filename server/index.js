const express = require('express');
const path = require('path');
const game = require('./gameLogic');
const solana = require('./solana');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Initialize Solana monitoring
solana.startMonitoring();
solana.startDistributionChecker();

// --- API Routes ---

// Register player
app.post('/api/register', (req, res) => {
  const { username, wallet } = req.body;
  if (!username || username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be 2-20 characters' });
  }
  try {
    const player = game.registerPlayer(username.trim(), (wallet || '').trim());
    res.json({ player });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      const existing = require('./db').prepare('SELECT * FROM players WHERE username = ?').get(username.trim());
      return res.json({ player: existing });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Start game (pay fee)
app.post('/api/start-game', (req, res) => {
  const { playerId } = req.body;
  if (!playerId) return res.status(400).json({ error: 'Player ID required' });
  try {
    const session = game.startGame(playerId);
    res.json(session);
  } catch (e) {
    res.status(500).json({ error: 'Failed to start game' });
  }
});

// Submit shot
app.post('/api/submit-shot', (req, res) => {
  const { sessionId, sessionHash, level, hit } = req.body;
  if (!sessionId || !sessionHash || !level) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  try {
    const result = game.submitShot(sessionId, sessionHash, level, !!hit);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Shot submission failed' });
  }
});

// Get level config
app.get('/api/levels/:level', (req, res) => {
  const level = parseInt(req.params.level);
  if (level < 1 || level > 35) return res.status(400).json({ error: 'Level 1-35' });
  res.json(game.getLevelConfig(level));
});

// Get prize pool info
app.get('/api/prize-pool', (req, res) => {
  res.json(game.getPrizePoolInfo());
});

// Get all-time stats
app.get('/api/all-time-stats', (req, res) => {
  res.json(game.getAllTimeStats());
});

// Get Solana monitoring status
app.get('/api/solana-status', (req, res) => {
  res.json(solana.getStatus());
});

// Get ranking
app.get('/api/ranking', (req, res) => {
  const seasonId = req.query.season ? parseInt(req.query.season) : null;
  res.json(game.getRanking(seasonId));
});

// Get season info
app.get('/api/season', (req, res) => {
  res.json(game.getSeasonInfo());
});

// Session info
app.get('/api/session/:id', (req, res) => {
  const db = require('./db');
  const session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(parseInt(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// Get level stats (win rates)
app.get('/api/level-stats', (req, res) => {
  const db = require('./db');
  const stats = db.prepare('SELECT level, total_attempts, total_successes, success_rate FROM global_stats ORDER BY level ASC').all();
  res.json(stats);
});

// Chat - get messages
app.get('/api/chat', (req, res) => {
  const db = require('./db');
  const after = req.query.after ? parseInt(req.query.after) : 0;
  const messages = db.prepare('SELECT id, username, message, created_at FROM chat_messages WHERE id > ? ORDER BY id DESC LIMIT 50').all(after);
  res.json(messages.reverse());
});

// Chat - send message
app.post('/api/chat', (req, res) => {
  const db = require('./db');
  const { playerId, message } = req.body;
  if (!playerId || !message || message.trim().length === 0 || message.length > 200) {
    return res.status(400).json({ error: 'Invalid message' });
  }
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(400).json({ error: 'Player not found' });

  const result = db.prepare('INSERT INTO chat_messages (player_id, username, message) VALUES (?, ?, ?)').run(playerId, player.username, message.trim());
  res.json({ id: result.lastInsertRowid, username: player.username, message: message.trim() });
});

// Activity log
app.get('/api/activity', (req, res) => {
  const db = require('./db');
  const after = req.query.after ? parseInt(req.query.after) : 0;
  const logs = db.prepare('SELECT * FROM activity_log WHERE id > ? ORDER BY id DESC LIMIT 30').all(after);
  res.json(logs.reverse());
});

const PORT = 3010;
app.listen(PORT, () => {
  console.log(`Apple Shot running on http://localhost:${PORT}`);
});
