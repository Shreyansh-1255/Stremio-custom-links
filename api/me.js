// GET /api/me -> { name } when the visitor's login cookie is valid, else { name: null }.
// Lets the website log you in automatically when you open the bare URL "/".
// Each successful check also renews the 30-day session (rolling login).
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (req.method !== 'GET') return L.send(res, 405, { error: 'Method not allowed' });
  try {
    const token = L.parseCookies(req.headers.cookie)[L.COOKIE] || null;
    const name = await L.getSession(token);
    if (!name || !(await L.getUser(name))) return L.send(res, 200, { name: null });
    try { await L.cmd(['EXPIRE', 's:' + token, String(L.SESSION_TTL)]); } catch (_) {}
    res.setHeader('Set-Cookie', L.sessionCookie(token));
    return L.send(res, 200, { name });
  } catch (e) {
    L.send(res, 500, { error: e.message });
  }
};
