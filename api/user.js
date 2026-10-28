// GET  /api/user?name=x           -> { exists }
// POST /api/user {name, password} -> creates the account
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  try {
    if (req.method === 'GET') {
      const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      const name = L.normName(q.name);
      if (!L.NAME_RE.test(name)) return L.send(res, 400, { error: 'Invalid username' });
      return L.send(res, 200, { exists: !!(await L.getUser(name)) });
    }

    if (req.method === 'POST') {
      const b = L.parseBody(req);
      const name = L.normName(b.name);
      const password = String(b.password || '');
      if (!L.NAME_RE.test(name)) return L.send(res, 400, { error: 'Username must be 3-20 letters, numbers or underscores' });
      if (password.length < 6 || password.length > 100) return L.send(res, 400, { error: 'Password must be 6-100 characters' });

      // limit account creation: 5 per IP per hour
      if (await L.hit(`rl:create:${L.ipOf(req)}`, 3600) > 5) {
        return L.send(res, 429, { error: 'Too many accounts created from this network. Try again later.' });
      }
      const ok = await L.createUser(name, { ...L.hashPassword(password), links: [], created: Date.now() });
      if (!ok) return L.send(res, 409, { error: 'That username is taken' });
      return L.send(res, 200, { ok: true });
    }

    L.send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    L.send(res, 500, { error: e.message });
  }
};
