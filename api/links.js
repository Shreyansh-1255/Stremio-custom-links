// POST /api/links {name, password, action, ...}
// action: list | add | update | delete. The password is checked on every call.
const crypto = require('crypto');
const L = require('./_lib');

const MAX_LINKS = 200;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (req.method !== 'POST') return L.send(res, 405, { error: 'Method not allowed' });

  try {
    const b = L.parseBody(req);
    const name = L.normName(b.name);
    const user = await L.getUser(name);
    if (!user) return L.send(res, 404, { error: 'User not found' });

    // limit wrong passwords: 10 per 15 minutes per user and network
    const rl = `rl:login:${name}:${L.ipOf(req)}`;
    if (await L.hits(rl) >= 10) {
      return L.send(res, 429, { error: 'Too many wrong attempts. Try again in 15 minutes.' });
    }
    if (!L.checkPassword(String(b.password || ''), user)) {
      await L.hit(rl, 900);
      return L.send(res, 401, { error: 'Wrong password' });
    }

    const links = user.links || [];
    const action = b.action;

    if (action === 'list') return L.send(res, 200, links);

    if (action === 'add' || action === 'update') {
      const title = String(b.title || '').trim().slice(0, 200);
      const url = String(b.url || '').trim().slice(0, 2000);
      if (!title) return L.send(res, 400, { error: 'Title is required' });
      if (!L.validUrl(url)) return L.send(res, 400, { error: 'Link must start with http:// or https://' });
      if (action === 'add') {
        if (links.length >= MAX_LINKS) return L.send(res, 400, { error: `Limit of ${MAX_LINKS} links reached` });
        links.push({ id: crypto.randomBytes(5).toString('hex'), title, url });
      } else {
        const item = links.find(l => l.id === b.id);
        if (!item) return L.send(res, 404, { error: 'Link not found' });
        item.title = title; item.url = url;
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
