// ============================================================
// HaloRS Seed Script - Dummy Data
// Jalankan: node scripts/seed.js
// ============================================================
const { pool } = require('../src/config/database');
const bcrypt = require('bcrypt');

async function seed() {
  console.log('🌱 Seeding HaloRS database...\n');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── 1. Admin Users ──
    const adminHash = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO admin_users (username, name, password_hash, role, is_active)
      VALUES
        ('superadmin', 'Super Admin', $1, 'admin', true),
        ('admin', 'Admin HaloRS', $1, 'admin', true),
        ('dr.admin', 'Dr. Andi Admin', $1, 'admin', true)
      ON CONFLICT (username) DO NOTHING
    `, [adminHash]);
    console.log('  ✅ Admin: superadmin / admin123');
    console.log('  ✅ Admin: admin / admin123');
    console.log('  ✅ Admin: dr.admin / admin123');

    // ── 2. Regular Users ──
    const userHash = await bcrypt.hash('user1234', 10);
    await client.query(`
      INSERT INTO users (name, email, password_hash, phone, address)
      VALUES
        ('Budi Santoso', 'budi@email.com', $1, '081234567890', 'Jl. Merdeka No. 1, Jakarta'),
        ('Siti Rahayu', 'siti@email.com', $1, '081234567891', 'Jl. Sudirman No. 5, Bandung'),
        ('Ahmad Hidayat', 'ahmad@email.com', $1, '081234567892', 'Jl. Gatot Subroto No. 10, Surabaya'),
        ('Dewi Lestari', 'dewi@email.com', $1, '081234567893', 'Jl. Thamrin No. 3, Medan'),
        ('Rudi Hermawan', 'rudi@email.com', $1, '081234567894', 'Jl. Diponegoro No. 7, Yogyakarta')
      ON CONFLICT (email) DO NOTHING
    `, [userHash]);
    console.log('  ✅ Users: budi@email.com / user1234');
    console.log('  ✅ Users: siti@email.com / user1234');
    console.log('  ✅ Users: ahmad@email.com / user1234');
    console.log('  ✅ Users: dewi@email.com / user1234');
    console.log('  ✅ Users: rudi@email.com / user1234');

    // ── 3. Doctors ──
    await client.query(`
      INSERT INTO doctors (name, specialty, room_number, is_active)
      VALUES
        ('Dr. Andi Pratama, Sp.PD', 'Penyakit Dalam', 'A101', true),
        ('Dr. Budi Wijaya, Sp.A', 'Anak', 'B202', true),
        ('Dr. Citra Dewi, Sp.OG', 'Kandungan', 'C303', true),
        ('Dr. Dwi Hartono, Sp.B', 'Bedah Umum', 'D404', true),
        ('Dr. Eka Putri, Sp.M', 'Mata', 'E505', true),
        ('Dr. Fajar Nugroho, Sp.JP', 'Jantung', 'F606', true),
        ('Dr. Gita Permata, Sp.S', 'Syaraf', 'G707', true),
        ('Dr. Hendra Gunawan, Sp.OT', 'Orthopedi', 'H808', true)
      ON CONFLICT DO NOTHING
    `);
    console.log('  ✅ Doctors: 8 dokter');

    // ── 4. Schedules (next 7 days) ──
    const times = [
      { start: '08:00', end: '09:00' },
      { start: '09:00', end: '10:00' },
      { start: '10:00', end: '11:00' },
      { start: '11:00', end: '12:00' },
      { start: '13:00', end: '14:00' },
      { start: '14:00', end: '15:00' },
      { start: '15:00', end: '16:00' },
    ];

    for (let day = 0; day < 7; day++) {
      const date = new Date();
      date.setDate(date.getDate() + day);
      const dateStr = date.toISOString().split('T')[0];
      const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat

      const dr = await client.query('SELECT id FROM doctors WHERE is_active=true');
      for (const doc of dr.rows) {
        // Skip Sunday (day 0)
        if (dayOfWeek === 0) continue;
        // Half day on Saturday
        const slots = dayOfWeek === 6 ? times.slice(0, 4) : times;
        for (const t of slots) {
          await client.query(
            'INSERT INTO schedules (doctor_id, available_date, start_time, end_time) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [doc.id, dateStr, t.start, t.end]
          );
        }
      }
    }
    const scheduleCount = await client.query('SELECT COUNT(*) as c FROM schedules');
    console.log(`  ✅ Schedules: ${scheduleCount.rows[0].c} slot tersedia`);

    // ── 5. System Settings ──
    await client.query(`
      INSERT INTO system_settings (key, value, description) VALUES
        ('auth_mode', 'normal', 'Mode autentikasi: normal/emergency'),
        ('emergency_mode', 'false', 'Mode darurat aktif/nonaktif'),
        ('emergency_session_duration_minutes', '30', 'Durasi sesi darurat'),
        ('emergency_max_sessions_per_device', '1', 'Maks sesi darurat per device'),
        ('emergency_require_phone', 'true', 'Wajib nomor telepon untuk darurat'),
        ('ai_provider', 'openai', 'Provider AI: openai/gemini/anthropic'),
        ('ai_model', 'gpt-4o', 'Model AI default'),
        ('ai_temperature', '0.7', 'Suhu AI'),
        ('fcm_enabled', 'false', 'FCM notification enabled'),
        ('dashboard_notif_enabled', 'true', 'Dashboard notifikasi realtime'),
        ('max_bookings_per_day', '50', 'Maks booking per hari'),
        ('app_mode', 'production', 'Mode aplikasi')
      ON CONFLICT (key) DO NOTHING
    `);
    console.log('  ✅ System settings: 12 setting');

    await client.query('COMMIT');
    console.log('\n🎉 Seeding selesai!');
    console.log('\n📋 Akun Login:');
    console.log('   ┌──────────────────────┬──────────────┬──────────┐');
    console.log('   │ Email/Username        │ Password     │ Tipe     │');
    console.log('   ├──────────────────────┼──────────────┼──────────┤');
    console.log('   │ superadmin            │ admin123     │ Admin    │');
    console.log('   │ admin                 │ admin123     │ Admin    │');
    console.log('   │ dr.admin              │ admin123     │ Admin    │');
    console.log('   ├──────────────────────┼──────────────┼──────────┤');
    console.log('   │ budi@email.com        │ user1234     │ User     │');
    console.log('   │ siti@email.com        │ user1234     │ User     │');
    console.log('   │ ahmad@email.com       │ user1234     │ User     │');
    console.log('   │ dewi@email.com        │ user1234     │ User     │');
    console.log('   │ rudi@email.com        │ user1234     │ User     │');
    console.log('   └──────────────────────┴──────────────┴──────────┘');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed gagal:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
