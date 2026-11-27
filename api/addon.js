// Stremio addon protocol (no SDK). Public, read-only: /@user/manifest.json etc.
// No catalog and no poster of its own — every link shows directly on the
// original movie/series card in Stremio and Nuvio:
//   stream/movie/tt0111161.json      -> links attached to that movie
//   stream/series/tt0903747:1:2.json -> series links: "all episodes" links on
//                                       every episode, links saved with a
//                                       season + episode only on that episode
// Every card: name = the original title name (from Cinemeta at add time),
// description = the text pasted when adding the link.
// When a title has no link, a card saying "no link added in this title" is
// always shown — there is no setting to turn it off.
const L = require('./_lib');


// Stremio hands behaviorHints videoHash / videoSize / filename to subtitle addons
// (OpenSubtitles etc.) so they can find subtitles for this exact file.
const VIDEO_EXT = /\.(mkv|mp4|avi|webm|mov|m4v|ts|m2ts|wmv|flv|mpe?g)$/i;

function pickFilename(l) {
  const d = String(l.desc || '').split('\n')[0].trim();
  if (VIDEO_EXT.test(d)) return d;      // description looks like the file name
  if (l.fname) return String(l.fname);  // else the name read from the video URL
  return d || null;
}

function toStream(l) {
  const stream = {
    name: String(l.name || 'Custom Links').trim(),
    description: String(l.desc || l.title || l.url).trim(),
    url: l.url
  };
  const hints = {};
  if (Number(l.size) > 0) hints.videoSize = Number(l.size);
  if (/^[a-f0-9]{16}$/.test(String(l.hash || ''))) hints.videoHash = l.hash;
  const fn = pickFilename(l);
  if (fn) hints.filename = fn;
  if (Object.keys(hints).length) stream.behaviorHints = hints;
  return stream;
}

function baseUrl(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `https://${host}` : 'https://stremio-custom-links.vercel.app';
}

function noLinkCard(req, name) {
  return {
    name: 'No links found',
    description: 'Click here to add new links',
    externalUrl: `${baseUrl(req)}/@${name}`
  };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const name = L.normName(q.u);
  const route = q.r;

  try {
    const user = await L.getUser(name);
    if (!user) return L.send(res, 404, { error: 'User not found' });
    const links = user.links || [];

    if (route === 'manifest') {
      return L.send(res, 200, {
        id: `community.custom.links.${name}`,
        version: '5.5.0',
        name: `Custom Links @${name}`,
        description: `Your own video links attached to movies and series by @${name}.`,
        resources: [
          { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }
        ],
        types: ['movie', 'series'],
        catalogs: [],
        behaviorHints: { configurable: true }
      });
    }
    if (route === 'stream') {
      // id: tt0111161 (movie) or tt0903747:1:2 (series, season 1 episode 2)
      const parts = String(q.id || '').split(':');
      const base = (parts[0] || '').toLowerCase();
      const s = /^\d+$/.test(parts[1] || '') ? Number(parts[1]) : null;
      const e = /^\d+$/.test(parts[2] || '') ? Number(parts[2]) : null;
      let streams = [];
      if (/^tt\d+$/.test(base)) {
        const mine = links.filter(l =>
          String(l.imdb || '').toLowerCase() === base &&
          // links saved for a specific episode only show on that episode
          (!l.se || (s !== null && e !== null && Number(l.se) === s && Number(l.ep) === e)));
        streams = mine.length ? mine.map(toStream) : [noLinkCard(req, name)];
      }
      return L.send(res, 200, { streams, cacheMaxAge: 0 });
    }
    L.send(res, 404, { error: 'Not found' });
  } catch (e) {
    L.send(res, 500, { error: e.message });
  }
};
