// Vercel serverless entry point: every request (API and static pages alike, see vercel.json) is routed
// here. Exporting the Express app directly works because @vercel/node treats it as a (req, res) handler —
// no app.listen() needed (server.js only calls that when run directly, e.g. `node server.js`).
module.exports = require('../server');
