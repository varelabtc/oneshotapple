const db = require('../lib/db');

module.exports = async function handler(req, res) {
  await db.ensureInit();
  const after = req.query.after ? parseInt(req.query.after) : 0;
  const logs = await db.query('SELECT * FROM activity_log WHERE id > ? ORDER BY id DESC LIMIT 30', [after]);
  res.json(logs.reverse());
};
