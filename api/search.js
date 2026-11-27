// GET /api/search?q=<name>&type=all|movie|series
// Searches Cinemeta by movie/series name so the website can attach a link to
// a real title. Even one character is searched; results are cached in Redis
// for 10 minutes. No rate limit.
const L = require('./_lib');

const TTL = 600;

async function cinemeta(type, query) {
  const url = 'https://v3-cinemeta.strem.io/catalog/' + type + '/top/search=' + encodeURIComponent(query) + '.json';
  const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error('Cinemeta HTTP ' + r.status);
  const j = await r.json();
  return Array.isArray(j.metas) ? j.metas : [];
}

function pick(metas) {
  return metas
    .filter(m => m && /^tt\d+$/.test(String(m.imdb_id || '')))
    .slice(0, 10)
    .map(m => ({
      imdb: String(m.imdb_id).toLowerCase(),
      type: m.type === 'series' ? 'series' : 'movie',
      name: String(m.name || '').slice(0, 200),
      year: String(m.releaseInfo || '').slice(0, 30),
      poster: String(m.poster || '')
    }));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  try {
    if (req.method !== 'GET') return L.send(res, 405, { error: 'Method not allowed' });
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const query = String(q.q || '').trim().slice(0, 100);
    const type = (q.type === 'movie' || q.type === 'series') ? q.type : 'all';
    if (!query) return L.send(res, 200, { results: [] });

    const cacheKey = `search:${type}:${query.toLowerCase()}`;
    try {
      const cached = await L.cmd(['GET', cacheKey]);
      if (cached) return L.send(res, 200, { results: JSON.parse(cached) });
    } catch (_) { /* fall through to a live search */ }

    const types = type === 'all' ? ['movie', 'series'] : [type];
    const metas = await Promise.all(types.map(t => cinemeta(t, query).catch(() => [])));
    const results = metas.flatMap(pick).slice(0, 20);

    try { await L.cmd(['SET', cacheKey, JSON.stringify(results), 'EX', String(TTL)]); } catch (_) {}
    return L.send(res, 200, { results });
  } catch (e) {
    L.send(res, 500, { error: e.message });
  }
};
