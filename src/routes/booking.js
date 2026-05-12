const express = require('express');
const { pool, cacheGet, cacheSet, cacheDel, generateBookingCode } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { broadcastToAdmins } = require('../lib/socket');

const router = express.Router();

// List doctors
router.get('/doctors', async (req, res) => {
  try {
    const { specialty } = req.query;
    const ck = `doctors:${specialty||'all'}`;
    const cached = await cacheGet(ck);
    if (cached) return res.json({ error: false, data: cached, cached: true });
    let q = 'SELECT id,name,specialty,room_number,is_active FROM doctors WHERE is_active=true';
    const p = [];
    if (specialty) { q += ' AND LOWER(specialty) LIKE LOWER($1)'; p.push(`%${specialty}%`); }
    q += ' ORDER BY name ASC';
    const r = await pool.query(q, p);
    await cacheSet(ck, r.rows);
    res.json({ error: false, data: r.rows });
  } catch (err) { console.error('[Booking] Doctors:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Specialties
router.get('/doctors/specialties', async (req, res) => {
  try {
    const r = await pool.query('SELECT DISTINCT specialty FROM doctors WHERE is_active=true ORDER BY specialty ASC');
    res.json({ error: false, data: r.rows.map(r=>r.specialty) });
  } catch (err) { console.error('[Booking] Specialties:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Available schedules
router.get('/schedules', async (req, res) => {
  try {
    const { doctor_id, specialty, date } = req.query;
    let q = `SELECT s.id,s.doctor_id,d.name as doctor_name,d.specialty,d.room_number,s.available_date,s.start_time,s.end_time,s.is_booked FROM schedules s JOIN doctors d ON s.doctor_id=d.id WHERE s.is_booked=false AND s.available_date>=CURRENT_DATE AND d.is_active=true`;
    const p = []; let i = 1;
    if (doctor_id) { q += ` AND s.doctor_id=$${i++}`; p.push(doctor_id); }
    if (specialty) { q += ` AND LOWER(d.specialty) LIKE LOWER($${i++})`; p.push(`%${specialty}%`); }
    if (date) { q += ` AND s.available_date=$${i++}`; p.push(date); }
    q += ' ORDER BY s.available_date ASC, s.start_time ASC';
    const r = await pool.query(q, p);
    res.json({ error: false, data: r.rows });
  } catch (err) { console.error('[Booking] Schedules:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Check availability
router.get('/schedules/check', async (req, res) => {
  try {
    const { doctor_id, date, time } = req.query;
    if (!doctor_id || !date) return res.status(400).json({ error: true, message: 'doctor_id dan date wajib' });
    let q = `SELECT s.id,s.start_time,s.end_time,s.is_booked,d.name,d.specialty FROM schedules s JOIN doctors d ON s.doctor_id=d.id WHERE s.doctor_id=$1 AND s.available_date=$2 AND d.is_active=true`;
    const p = [doctor_id, date];
    if (time) { q += ' AND s.start_time=$3'; p.push(time); }
    q += ' ORDER BY s.start_time ASC';
    const r = await pool.query(q, p);
    res.json({ error: false, data: r.rows });
  } catch (err) { console.error('[Booking] Check:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Create appointment
router.post('/appointments', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { schedule_id, patient_name, patient_phone, notes } = req.body;
    if (!schedule_id || !patient_name) return res.status(400).json({ error: true, message: 'Schedule ID dan nama pasien wajib' });
    await client.query('BEGIN');
    const sr = await client.query('SELECT s.*,d.name as doctor_name,d.specialty FROM schedules s JOIN doctors d ON s.doctor_id=d.id WHERE s.id=$1 FOR UPDATE', [schedule_id]);
    if (!sr.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: true, message: 'Jadwal tidak ditemukan' }); }
    if (sr.rows[0].is_booked) { await client.query('ROLLBACK'); return res.status(409).json({ error: true, message: 'Jadwal sudah dibooking' }); }
    if (req.user.type === 'emergency') { await client.query('ROLLBACK'); return res.status(403).json({ error: true, message: 'Sesi darurat tidak bisa booking' }); }
    const sch = sr.rows[0];
    let code, exists = true;
    while (exists) { code = generateBookingCode(); const c = await client.query('SELECT id FROM appointments WHERE booking_code=$1', [code]); exists = c.rows.length > 0; }
    const ar = await client.query('INSERT INTO appointments(user_id,schedule_id,patient_name,patient_phone,booking_code,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,patient_name,patient_phone,booking_code,status,created_at', [req.user.userId, schedule_id, patient_name, patient_phone||null, code, notes||null]);
    await client.query('UPDATE schedules SET is_booked=true WHERE id=$1', [schedule_id]);
    await client.query('COMMIT');
    const apt = ar.rows[0];
    broadcastToAdmins('booking.new', { booking_id: apt.id, patient_name, doctor_name: sch.doctor_name, specialty: sch.specialty, booking_code: code, timestamp: new Date().toISOString() });
    res.status(201).json({ error: false, message: 'Booking berhasil', data: { ...apt, doctor_name: sch.doctor_name, specialty: sch.specialty, schedule_date: sch.available_date, start_time: sch.start_time, end_time: sch.end_time } });
  } catch (err) { await client.query('ROLLBACK'); console.error('[Booking] Create:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
  finally { client.release(); }
});

// Get user appointments
router.get('/appointments', authenticateToken, async (req, res) => {
  try {
    if (req.user.type === 'emergency') return res.status(403).json({ error: true, message: 'Tidak memiliki riwayat booking' });
    const { status, limit=20, offset=0 } = req.query;
    let q = `SELECT a.id,a.patient_name,a.patient_phone,a.booking_code,a.status,a.notes,a.created_at,a.updated_at,d.name as doctor_name,d.specialty,d.room_number,s.available_date,s.start_time,s.end_time FROM appointments a JOIN schedules s ON a.schedule_id=s.id JOIN doctors d ON s.doctor_id=d.id WHERE a.user_id=$1`;
    const p = [req.user.userId]; let i = 2;
    if (status) { q += ` AND a.status=$${i++}`; p.push(status); }
    q += ' ORDER BY a.created_at DESC';
    q += ` LIMIT $${i++} OFFSET $${i++}`; p.push(parseInt(limit), parseInt(offset));
    const r = await pool.query(q, p);
    const cr = await pool.query('SELECT COUNT(*) as total FROM appointments WHERE user_id=$1', [req.user.userId]);
    res.json({ error: false, data: { appointments: r.rows, total: parseInt(cr.rows[0].total), limit: parseInt(limit), offset: parseInt(offset) } });
  } catch (err) { console.error('[Booking] Get:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
});

// Cancel appointment
router.put('/appointments/:id/cancel', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');
    const ar = await client.query('SELECT a.*,s.doctor_id FROM appointments a JOIN schedules s ON a.schedule_id=s.id WHERE a.id=$1 AND a.user_id=$2', [id, req.user.userId]);
    if (!ar.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: true, message: 'Booking tidak ditemukan' }); }
    if (ar.rows[0].status === 'cancelled') { await client.query('ROLLBACK'); return res.status(400).json({ error: true, message: 'Sudah dibatalkan' }); }
    await client.query('UPDATE appointments SET status=$1,updated_at=NOW() WHERE id=$2', ['cancelled', id]);
    await client.query('UPDATE schedules SET is_booked=false WHERE id=$1', [ar.rows[0].schedule_id]);
    await client.query('COMMIT');
    broadcastToAdmins('booking.cancelled', { appointment_id: id, booking_code: ar.rows[0].booking_code, timestamp: new Date().toISOString() });
    res.json({ error: false, message: 'Booking dibatalkan', data: { id, status: 'cancelled' } });
  } catch (err) { await client.query('ROLLBACK'); console.error('[Booking] Cancel:', err); res.status(500).json({ error: true, message: 'Internal server error' }); }
  finally { client.release(); }
});

module.exports = router;
