// Shared helpers: Upstash Redis REST client, password hashing, rate limiting,
// login sessions (HttpOnly cookie, 30 days).
const crypto = require('crypto');

const DB_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
const DB_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;

async function cmd(args) {
  if (!DB_URL || !DB_TOKEN) throw new Error('Database is not configured');
  const r = await fetch(DB_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'Database error');
  return j.result;
}

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b;
}

const NAME_RE = /^[a-z0-9_]{3,20}$/;
const normName = n => String(n || '').trim().toLowerCase().replace(/^@/, '');

async function getUser(name) {
  if (!NAME_RE.test(name)) return null;
  const raw = await cmd(['GET', 'u:' + name]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function saveUser(name, user) {
  await cmd(['SET', 'u:' + name, JSON.stringify(user)]);
}
async function createUser(name, user) {
  return (await cmd(['SET', 'u:' + name, JSON.stringify(user), 'NX'])) === 'OK';
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return { salt: salt.toString('hex'), hash: crypto.scryptSync(pw, salt, 32).toString('hex') };
}
function checkPassword(pw, user) {
  try {
    const h = crypto.scryptSync(pw, Buffer.from(user.salt, 'hex'), 32);
    const e = Buffer.from(user.hash, 'hex');
    return h.length === e.length && crypto.timingSafeEqual(h, e);
  } catch { return false; }
}

/* ---------- login sessions (cookie) ---------- */
const COOKIE = 'sid';
const SESSION_TTL = 30 * 24 * 3600; // 30 days

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); } }
  });
  return out;
}

// A session is a random 64-hex token stored in Redis (s:<token> -> username).
async function createSession(name) {
  const token = crypto.randomBytes(32).toString('hex');
  await cmd(['SET', 's:' + token, name, 'EX', String(SESSION_TTL)]);
  return token;
}
// Returns the username the token belongs to, or null.
async function getSession(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return (await cmd(['GET', 's:' + token])) || null;
}
async function deleteSession(token) {
  if (!token) return;
  try { await cmd(['DEL', 's:' + token]); } catch (_) {}
}

const sessionCookie = token => `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Lax`;
const clearSessionCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

function ipOf(req) {
  return String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown')
    .split(',')[0].trim();
}
async function hits(key) { return Number(await cmd(['GET', key])) || 0; }
async function hit(key, seconds) {
  const n = await cmd(['INCR', key]);
  if (n === 1) await cmd(['EXPIRE', key, seconds]);
  return n;
}

function validUrl(u) {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; }
  catch { return false; }
}

module.exports = {
  cmd, send, parseBody, NAME_RE, normName, getUser, saveUser, createUser,
  hashPassword, checkPassword, ipOf, hits, hit, validUrl,
  COOKIE, SESSION_TTL, parseCookies, createSession, getSession, deleteSession,
  sessionCookie, clearSessionCookie
};
