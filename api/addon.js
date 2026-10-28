// Stremio addon protocol (no SDK). Public, read-only: /@user/manifest.json etc.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const name = L.normName(q.u);
  const route = q.r;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const poster = `https://${host}/poster.png`;
  const item = { id: 'customlinks', type: 'movie', name: 'Custom Links', poster };

  try {
    const user = await L.getUser(name);
    if (!user) return L.send(res, 404, { error: 'User not found' });
    const links = user.links || [];

    if (route === 'manifest') {
      return L.send(res, 200, {
        id: `community.custom.links.${name}`,
        version: '4.0.0',
        name: `Custom Links @${name}`,
        description: `Custom HTTP links added by @${name}.`,
        resources: [
          'catalog',
          { name: 'meta', types: ['movie'], idPrefixes: ['customlinks'] },
          { name: 'stream', types: ['movie'], idPrefixes: ['customlinks'] }
        ],
        types: ['movie'],
        catalogs: [{ type: 'movie', id: 'mylinks', name: `Custom Links @${name}` }],
        behaviorHints: { configurable: true }
      });
    }
    if (route === 'catalog') return L.send(res, 200, { metas: [item] });
    if (route === 'meta') {
      return L.send(res, 200, {
        meta: {
          ...item,
          background: poster,
          description: `${links.length} custom link${links.length === 1 ? '' : 's'}. Press play to see them.`
        }
      });
    }
    if (route === 'stream') {
      return L.send(res, 200, {
        streams: links.map(l => ({ name: 'Custom', title: l.title, url: l.url })),
        cacheMaxAge: 0
      });
    }
    L.send(res, 404, { error: 'Not found' });
  } catch (e) {
    L.send(res, 500, { error: e.message });
  }
};
