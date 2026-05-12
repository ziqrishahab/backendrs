const { Pool } = require('pg');
const Redis = require('ioredis');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://halors:halors_secret@localhost:3900/halors_db',
  max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 2000,
});
pool.on('error', (err) => console.error('[DB] Idle client error', err));

let redis = null;
try {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 3, retryStrategy(t){ return t>3?null:Math.min(t*200,2000); }, lazyConnect: true });
  redis.on('error', ()=>{});
} catch{ console.log('[Redis] Not available'); }

const cacheGet = async (k) => redis ? redis.get(k).then(v=>v?JSON.parse(v):null).catch(()=>null) : null;
const cacheSet = async (k,v,ttl=300) => redis ? redis.set(k,JSON.stringify(v),'EX',ttl).catch(()=>{}) : void 0;
const cacheDel = async (p) => redis ? redis.keys(p).then(k=>k.length?redis.del(...k):0).catch(()=>{}) : void 0;

const getSystemSetting = async (key) => {
  const r = await pool.query('SELECT value FROM system_settings WHERE key=$1',[key]);
  return r.rows[0]?.value ?? null;
};

const logAudit = async (adminId, action, targetType, targetId, details, ip) => {
  try{ await pool.query('INSERT INTO audit_logs(admin_id,action,target_type,target_id,details,ip_address) VALUES($1,$2,$3,$4,$5,$6)', [adminId,action,targetType,String(targetId),details?JSON.stringify(details):null,ip]); }
  catch(err){ console.error('[Audit]', err.message); }
};

const generateBookingCode = () => {
  const prefix='RS', ts=Date.now().toString(36).toUpperCase().slice(-4), r=Math.random().toString(36).substring(2,6).toUpperCase();
  return `${prefix}-${ts}${r}`;
};

module.exports = { pool, cacheGet, cacheSet, cacheDel, getSystemSetting, logAudit, generateBookingCode };
