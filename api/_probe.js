// Reads the three things subtitle addons need from a direct video URL, using
// plain HTTP Range requests (no torrent, no download of the whole file):
//   size  -> bytes (from Content-Range / Content-Length)
//   hash  -> OpenSubtitles hash: size + sum of 64-bit little-endian words of the
//            first 64 KB and the last 64 KB, modulo 2^64 (16 hex characters)
//   fname -> release file name (Content-Disposition, else the URL path)
// Only ~128 KB is ever transferred. Never throws: problems end up in `error`.
const dns = require('dns').promises;
const net = require('net');

const CHUNK = 65536;
const VIDEO_EXT = /\.(mkv|mp4|avi|webm|mov|m4v|ts|m2ts|wmv|flv|mpe?g)$/i;
const UA = 'Mozilla/5.0 (compatible; StremioCustomLinks/5.5)';

/* ---- safety: the server must never be used to reach private networks ---- */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = String(ip).toLowerCase();
  if (x === '::' || x === '::1') return true;
  const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return isPrivateIp(m[1]);
  return /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
}
async function assertPublic(u, allowPrivate) {
  if (allowPrivate) return;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) throw new Error('This address is not allowed');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('This address is not allowed');
}

/* ---- one ranged request, following redirects by hand (each hop is checked) ---- */
async function ranged(url, start, end, opts) {
  let cur = new URL(url);
  for (let hop = 0; hop < 6; hop++) {
    await assertPublic(cur, opts.allowPrivate);
    const res = await fetch(cur.href, {
      headers: { Range: `bytes=${start}-${end}`, 'User-Agent': UA, Accept: '*/*', 'Accept-Encoding': 'identity' },
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeout || 4500)
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      try { if (res.body) await res.body.cancel(); } catch (_) {}
      if (!loc) throw new Error('Bad redirect from host');
      cur = new URL(loc, cur);
      if (cur.protocol !== 'http:' && cur.protocol !== 'https:') throw new Error('Bad redirect from host');
      continue;
    }
    return { res, finalUrl: cur };
  }
  throw new Error('Too many redirects');
}

// Reads at most n bytes and drops the rest (a host that ignores Range must not make us download the file).
async function readUpTo(res, n) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts = []; let got = 0;
  try {
    while (got < n) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(Buffer.from(value)); got += value.length;
    }
  } finally { try { await reader.cancel(); } catch (_) {} }
  return Buffer.concat(parts).subarray(0, n);
}
async function drop(res) { try { if (res.body) await res.body.cancel(); } catch (_) {} }

function parseContentRange(h) {
  const m = String(h || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  return m ? { start: Number(m[1]), end: Number(m[2]), total: m[3] === '*' ? null : Number(m[3]) } : null;
}

function osHash(size, head, tail) {
  let h = BigInt(size);
  for (const buf of [head, tail]) for (let i = 0; i + 8 <= buf.length; i += 8) h += buf.readBigUInt64LE(i);
  return BigInt.asUintN(64, h).toString(16).padStart(16, '0');
}

/* ---- file name ---- */
function nameFromDisposition(h) {
  if (!h) return '';
  let m = h.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i);
  if (m) { try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch (_) {} }
  m = h.match(/filename\s*=\s*"([^"]+)"/i) || h.match(/filename\s*=\s*([^;]+)/i);
  return m ? m[1].trim() : '';
}
function nameFromUrl(u) {
  try { return decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || ''); } catch (_) { return ''; }
}
function pickName(disposition, finalUrl, origUrl) {
  for (const c of [nameFromDisposition(disposition), nameFromUrl(finalUrl), nameFromUrl(origUrl)]) {
    const base = String(c || '').split(/[\\/]/).pop().trim();
    if (base && VIDEO_EXT.test(base)) return base.slice(0, 250);
  }
  return null;
}

async function probe(url, opts = {}) {
  const out = { size: null, hash: null, fname: null, error: null };
  try {
    const a = await ranged(url, 0, CHUNK - 1, opts);
    const res = a.res;
    out.fname = pickName(res.headers.get('content-disposition'), a.finalUrl.href, url);
    let size = null, head = null;
    if (res.status === 206) {
      const cr = parseContentRange(res.headers.get('content-range'));
      if (cr && cr.start === 0 && cr.total) size = cr.total;
      head = await readUpTo(res, CHUNK);
    } else if (res.status === 200) {
      const cl = Number(res.headers.get('content-length'));
      if (cl > 0) size = cl;
      await drop(res);
      out.error = 'This host ignores Range requests, so only the size could be read';
    } else {
      await drop(res);
      out.error = 'The host answered HTTP ' + res.status;
    }
    if (size) out.size = size;
    if (size && head && head.length === CHUNK && size >= CHUNK * 2) {
      const b = await ranged(a.finalUrl.href, size - CHUNK, size - 1, opts);
      if (b.res.status === 206) {
        const cr = parseContentRange(b.res.headers.get('content-range'));
        const tail = await readUpTo(b.res, CHUNK);
        if (cr && cr.start === size - CHUNK && tail.length === CHUNK) out.hash = osHash(size, head, tail);
        else out.error = 'Could not read the end of the file';
      } else {
        await drop(b.res);
        out.error = 'The host did not return the end of the file';
      }
    } else if (size && size < CHUNK * 2 && !out.error) {
      out.error = 'The file is too small to hash';
    } else if (!size && !out.error) {
      out.error = 'The host did not tell the file size';
    }
  } catch (e) {
    out.error = (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) ? 'The host took too long to answer' : String((e && e.message) || e).slice(0, 120);
  }
  return out;
}

module.exports = { probe, osHash, isPrivateIp, VIDEO_EXT };
