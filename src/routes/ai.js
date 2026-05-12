const express = require('express');
const { pool, getSystemSetting } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const providers = {
  openai: {
    async chat(msgs, model, temp) {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY tidak dikonfigurasi');
      const { data } = await require('axios').post('https://api.openai.com/v1/chat/completions', { model: model||'gpt-4o', messages: msgs, temperature: parseFloat(temp)||0.7 }, { headers: { Authorization: `Bearer ${key}` }, timeout: 30000 });
      return data.choices[0].message.content;
    }
  },
  gemini: {
    async chat(msgs, model, temp) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error('GEMINI_API_KEY tidak dikonfigurasi');
      const contents = []; let system = '';
      for (const m of msgs) { if (m.role === 'system') system = m.content; else contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }); }
      const { data } = await require('axios').post(`https://generativelanguage.googleapis.com/v1beta/models/${model||'gemini-2.0-flash'}:generateContent?key=${key}`, { contents, systemInstruction: system ? { parts: [{ text: system }] } : undefined, generationConfig: { temperature: parseFloat(temp)||0.7 } }, { timeout: 30000 });
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    }
  },
  anthropic: {
    async chat(msgs, model, temp) {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('ANTHROPIC_API_KEY tidak dikonfigurasi');
      const sys = msgs.find(m => m.role === 'system')?.content || '';
      const cm = msgs.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
      const { data } = await require('axios').post('https://api.anthropic.com/v1/messages', { model: model||'claude-3-5-sonnet-20241022', system: sys, messages: cm, max_tokens: 1024, temperature: parseFloat(temp)||0.7 }, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeout: 30000 });
      return data.content?.[0]?.text || '{}';
    }
  }
};

const executeFn = async (action, userId) => {
  if (!action?.function) return null;
  const { function: fn, params } = action;
  try {
    switch (fn) {
      case 'check_availability': {
        const { specialty, date } = params||{};
        let q = `SELECT s.id,s.doctor_id,d.name,d.specialty,d.room_number,s.available_date,s.start_time,s.end_time FROM schedules s JOIN doctors d ON s.doctor_id=d.id WHERE s.is_booked=false AND s.available_date>=CURRENT_DATE AND d.is_active=true`;
        const p = []; let i=1;
        if (specialty) { q += ` AND LOWER(d.specialty) LIKE LOWER($${i++})`; p.push(`%${specialty}%`); }
        if (date) { q += ` AND s.available_date=$${i++}`; p.push(date); }
        q += ' ORDER BY s.available_date ASC, s.start_time ASC LIMIT 10';
        const r = await pool.query(q, p); return { success: true, data: r.rows };
      }
      case 'get_doctors_by_specialty': {
        const { specialty } = params||{};
        const r = await pool.query('SELECT id,name,specialty,room_number FROM doctors WHERE is_active=true AND LOWER(specialty) LIKE LOWER($1)', [`%${specialty}%`]);
        return { success: true, data: r.rows };
      }
      case 'get_available_slots': {
        const { doctor_id, date } = params||{};
        const r = await pool.query('SELECT s.id,s.start_time,s.end_time,d.name,d.specialty FROM schedules s JOIN doctors d ON s.doctor_id=d.id WHERE s.doctor_id=$1 AND s.available_date=$2 AND s.is_booked=false ORDER BY s.start_time ASC', [doctor_id, date]);
        return { success: true, data: r.rows };
      }
      case 'get_my_appointments': {
        if (!userId) return { success: false, error: 'User not identified' };
        const r = await pool.query('SELECT a.*,d.name,d.specialty,d.room_number,s.available_date,s.start_time,s.end_time FROM appointments a JOIN schedules s ON a.schedule_id=s.id JOIN doctors d ON s.doctor_id=d.id WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 10', [userId]);
        return { success: true, data: r.rows };
      }
      default: return { success: false, error: `Unknown function: ${fn}` };
    }
  } catch (err) { return { success: false, error: err.message }; }
};

router.post('/chat', authenticateToken, async (req, res) => {
  try {
    const { message, session_id } = req.body;
    if (!message) return res.status(400).json({ error: true, message: 'Pesan wajib diisi' });

    const provider = await getSystemSetting('ai_provider') || 'openai';
    const model = await getSystemSetting('ai_model') || 'gpt-4o';
    const temperature = await getSystemSetting('ai_temperature') || '0.7';

    let session;
    if (session_id) {
      const sr = await pool.query('SELECT id,messages FROM chat_sessions WHERE id=$1 AND is_active=true', [session_id]);
      if (sr.rows.length) session = sr.rows[0];
    }
    if (!session) {
      const sr = await pool.query('INSERT INTO chat_sessions(user_id,messages,session_type) VALUES($1,$2,$3) RETURNING id,messages', [req.user.type === 'emergency' ? null : req.user.userId, '[]', req.user.type === 'emergency' ? 'emergency' : 'normal']);
      session = sr.rows[0];
    }

    const history = session.messages || [];
    const impl = providers[provider];
    if (!impl) return res.status(400).json({ error: true, message: `Provider ${provider} tidak didukung` });

    const systemPrompt = `Kamu asisten AI HaloRS. Bantu user dengan info RS, jadwal dokter, booking.
Gunakan bahasa Indonesia ramah.

Function calls:
- check_availability(specialty, date)
- get_doctors_by_specialty(specialty)
- get_available_slots(doctor_id, date)
- get_my_appointments()

Format: [FUNCTION_CALL]\n{"function":"...","params":{...}}`;

    const msgs = [{ role: 'system', content: systemPrompt }, ...history.slice(-10), { role: 'user', content: message }];
    let response = await impl.chat(msgs, model, temperature);

    let iter = 3;
    while (response.includes('[FUNCTION_CALL]') && iter > 0) {
      const m = response.match(/\[FUNCTION_CALL\]\s*(\{[\s\S]*?\})/);
      if (!m) break;
      const action = JSON.parse(m[1]);
      const result = await executeFn(action, req.user.type === 'user' ? req.user.userId : null);
      msgs.push({ role: 'assistant', content: response }, { role: 'user', content: `Function result: ${JSON.stringify(result)}` });
      response = await impl.chat(msgs, model, temperature);
      iter--;
    }

    const updated = [...history, { role: 'user', content: message }, { role: 'assistant', content: response }];
    await pool.query('UPDATE chat_sessions SET messages=$1,updated_at=NOW() WHERE id=$2', [JSON.stringify(updated), session.id]);
    res.json({ error: false, data: { session_id: session.id, message: response } });
  } catch (err) { console.error('[AI] Chat:', err); res.status(500).json({ error: true, message: err.message || 'Internal server error' }); }
});

module.exports = router;
