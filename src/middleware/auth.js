const { verifyAccessToken } = require('../lib/jwt');

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: true, message: 'Token diperlukan' });
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    return res.status(403).json({ error: true, message: 'Token tidak valid atau kedaluwarsa' });
  }
};

const authenticateAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: true, message: 'Token diperlukan' });
  try {
    const decoded = verifyAccessToken(token);
    if (decoded.type !== 'admin') return res.status(403).json({ error: true, message: 'Akses ditolak. Hanya untuk admin.' });
    req.admin = decoded;
    next();
  } catch {
    return res.status(403).json({ error: true, message: 'Token tidak valid atau kedaluwarsa' });
  }
};

const requireSuperadmin = (req, res, next) => {
  if (req.admin.role !== 'superadmin') return res.status(403).json({ error: true, message: 'Hanya superadmin' });
  next();
};

module.exports = { authenticateToken, authenticateAdmin, requireSuperadmin };
