const express = require('express');
const { pool, logAudit } = require('../config/database');
const { authenticateAdmin, requireSuperadmin } = require('../middleware/auth');

const router = express.Router();

// Dashboard stats
router.get('/dashboard/stats', authenticateAdmin, async (req, res) => {
  try {
    const [t,c,td,doc,em] = await Promise.all([
      pool.query("SELECT COUNT(*) as t FROM appointments WHERE created_at>=CURRENT_DATE"),
      pool.query("SELECT COUNT(*) as t FROM appointments WHERE status='confirmed'"),
      pool.query("SELECT COUNT(*) as t FROM appointments WHERE created_at>=CURRENT_DATE AND status='confirmed'"),
      pool.query("SELECT COUNT(*) as t FROM doctors WHERE is_active=true"),
      pool.query("SELECT COUNT(*) as t FROM emergency_sessions WHERE is_active=true AND expires_at>NOW()"),
    ]);
    res.json({ error: false, data: { total_appointments_today: parseInt(t.rows[0].t), total_confirmed: parseInt(c.rows[0].t), today_booking: parseInt(td.rows[0].t), total_doctors: parseInt(doc.rows[0].t), active_emergency_sessions: parseInt(em.rows[0].t) } });
  } catch (err) { console.error('[Admin] Stats:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Appointments list
router.get('/appointments', authenticateAdmin, async (req, res) => {
  try {
    const { status, date, limit=50, offset=0 } = req.query;
    let q = `SELECT a.id,a.patient_name,a.patient_phone,a.booking_code,a.status,a.notes,a.created_at,a.updated_at,d.name,d.specialty,d.room_number,s.available_date,s.start_time,s.end_time FROM appointments a JOIN schedules s ON a.schedule_id=s.id JOIN doctors d ON s.doctor_id=d.id WHERE 1=1`;
    const p = []; let i = 1;
    if (status) { q += ` AND a.status=$${i++}`; p.push(status); }
    if (date) { q += ` AND s.available_date=$${i++}`; p.push(date); }
    q += ' ORDER BY a.created_at DESC';
    q += ` LIMIT $${i++} OFFSET $${i++}`; p.push(parseInt(limit), parseInt(offset));
    const r = await pool.query(q, p);
    const cr = await pool.query('SELECT COUNT(*) as t FROM appointments');
    res.json({ error: false, data: { appointments: r.rows, total: parseInt(cr.rows[0].t), limit: parseInt(limit), offset: parseInt(offset) } });
  } catch (err) { console.error('[Admin] Appts:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Update appointment status
router.put('/appointments/:id/status', authenticateAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params; const { status } = req.body;
    if (!['confirmed','cancelled','completed','no_show'].includes(status)) return res.status(400).json({ error: true, message: 'Status tidak valid' });
    await client.query('BEGIN');
    const ar = await client.query('SELECT a.*,s.id as sid FROM appointments a JOIN schedules s ON a.schedule_id=s.id WHERE a.id=$1', [id]);
    if (!ar.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: true, message: 'Tidak ditemukan' }); }
    await client.query('UPDATE appointments SET status=$1,updated_at=NOW() WHERE id=$2', [status, id]);
    if (['cancelled','completed'].includes(status)) await client.query('UPDATE schedules SET is_booked=false WHERE id=$1', [ar.rows[0].sid]);
    await client.query('COMMIT');
    await logAudit(req.admin.userId, `appointment_${status}`, 'appointment', id, { booking_code: ar.rows[0].booking_code }, req.ip);
    res.json({ error: false, message: `Status diubah ke ${status}`, data: { id, status } });
  } catch (err) { await client.query('ROLLBACK'); console.error('[Admin] Update status:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
  finally { client.release(); }
});

// Approve appointment
router.post('/appointments/:id/approve', authenticateAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    const ar = await client.query('SELECT * FROM appointments WHERE id=$1 FOR UPDATE', [id]);
    if (!ar.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: true, message: 'Tidak ditemukan' }); }
    if (ar.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ error: true, message: 'Hanya pending yang bisa diapprove' }); }
    await client.query('UPDATE appointments SET status=$1,updated_at=NOW() WHERE id=$2', ['confirmed', id]);
    await client.query('COMMIT');
    await logAudit(req.admin.userId, 'appointment_approved', 'appointment', id, { booking_code: ar.rows[0].booking_code }, req.ip);
    res.json({ error: false, message: 'Appointment approved', data: { id, status: 'confirmed' } });
  } catch (err) { await client.query('ROLLBACK'); console.error('[Admin] Approve:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
  finally { client.release(); }
});

// Doctors CRUD
router.get('/doctors', authenticateAdmin, async (req, res) => {
  try { const r = await pool.query('SELECT id,name,specialty,room_number,is_active,created_at,updated_at FROM doctors ORDER BY name ASC'); res.json({ error: false, data: r.rows }); }
  catch (err) { console.error('[Admin] Get doctors:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.post('/doctors', authenticateAdmin, requireSuperadmin, async (req, res) => {
  try {
    const { name, specialty, room_number } = req.body;
    if (!name || !specialty) return res.status(400).json({ error: true, message: 'Nama dan spesialisasi wajib' });
    const r = await pool.query('INSERT INTO doctors(name,specialty,room_number) VALUES($1,$2,$3) RETURNING id,name,specialty,room_number,is_active,created_at', [name, specialty, room_number||null]);
    await logAudit(req.admin.userId, 'doctor_created', 'doctor', r.rows[0].id, { name, specialty }, req.ip);
    res.status(201).json({ error: false, data: r.rows[0] });
  } catch (err) { console.error('[Admin] Create doctor:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.put('/doctors/:id', authenticateAdmin, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params; const { name, specialty, room_number, is_active } = req.body;
    const r = await pool.query('UPDATE doctors SET name=COALESCE($1,name),specialty=COALESCE($2,specialty),room_number=COALESCE($3,room_number),is_active=COALESCE($4,is_active),updated_at=NOW() WHERE id=$5 RETURNING id,name,specialty,room_number,is_active,updated_at', [name, specialty, room_number, is_active, id]);
    if (!r.rows.length) return res.status(404).json({ error: true, message: 'Tidak ditemukan' });
    await logAudit(req.admin.userId, 'doctor_updated', 'doctor', id, { name, specialty }, req.ip);
    res.json({ error: false, data: r.rows[0] });
  } catch (err) { console.error('[Admin] Update doctor:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.delete('/doctors/:id', authenticateAdmin, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query('DELETE FROM doctors WHERE id=$1 RETURNING id,name', [id]);
    if (!r.rows.length) return res.status(404).json({ error: true, message: 'Tidak ditemukan' });
    await logAudit(req.admin.userId, 'doctor_deleted', 'doctor', id, { name: r.rows[0].name }, req.ip);
    res.json({ error: false, message: 'Dokter dihapus', data: r.rows[0] });
  } catch (err) { console.error('[Admin] Delete doctor:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Schedules
router.get('/schedules', authenticateAdmin, async (req, res) => {
  try {
    const { date, doctor_id } = req.query;
    let q = 'SELECT s.*,d.name as doctor_name,d.specialty FROM schedules s JOIN doctors d ON s.doctor_id=d.id WHERE 1=1';
    const p = []; let i = 1;
    if (date) { q += ` AND s.available_date=$${i++}`; p.push(date); }
    if (doctor_id) { q += ` AND s.doctor_id=$${i++}`; p.push(doctor_id); }
    q += ' ORDER BY s.available_date ASC, d.name ASC, s.start_time ASC';
    const r = await pool.query(q, p);
    res.json({ error: false, data: r.rows });
  } catch (err) { console.error('[Admin] Schedules:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.post('/schedules', authenticateAdmin, requireSuperadmin, async (req, res) => {
  try {
    const { doctor_id, available_date, start_time, end_time } = req.body;
    if (!doctor_id || !available_date || !start_time) return res.status(400).json({ error: true, message: 'doctor_id, date, start_time wajib' });
    const r = await pool.query('INSERT INTO schedules(doctor_id,available_date,start_time,end_time) VALUES($1,$2,$3,$4) RETURNING *', [doctor_id, available_date, start_time, end_time||null]);
    await logAudit(req.admin.userId, 'schedule_created', 'schedule', r.rows[0].id, { doctor_id, available_date }, req.ip);
    res.status(201).json({ error: false, data: r.rows[0] });
  } catch (err) { console.error('[Admin] Create schedule:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.put('/schedules/:id', authenticateAdmin, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params; const { available_date, start_time, end_time, is_booked } = req.body;
    const r = await pool.query('UPDATE schedules SET available_date=COALESCE($1,available_date),start_time=COALESCE($2,start_time),end_time=COALESCE($3,end_time),is_booked=COALESCE($4,is_booked) WHERE id=$5 RETURNING *', [available_date, start_time, end_time, is_booked, id]);
    if (!r.rows.length) return res.status(404).json({ error: true, message: 'Tidak ditemukan' });
    await logAudit(req.admin.userId, 'schedule_updated', 'schedule', id, { available_date }, req.ip);
    res.json({ error: false, data: r.rows[0] });
  } catch (err) { console.error('[Admin] Update schedule:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.delete('/schedules/:id', authenticateAdmin, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query('DELETE FROM schedules WHERE id=$1 RETURNING id', [id]);
    if (!r.rows.length) return res.status(404).json({ error: true, message: 'Tidak ditemukan' });
    res.json({ error: false, message: 'Jadwal dihapus' });
  } catch (err) { console.error('[Admin] Delete schedule:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Settings
router.get('/settings', authenticateAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT key,value,description,updated_at FROM system_settings ORDER BY key ASC');
    const s = {}; r.rows.forEach(row => { s[row.key] = { value: row.value, description: row.description, updated_at: row.updated_at }; });
    res.json({ error: false, data: s });
  } catch (err) { console.error('[Admin] Settings:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

router.put('/settings/:key', authenticateAdmin, requireSuperadmin, async (req, res) => {
  try {
    const { key } = req.params; const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: true, message: 'Value wajib' });
    const valid = ['auth_mode','emergency_mode','emergency_session_duration_minutes','emergency_max_sessions_per_device','emergency_require_phone','ai_provider','ai_model','ai_temperature','fcm_enabled','dashboard_notif_enabled','max_bookings_per_day','app_mode'];
    if (!valid.includes(key)) return res.status(400).json({ error: true, message: 'Key tidak valid' });
    const r = await pool.query('UPDATE system_settings SET value=$1,updated_by=$2,updated_at=NOW() WHERE key=$3 RETURNING key,value', [String(value), req.admin.userId, key]);
    if (!r.rows.length) return res.status(404).json({ error: true, message: 'Tidak ditemukan' });
    await logAudit(req.admin.userId, 'setting_updated', 'system_setting', key, { key, value }, req.ip);
    res.json({ error: false, data: r.rows[0] });
  } catch (err) { console.error('[Admin] Update setting:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Audit logs
router.get('/audit-logs', authenticateAdmin, requireSuperadmin, async (req, res) => {
  try {
    const { limit=50, offset=0 } = req.query;
    const r = await pool.query('SELECT al.id,al.action,al.target_type,al.target_id,al.details,al.ip_address,al.created_at,au.name as admin_name,au.username FROM audit_logs al LEFT JOIN admin_users au ON al.admin_id=au.id ORDER BY al.created_at DESC LIMIT $1 OFFSET $2', [parseInt(limit), parseInt(offset)]);
    const cr = await pool.query('SELECT COUNT(*) as t FROM audit_logs');
    res.json({ error: false, data: { logs: r.rows, total: parseInt(cr.rows[0].t), limit: parseInt(limit), offset: parseInt(offset) } });
  } catch (err) { console.error('[Admin] Audit logs:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Admin users
router.get('/users', authenticateAdmin, requireSuperadmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT id,username,name,role,is_active,last_login,created_at FROM admin_users ORDER BY created_at ASC');
    res.json({ error: false, data: r.rows });
  } catch (err) { console.error('[Admin] Admin users:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Emergency sessions
router.get('/emergency-sessions', authenticateAdmin, async (req, res) => {
  try {
    const r = await pool.query('SELECT id,device_id,name,phone,expires_at,is_active,created_at FROM emergency_sessions WHERE is_active=true AND expires_at>NOW() ORDER BY created_at DESC LIMIT 20');
    const cr = await pool.query('SELECT COUNT(*) as t FROM emergency_sessions WHERE is_active=true AND expires_at>NOW()');
    res.json({ error: false, data: { sessions: r.rows, total_active: parseInt(cr.rows[0].t) } });
  } catch (err) { console.error('[Admin] Emergency:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

module.exports = router;
