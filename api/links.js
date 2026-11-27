// POST /api/links {name, action, ...}  — password only needed when the login
// cookie is missing; on success the server sets a 30-day HttpOnly session
// cookie, so page reloads never ask the password again until Logout clears
// it (or the cookie is gone).
// action: list | add | update | delete | logout
// A link is attached to a movie/series found by searching Cinemeta:
//   { imdb: 'tt0111161', type: 'movie', metaName: 'The Shawshank Redemption',
//     desc: 'The.Shawshank.Redemption.1994.720p.BluRay...mkv', url: 'https://...' }
// Old records ({ id, title, url }) stay listed on the page until they are
// edited (which attaches them) or deleted.
const crypto = require('crypto');
const L = require('./_lib');

const MAX_LINKS = 200;
const IMDB_RE = /^tt\d{5,}$/;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (req.method !== 'POST') return L.send(res, 405, { error: 'Method not allowed' });

  try {
    const b = L.parseBody(req);
    const name = L.normName(b.name);
    const user = await L.getUser(name);
    if (!user) return L.send(res, 404, { error: 'User not found' });

    // --- auth: valid session cookie first, password only as fallback ---
    const cookies = L.parseCookies(req.headers.cookie);
    let token = cookies[L.COOKIE] || null;
    const sessName = await L.getSession(token);
    let authed = !!(sessName && sessName === name);

    if (!authed) {
      token = null; // cookie was missing or belonged to another account
      const password = String(b.password || '');
      if (!password) return L.send(res, 401, { error: 'Login required' }); // a probe, not a wrong attempt: don't count it
      const rl = `rl:login:${name}:${L.ipOf(req)}`;
      if (await L.hits(rl) >= 10) {
        return L.send(res, 429, { error: 'Too many wrong attempts. Try again in 15 minutes.' });
      }
      if (!L.checkPassword(password, user)) {
        await L.hit(rl, 900);
        return L.send(res, 401, { error: 'Wrong password' });
      }
      token = await L.createSession(name); // 30-day login from now on
      res.setHeader('Set-Cookie', L.sessionCookie(token));
      authed = true;
    }

    const links = user.links || [];
    const action = b.action;

    if (action === 'logout') {
      await L.deleteSession(token);
      res.setHeader('Set-Cookie', L.clearSessionCookie());
      return L.send(res, 200, { ok: true });
    }

    if (action === 'list') return L.send(res, 200, links);

    if (action === 'add' || action === 'update') {
      const desc = String(b.desc || '').trim().slice(0, 300);
      const url = String(b.url || '').trim().slice(0, 2000);
      const imdb = String(b.imdb || '').trim().toLowerCase();
      const type = String(b.type || '').trim().toLowerCase();
      const metaName = String(b.metaName || '').trim().slice(0, 200);

      if (!IMDB_RE.test(imdb)) return L.send(res, 400, { error: 'Search the movie or series by name and select it first' });
      if (type !== 'movie' && type !== 'series') return L.send(res, 400, { error: 'Invalid title type' });
      if (!metaName) return L.send(res, 400, { error: 'Title name missing — search again and select it' });
      if (!desc) return L.send(res, 400, { error: 'Description is required' });
      if (!L.validUrl(url)) return L.send(res, 400, { error: 'Link must start with http:// or https://' });

      const record = {
        id: action === 'add' ? crypto.randomBytes(5).toString('hex') : null,
        imdb, type, name: metaName, desc, url,
        added: Date.now()
      };

      if (action === 'add') {
        if (links.length >= MAX_LINKS) return L.send(res, 400, { error: `Limit of ${MAX_LINKS} links reached` });
        links.push(record);
      } else {
        const item = links.find(l => l.id === b.id);
        if (!item) return L.send(res, 404, { error: 'Link not found' });
        record.id = item.id;
        record.added = item.added;
        links[links.indexOf(item)] = record;
      }
    } else if (action === 'delete') {
      user.links = links.filter(l => l.id !== b.id);
      await L.saveUser(name, user);
      return L.send(res, 200, user.links);
    } else {
      return L.send(res, 400, { error: 'Unknown action' });
    }

    user.links = links;
    await L.saveUser(name, user);
    L.send(res, 200, links);
  } catch (e) {
    L.send(res, 500, { error: e.message });
  }
};
