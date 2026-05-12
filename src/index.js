// ============================================================
// HaloRS - Monolithic Backend Server
// Gabungan: Auth + Admin + Booking + AI + Notification
// Struktur modular: src/{config,lib,middleware,routes,services}
// ============================================================

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { initSocket } = require('./lib/socket');
const { pool } = require('./config/database');

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

initSocket(httpServer);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`); next(); });

// Routes (support both /api/ and /api/v1/ prefix)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/booking', require('./routes/booking'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/ai', require('./routes/ai'));

// Health check
app.get('/api/health', (req, res) => res.json({ error: false, message: 'HaloRS API is running', uptime: process.uptime() }));
app.get('/api/v1/health', (req, res) => res.json({ error: false, message: 'HaloRS API is running', uptime: process.uptime() }));

// 404
app.use((req, res) => res.status(404).json({ error: true, message: 'Endpoint tidak ditemukan' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ error: true, message: 'Internal server error' });
});

httpServer.listen(PORT, () => console.log(`\n🚀 HaloRS Server running on http://localhost:${PORT}\n`));

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await pool.end();
  process.exit(0);
});
