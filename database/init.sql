-- HaloRS Database Initialization
-- PostgreSQL 16

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role AS ENUM ('patient', 'admin', 'cs', 'doctor');
CREATE TYPE appointment_status AS ENUM ('confirmed', 'cancelled', 'completed', 'no_show');
CREATE TYPE session_type AS ENUM ('normal', 'emergency');
CREATE TYPE ai_provider AS ENUM ('openai', 'gemini', 'anthropic');
CREATE TYPE notification_type AS ENUM ('push', 'in_app', 'whatsapp');

-- ============================================================
-- TABLES: AUTH & USERS
-- ============================================================

-- Patients / Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) UNIQUE,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    role user_role DEFAULT 'patient',
    fcm_token TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Emergency sessions (anonymous / bypass)
CREATE TABLE emergency_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) NOT NULL,
    name VARCHAR(150),
    phone VARCHAR(20),
    session_token VARCHAR(500) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admin users (dashboard)
CREATE TABLE admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(150) NOT NULL,
    role user_role NOT NULL DEFAULT 'cs',
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TABLES: BOOKING
-- ============================================================

-- Doctors
CREATE TABLE doctors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    specialty VARCHAR(100) NOT NULL,
    room_number VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Schedules
CREATE TABLE schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    available_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_booked BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(doctor_id, available_date, start_time)
);

-- Appointments
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    emergency_session_id UUID REFERENCES emergency_sessions(id) ON DELETE SET NULL,
    schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    patient_name VARCHAR(150) NOT NULL,
    patient_phone VARCHAR(20),
    booking_code VARCHAR(20) UNIQUE NOT NULL,
    status appointment_status DEFAULT 'confirmed',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_source CHECK (
        (user_id IS NOT NULL AND emergency_session_id IS NULL) OR
        (user_id IS NULL AND emergency_session_id IS NOT NULL)
    )
);

-- ============================================================
-- TABLES: CHAT & AI
-- ============================================================

-- Chat sessions
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    emergency_session_id UUID REFERENCES emergency_sessions(id) ON DELETE CASCADE,
    session_type session_type DEFAULT 'normal',
    messages JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TABLES: SETTINGS & ADMIN
-- ============================================================

-- System settings (key-value configurable via dashboard)
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES admin_users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default settings seed
INSERT INTO system_settings (key, value, description) VALUES
    ('auth_mode', 'required', 'Mode autentikasi: "required" (wajib login) atau "optional" (bisa emergency bypass)'),
    ('emergency_mode', 'true', 'Aktifkan emergency bypass: "true" atau "false"'),
    ('emergency_session_duration_minutes', '30', 'Durasi sesi darurat dalam menit'),
    ('emergency_max_sessions_per_device', '1', 'Maksimal sesi darurat per device'),
    ('emergency_require_phone', 'true', 'Wajib isi nomor HP untuk sesi darurat'),
    ('ai_provider', 'openai', 'Provider AI aktif: "openai", "gemini", "anthropic"'),
    ('ai_model', 'gpt-4o', 'Nama model AI yang digunakan'),
    ('ai_temperature', '0.7', 'Temperature AI (0.0 - 1.0)'),
    ('fcm_enabled', 'false', 'Aktifkan push notification FCM'),
    ('dashboard_notif_enabled', 'true', 'Aktifkan real-time notif dashboard'),
    ('max_bookings_per_day', '50', 'Maksimal booking per hari'),
    ('app_mode', 'demo', 'Mode aplikasi: "demo" atau "production"');

-- Audit logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES admin_users(id),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id VARCHAR(100),
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_doctors_specialty ON doctors(specialty);
CREATE INDEX idx_schedules_doctor_date ON schedules(doctor_id, available_date);
CREATE INDEX idx_schedules_date ON schedules(available_date);
CREATE INDEX idx_appointments_user ON appointments(user_id);
CREATE INDEX idx_appointments_code ON appointments(booking_code);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_date ON appointments(created_at);
CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_active ON chat_sessions(is_active);
CREATE INDEX idx_emergency_sessions_device ON emergency_sessions(device_id);
CREATE INDEX idx_audit_logs_admin ON audit_logs(admin_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- ============================================================
-- SEED DATA
-- ============================================================

-- Admin user default (password: admin123)
-- Password hash generated with bcrypt
INSERT INTO admin_users (username, password_hash, name, role) VALUES
    ('superadmin', '$2b$10$qre.lNdbiDycMqI93SU9i.8lk5lqZqyoQLfnRhLNMfnk9uwU6lbHq', 'Super Admin', 'admin'),
    ('admincs', '$2b$10$qre.lNdbiDycMqI93SU9i.8lk5lqZqyoQLfnRhLNMfnk9uwU6lbHq', 'Admin CS', 'cs');

-- Sample doctors
INSERT INTO doctors (name, specialty, room_number) VALUES
    ('Dr. Budi Santoso, Sp.A', 'Pediatrician', 'Poliklinik A-01'),
    ('Dr. Siti Rahmawati, Sp.PD', 'Internist', 'Poliklinik B-02'),
    ('Dr. Andi Pratama, Sp.OG', 'Obstetrician', 'Poliklinik C-03'),
    ('Dr. Maya Dewi, Sp.M', 'Ophthalmologist', 'Poliklinik D-04'),
    ('Dr. Rudi Hartono, Sp.B', 'Surgeon', 'Poliklinik E-05');

-- Sample schedules (next 7 days)
WITH days AS (
    SELECT (CURRENT_DATE + day_offset)::DATE AS date
    FROM generate_series(0, 6) AS day_offset
),
hours AS (
    SELECT generate_series(8, 15) AS hour
)
INSERT INTO schedules (doctor_id, available_date, start_time, end_time)
SELECT
    d.id,
    days.date,
    make_time(hours.hour, 0, 0),
    make_time(hours.hour + 1, 0, 0)
FROM doctors d
CROSS JOIN days
CROSS JOIN hours
WHERE d.is_active = true
AND NOT EXISTS (
    SELECT 1 FROM schedules s2
    WHERE s2.doctor_id = d.id
    AND s2.available_date = days.date
    AND s2.start_time = make_time(hours.hour, 0, 0)
);
