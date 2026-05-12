const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { pool, getSystemSetting } = require('../config/database');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../lib/jwt');
const { authenticateToken } = require('../middleware/auth');
const { schemas, validate } = require('../lib/validation');

const router = express.Router();

router.post('/register', validate(schemas.userRegister), async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(409).json({ error: true, message: 'Email sudah terdaftar' });
    const hash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    const r = await pool.query('INSERT INTO users(name,email,password_hash,phone) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,created_at', [name, email, hash, phone||null]);
    const user = r.rows[0];
    const p = { userId: user.id, role: user.role, type: 'user' };
    const at = generateAccessToken(p), rt = generateRefreshToken(p);
    await pool.query('INSERT INTO refresh_tokens(user_id,token,expires_at) VALUES($1,$2,NOW() + INTERVAL \'30 days\')', [user.id, rt]);
    res.status(201).json({ error: false, message: 'Registrasi berhasil', data: { user, access_token: at, refresh_token: rt } });
  } catch (err) { console.error('[Auth] Register:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.post('/login', validate(schemas.userLogin), async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await pool.query('SELECT id,name,email,password_hash,phone,role,is_active FROM users WHERE email=$1', [email]);
    if (!r.rows.length) return res.status(401).json({ error: true, message: 'Email atau password salah' });
    const user = r.rows[0];
    if (!user.is_active) return res.status(403).json({ error: true, message: 'Akun dinonaktifkan' });
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: true, message: 'Email atau password salah' });
    const p = { userId: user.id, role: user.role, type: 'user' };
    const at = generateAccessToken(p), rt = generateRefreshToken(p);
    await pool.query('INSERT INTO refresh_tokens(user_id,token,expires_at) VALUES($1,$2,NOW() + INTERVAL \'30 days\')', [user.id, rt]);
    delete user.password_hash;
    res.json({ error: false, message: 'Login berhasil', data: { user, access_token: at, refresh_token: rt } });
  } catch (err) { console.error('[Auth] Login:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: true, message: 'Refresh token wajib diisi' });
    let decoded;
    try { decoded = verifyRefreshToken(refresh_token); } catch { return res.status(401).json({ error: true, message: 'Refresh token tidak valid' }); }
    if (decoded.type !== 'user') return res.status(403).json({ error: true, message: 'Refresh token hanya untuk user' });
    const tr = await pool.query('SELECT id,is_revoked FROM refresh_tokens WHERE token=$1 AND expires_at>NOW()', [refresh_token]);
    if (!tr.rows.length || tr.rows[0].is_revoked) return res.status(401).json({ error: true, message: 'Refresh token tidak valid' });
    await pool.query('UPDATE refresh_tokens SET is_revoked=true WHERE id=$1', [tr.rows[0].id]);
    const p = { userId: decoded.userId, role: decoded.role, type: decoded.type };
    const at = generateAccessToken(p), rt = generateRefreshToken(p);
    await pool.query('INSERT INTO refresh_tokens(user_id,token,expires_at) VALUES($1,$2,NOW() + INTERVAL \'30 days\')', [decoded.userId, rt]);
    res.json({ error: false, data: { access_token: at, refresh_token: rt } });
  } catch (err) { console.error('[Auth] Refresh:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.post('/logout', async (req, res) => {
  try { if (req.body.refresh_token) await pool.query('UPDATE refresh_tokens SET is_revoked=true WHERE token=$1', [req.body.refresh_token]); res.json({ error: false, message: 'Logout berhasil' }); }
  catch (err) { console.error('[Auth] Logout:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT id,name,phone,email,role,address,fcm_token,is_active,created_at FROM users WHERE id=$1', [req.user.userId]);
    if (!r.rows.length) return res.status(404).json({ error: true, message: 'User tidak ditemukan' });
    res.json({ error: false, data: r.rows[0] });
  } catch (err) { console.error('[Auth] Profile:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.put('/profile', authenticateToken, validate(schemas.updateProfile), async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    if (phone) {
      const ck = await pool.query('SELECT id FROM users WHERE phone=$1 AND id!=$2', [phone, req.user.userId]);
      if (ck.rows.length) return res.status(409).json({ error: true, message: 'Nomor telepon sudah digunakan' });
    }
    const fields = [], vals = []; let i = 1;
    if (name !== undefined) { fields.push(`name=$${i++}`); vals.push(name); }
    if (phone !== undefined) { fields.push(`phone=$${i++}`); vals.push(phone); }
    if (address !== undefined) { fields.push(`address=$${i++}`); vals.push(address); }
    vals.push(req.user.userId);
    const r = await pool.query(`UPDATE users SET ${fields.join(',')} WHERE id=$${i} RETURNING id,name,phone,email,role,address,created_at`, vals);
    res.json({ error: false, message: 'Profil berhasil diupdate', data: r.rows[0] });
  } catch (err) { console.error('[Auth] Update profile:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.post('/forgot-password', validate(schemas.forgotPassword), async (req, res) => {
  try {
    const { email } = req.body;
    const u = await pool.query('SELECT id,name FROM users WHERE email=$1 AND is_active=true', [email]);
    if (u.rows.length) {
      const token = uuidv4();
      await pool.query("INSERT INTO password_reset_tokens(user_id,token,expires_at) VALUES($1,$2,NOW() + INTERVAL '1 hour') ON CONFLICT(user_id) DO UPDATE SET token=$2,expires_at=NOW()+INTERVAL '1 hour',used=false", [u.rows[0].id, token]);
      console.log(`[Auth] Reset link: /reset-password?token=${token}`);
    }
    res.json({ error: false, message: 'Jika email terdaftar, link reset password akan dikirim' });
  } catch (err) { console.error('[Auth] Forgot password:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.post('/reset-password', validate(schemas.resetPassword), async (req, res) => {
  try {
    const { token, new_password } = req.body;
    const tr = await pool.query('SELECT user_id FROM password_reset_tokens WHERE token=$1 AND used=false AND expires_at>NOW()', [token]);
    if (!tr.rows.length) return res.status(400).json({ error: true, message: 'Token tidak valid atau expired' });
    const hash = await bcrypt.hash(new_password, await bcrypt.genSalt(10));
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, tr.rows[0].user_id]);
    await pool.query('UPDATE password_reset_tokens SET used=true WHERE token=$1', [token]);
    await pool.query('UPDATE refresh_tokens SET is_revoked=true WHERE user_id=$1', [tr.rows[0].user_id]);
    res.json({ error: false, message: 'Password berhasil direset. Silakan login.' });
  } catch (err) { console.error('[Auth] Reset password:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.put('/change-password', authenticateToken, validate(schemas.changePassword), async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const u = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.userId]);
    if (!await bcrypt.compare(current_password, u.rows[0].password_hash)) return res.status(400).json({ error: true, message: 'Password saat ini salah' });
    const hash = await bcrypt.hash(new_password, await bcrypt.genSalt(10));
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.userId]);
    res.json({ error: false, message: 'Password berhasil diubah' });
  } catch (err) { console.error('[Auth] Change password:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: true, message: 'Username dan password wajib diisi' });
    const r = await pool.query('SELECT id,username,password_hash,name,role,is_active FROM admin_users WHERE username=$1', [username]);
    if (!r.rows.length) return res.status(401).json({ error: true, message: 'Username atau password salah' });
    const admin = r.rows[0];
    if (!admin.is_active) return res.status(403).json({ error: true, message: 'Akun dinonaktifkan' });
    if (!await bcrypt.compare(password, admin.password_hash)) return res.status(401).json({ error: true, message: 'Username atau password salah' });
    await pool.query('UPDATE admin_users SET last_login=NOW() WHERE id=$1', [admin.id]);
    const p = { userId: admin.id, role: admin.role, type: 'admin' };
    const at = generateAccessToken(p);
    res.json({ error: false, message: 'Login berhasil', data: { admin: { id: admin.id, username: admin.username, name: admin.name, role: admin.role }, access_token: at } });
  } catch (err) { console.error('[Auth] Admin login:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.post('/emergency', async (req, res) => {
  try {
    const mode = await getSystemSetting('emergency_mode');
    if (mode !== 'true') return res.status(403).json({ error: true, message: 'Fitur darurat tidak aktif' });
    const { device_id, name, phone } = req.body;
    if (!device_id) return res.status(400).json({ error: true, message: 'Device ID wajib diisi' });
    const max = parseInt(await getSystemSetting('emergency_max_sessions_per_device') || '1');
    const cnt = await pool.query('SELECT COUNT(*) as c FROM emergency_sessions WHERE device_id=$1 AND is_active=true AND expires_at>NOW()', [device_id]);
    if (parseInt(cnt.rows[0].c) >= max) return res.status(429).json({ error: true, message: `Maksimal ${max} sesi per device` });
    const dur = parseInt(await getSystemSetting('emergency_session_duration_minutes') || '30');
    const eAt = new Date(Date.now() + dur * 60000);
    const sid = uuidv4();
    const jwt = require('jsonwebtoken');
    const st = jwt.sign({ sessionId: sid, deviceId: device_id, type: 'emergency' }, process.env.JWT_SECRET || 'halors_jwt_secret_dev', { expiresIn: `${dur}m` });
    await pool.query('INSERT INTO emergency_sessions(id,device_id,name,phone,session_token,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [sid, device_id, name||null, phone||null, st, eAt]);
    res.status(201).json({ error: false, message: 'Sesi darurat dibuat', data: { session_id: sid, token: st, expires_at: eAt.toISOString(), limits: { can_book: false, can_chat: true, duration_minutes: dur } } });
  } catch (err) { console.error('[Auth] Emergency:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

module.exports = router;
