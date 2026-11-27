// GET /api/meta?imdb=tt0903747
// Season + episode list for one series, from the Cinemeta meta API, so the
// website can show season/episode dropdowns (with episode names) instead of
// manual numbers. Cached in Redis for 10 minutes; 30 requests per IP per minute.
const L = require('./_lib');

const TTL = 600;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  try {
    if (req.method !== 'GET') return L.send(res, 405, { error: 'Method not allowed' });
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    const imdb = String(q.imdb || '').trim().toLowerCase();
    if (!/^tt\d+$/.test(imdb)) return L.send(res, 400, { error: 'Invalid title' });

    // 30 requests per IP per minute (same style as /api/search)
    if ((await L.hit(`rl:meta:${L.ipOf(req)}`, 60)) > 30) {
      return L.send(res, 429, { error: 'Too many requests. Try again in a minute.' });
    }

    const cacheKey = `meta:${imdb}`;
    try {
      const cached = await L.cmd(['GET', cacheKey]);
      if (cached) return L.send(res, 200, JSON.parse(cached));
    } catch (_) { /* fall through to a live fetch */ }

    const r = await fetch('https://v3-cinemeta.strem.io/meta/series/' + imdb + '.json', { signal: AbortSignal.timeout(7000) });
    if (!r.ok) throw new Error('Cinemeta HTTP ' + r.status);
    const j = await r.json();
    const videos = (j && j.meta && Array.isArray(j.meta.videos)) ? j.meta.videos : [];

    const bySeason = new Map();
    for (const v of videos) {
      const s = Math.trunc(Number(v.season));
      const e = Math.trunc(Number(v.episode));
      if (!Number.isFinite(s) || !Number.isFinite(e) || s < 1 || s > 999 || e < 1 || e > 999) continue;
      if (!bySeason.has(s)) bySeason.set(s, []);
      bySeason.get(s).push({ e, name: String(v.name || '').slice(0, 120) });
    }
    const seasons = [...bySeason.keys()].sort((a, b) => a - b)
      .map(s => ({ s, eps: bySeason.get(s).sort((a, b) => a.e - b.e) }));
    const payload = { seasons };
    try { await L.cmd(['SET', cacheKey, JSON.stringify(payload), 'EX', String(TTL)]); } catch (_) {}
    return L.send(res, 200, payload);
  } catch (e) {
    L.send(res, 500, { error: e.message });
  }
};
