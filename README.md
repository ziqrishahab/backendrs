# HaloRS Backend API

Microservices backend untuk platform HaloRS - Reservasi Dokter Terintegrasi AI.

## Arsitektur

```
┌──────────────────────────────────────────────┐
│         API Gateway (Port 3000)               │  ← Entry Point
└──────┬──────┬──────┬──────┬──────┬───────────┘
       │      │      │      │      │
   [3001] [3002] [3003] [3004] [3005]
   Auth  Booking  AI   Notif  Admin
```

## Cara Menjalankan

### 1. Prasyarat Lokal

Pastikan layanan ini sudah terpasang dan berjalan di mesin lokal:

- PostgreSQL 16
- Redis 7
- RabbitMQ 3 (management UI optional)

### 2. Siapkan Database

Buat database `halors_db`, lalu jalankan seed SQL:

```bash
psql -U halors -d halors_db -f backend-api/database/init.sql
```

### 3. Konfigurasi Environment

Gunakan file `.env.example` pada tiap service sebagai acuan. Salin ke `.env` dan sesuaikan:

- `backend-api/api-gateway/.env.example`
- `backend-api/auth-service/.env.example`
- `backend-api/booking-service/.env.example`
- `backend-api/ai-service/.env.example`
- `backend-api/notification-service/.env.example`
- `backend-api/admin-service/.env.example`

### 4. Install Dependencies & Jalankan Services (Development)

```bash
cd backend-api
docker-compose up -d postgres redis rabbitmq
```

**Terminal 1 - Gateway:**
```bash
cd backend-api/api-gateway
npm install
npm run dev
```

**Terminal 2 - Auth Service:**
```bash
cd backend-api/auth-service
npm install
npm run dev
```

**Terminal 3 - Booking Service:**
```bash
cd backend-api/booking-service
npm install
npm run dev
```

**Terminal 4 - AI Service:**
```bash
cd backend-api/ai-service
npm install
# Set API key environment variable
# $env:OPENAI_API_KEY="sk-xxxx"  (PowerShell)
# export OPENAI_API_KEY="sk-xxxx" (Bash)
npm run dev
```

**Terminal 5 - Notification Service:**
```bash
cd backend-api/notification-service
npm install
npm run dev
```

**Terminal 6 - Admin Service:**
```bash
cd backend-api/admin-service
npm install
npm run dev
```

### 3. Akses API

- Gateway: `http://localhost:3000`
- Auth: `http://localhost:3001`
- Booking: `http://localhost:3002`
- AI: `http://localhost:3003`
- Notification: `http://localhost:3004`
- Admin: `http://localhost:3005`

## API Endpoints

### Auth
- `POST /api/v1/auth/register` - Registrasi user
- `POST /api/v1/auth/login` - Login user
- `POST /api/v1/auth/emergency` - Emergency session bypass
- `POST /api/v1/auth/admin/login` - Login admin dashboard
- `GET /api/v1/auth/profile` - Profile user (auth)
- `GET /api/v1/auth/mode` - Check auth mode setting

### Booking
- `GET /api/v1/doctors` - Daftar dokter
- `GET /api/v1/doctors/specialties` - Daftar spesialisasi
- `GET /api/v1/schedules` - Jadwal tersedia
- `GET /api/v1/schedules/check` - Cek ketersediaan
- `POST /api/v1/appointments` - Buat booking (auth)
- `GET /api/v1/appointments` - Riwayat booking (auth)
- `PUT /api/v1/appointments/:id/cancel` - Cancel booking (auth)

### AI
- `POST /api/v1/ai/chat` - Chat dengan AI (auth)
- `GET /api/v1/ai/sessions` - List chat sessions (auth)
- `GET /api/v1/ai/sessions/:id/messages` - Chat history
- `GET /api/v1/ai/config` - AI configuration

### Admin (Dashboard)
- `GET /api/v1/admin/dashboard/stats` - Statistik dashboard
- `GET /api/v1/admin/appointments` - Semua appointments
- `PUT /api/v1/admin/appointments/:id/status` - Update status
- `GET /api/v1/admin/doctors` - CRUD doctors
- `GET /api/v1/admin/settings` - Get all settings
- `PUT /api/v1/admin/settings/:key` - Update setting (superadmin)
- `GET /api/v1/admin/audit-logs` - Audit logs (superadmin)
- `GET /api/v1/admin/emergency-sessions` - Monitor emergency

### Notification
- `POST /api/v1/notifications/send` - Send push notif
- `POST /api/v1/notifications/dashboard/broadcast` - Broadcast event

## Environment Variables (per service)

```
PORT=3001|3002|3003|3004|3005
DATABASE_URL=postgresql://halors:halors_secret@localhost:5432/halors_db
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://halors:halors_secret@localhost:5672
JWT_SECRET=your_secret_key

# AI Service only:
OPENAI_API_KEY=sk-xxxx
GEMINI_API_KEY=AIxxxx
ANTHROPIC_API_KEY=sk-ant-xxxx

# Notification Service only:
FCM_SERVER_KEY=xxxx
```

## Default Credentials

| Role | Username | Password |
|------|----------|----------|
| Superadmin | superadmin | admin123 |
| CS | admincs | admin123 |

## Keputusan Arsitektur

- **Auth Mode**: 2 opsi (wajib login / emergency bypass)
- **Emergency Toggle**: ON/OFF via `emergency_mode` setting
- **AI Configurable**: OpenAI/Gemini/Anthropic via settings
- **Real-time**: Socket.io dashboard, FCM push notifications
