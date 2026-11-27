// Stremio addon protocol (no SDK). Public, read-only: /@user/manifest.json etc.
// No catalog and no poster of its own — every link shows directly on the
// original movie/series card in Stremio and Nuvio:
//   stream/movie/tt0111161.json      -> links attached to that movie
//   stream/series/tt0903747:1:2.json -> links attached to that series (every episode)
// Every card: name = the original title name (from Cinemeta at add time),
// description = the text pasted when adding the link.
// When a title has no link, a card saying "no link added in this title" is
// always shown — there is no setting to turn it off.
const L = require('./_lib');

const NO_LINK_MSG = 'no link added in this title';

function toStream(l) {
  return {
    name: String(l.name || 'Custom Links').trim(),
    description: String(l.desc || l.title || l.url).trim(),
    url: l.url
  };
}

function noLinkCard() {
  return {
    name: 'Custom Links',
    description: NO_LINK_MSG,
    url: 'https://example.com/',
    behaviorHints: { notWebReady: true }
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
        version: '5.1.0',
        name: `Custom Links @${name}`,
        description: `Your own video links attached to movies and series by @${name}.`,
        resources: [
          { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }
        ],
        types: ['movie', 'series'],
        behaviorHints: { configurable: true }
      });
    }
    if (route === 'stream') {
      const base = String(q.id || '').split(':')[0].toLowerCase();
      let streams = [];
      if (/^tt\d+$/.test(base)) {
        const mine = links.filter(l => String(l.imdb || '').toLowerCase() === base);
        streams = mine.length ? mine.map(toStream) : [noLinkCard()];
      }
      return L.send(res, 200, { streams, cacheMaxAge: 0 });
    }
    L.send(res, 404, { error: 'Not found' });
  } catch (e) {
    L.send(res, 500, { error: e.message });
  }
};
