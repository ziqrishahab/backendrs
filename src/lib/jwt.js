const jwt = require('jsonwebtoken');

const isProd = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (isProd ? null : 'halors_jwt_secret_dev');
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET || (isProd ? null : 'halors_refresh_secret_dev');

if (!JWT_SECRET) throw new Error('JWT_SECRET is required in production');
if (!REFRESH_SECRET) throw new Error('REFRESH_TOKEN_SECRET is required in production');

const generateAccessToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
const generateRefreshToken = (payload) => jwt.sign(payload, REFRESH_SECRET, { expiresIn: '30d' });
const verifyAccessToken = (token) => jwt.verify(token, JWT_SECRET);
const verifyRefreshToken = (token) => jwt.verify(token, REFRESH_SECRET);

module.exports = { generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken, JWT_SECRET };
