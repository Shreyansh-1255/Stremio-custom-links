// Shared helpers: Upstash Redis REST client, password hashing, rate limiting.
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
  hashPassword, checkPassword, ipOf, hits, hit, validUrl
};
