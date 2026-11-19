// Telegram bot webhook for Custom Links.
// POST /api/bot — set this URL as the bot's webhook (see BOT_SETUP.md).
//
// Shares the same Redis data as the website (no new infrastructure):
// website se add kiya link bot me bhi dikhega, aur vice versa.
// The bot keeps a per-chat session in Redis (key tg:<chat id>), so the
// username and password are asked once per chat until the user logs out
// (/logout, /reset) — starting a new chat with the bot doesn't need the
// password again.
//
// Features mirror the website:
//   list / add / update / delete links, account register, and the addon
//   manifest URL — everything from chat, no website visit needed.
const crypto = require('crypto');
const L = require('./_lib');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const MAX_LINKS = 200; // same limit as api/links.js

/* ---------- Telegram API (plain fetch, no dependencies) ---------- */
async function tgApi(method, payload) {
  if (!TOKEN) return {};
  try {
    const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await r.json().catch(() => ({}));
  } catch (_) { return {}; }
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function reply(chat, text) { return tgApi('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }); }

// /links can outgrow one message (200 links x 2 lines > 4096 chars): split on lines
async function replyLong(chat, text) {
  const lines = text.split('\n');
  let buf = '', n = 0;
  for (const line of lines) {
    if (buf.length + line.length + 1 > 3800 && buf) { await reply(chat, buf); buf = ''; n++; }
    buf += (buf ? '\n' : '') + line;
  }
  if (buf) await reply(chat, buf);
  return n;
}

// works for the user's own messages in private chats — used to remove
// passwords from the chat history right after they are checked
function forget(chat, mid) { return tgApi('deleteMessage', { chat_id: chat, message_id: mid }); }

/* ---------- per-chat session (Redis, survives serverless cold starts) ---------- */
const sessKey = c => 'tg:' + c;
async function getSess(c) {
  try { const raw = await L.cmd(['GET', sessKey(c)]); const s = raw && JSON.parse(raw); return s || {}; }
  catch (_) { return {}; }
}
async function setSess(c, s) {
  if (s && Object.keys(s).length) await L.cmd(['SET', sessKey(c), JSON.stringify(s)]);
  else { try { await L.cmd(['DEL', sessKey(c)]); } catch (_) {} }
}
const logged = s => !!(s && s.st === 'ok' && s.name);
const idle = name => ({ st: 'ok', name });
// keep the /links numbering usable across wizards: the numbers stay valid
// until the list itself changes (add / delete), then fresh ids are stored
const idleWith = (name, ids) => { const s = { st: 'ok', name }; if (ids && ids.length) s.ids = ids; return s; };

/* ---------- texts ---------- */
const HELP = [
  '<b>Commands</b>',
  '/links — show all your links',
  '/add — add a new link (title + URL)',
  '/edit &lt;number&gt; — change a link\'s title or URL',
  '/del &lt;number&gt; — delete a link',
  '/manifest — your addon install URL for Stremio',
  '/whoami — which account is logged in',
  '/logout — forget this chat\'s login',
  '/cancel — cancel the current step',
  '/help — this list'
].join('\n');

function menu(name) {
  return 'Logged in as <b>@' + esc(name) + '</b> \u2713\n\n' +
    '/links — your links\n/add — add a link\n/edit &lt;number&gt; — change one\n/del &lt;number&gt; — remove one\n/manifest — Stremio install URL\n/help — all commands';
}

/* ---------- commands ---------- */
async function startCmd(chat, s) {
  if (logged(s)) return reply(chat, 'You are already logged in as <b>@' + esc(s.name) + '</b> — no need to log in again.\n/logout switches accounts.\n\n' + HELP);
  await setSess(chat, { st: 'login_user' });
  return reply(chat, 'Welcome to <b>Custom Links</b> \u2014 manage your Stremio addon from chat, no website needed.\n\nLog in first:\n1. Send your <b>username</b>\n2. Then your <b>password</b>\n\nYou will only be asked once \u2014 the bot remembers you until you /logout.\nNew here? /register creates an account.');
}

async function registerCmd(chat, s) {
  if (logged(s)) return reply(chat, 'You are already logged in as <b>@' + esc(s.name) + '</b>. /logout first to create a different account.');
  await setSess(chat, { st: 'reg_user' });
  return reply(chat, 'Account creation:\nSend a <b>username</b> (3-20 characters: a-z, 0-9, _).');
}

async function logoutCmd(chat, s) {
  if (!logged(s)) { await setSess(chat, {}); return reply(chat, 'No login to forget. Send /start to log in.'); }
  await setSess(chat, {});
  return reply(chat, 'Logged out \u2713 Send /start to log in again.');
}

async function cancelCmd(chat, s) {
  if (logged(s)) {
    if (s.st === 'ok') return reply(chat, 'Nothing to cancel.');
    await setSess(chat, idleWith(s.name, s.ids));
    return reply(chat, 'Cancelled.');
  }
  await setSess(chat, {});
  return reply(chat, 'Cancelled. Send /start to log in or /register to create an account.');
}

async function linksCmd(chat, s) {
  if (!logged(s)) return reply(chat, 'Log in first: /start');
  const user = await L.getUser(s.name);
  if (!user) { await setSess(chat, {}); return reply(chat, 'That account no longer exists. /register to create a new one.'); }
  const links = user.links || [];
  await setSess(chat, idleWith(s.name, links.map(l => l.id)));
  if (!links.length) return reply(chat, 'No links yet. Add your first one with /add.');
  let t = 'Your links (' + links.length + ' of ' + MAX_LINKS + '):\n\n';
  links.forEach((l, i) => { t += '<b>' + (i + 1) + '. ' + esc(l.title) + '</b>\n' + esc(l.url) + '\n\n'; });
  t += 'Tip: /edit &lt;number&gt; or /del &lt;number&gt;';
  return replyLong(chat, t);
}

async function addCmd(chat, s) {
  if (!logged(s)) return reply(chat, 'Log in first: /start');
  await setSess(chat, { st: 'add_title', name: s.name });
  return reply(chat, 'Send the <b>title</b> for the new link (1-200 characters).\nExample: <i>My favorite movie</i>\n/cancel to stop.');
}

async function editCmd(chat, s, arg) {
  if (!logged(s)) return reply(chat, 'Log in first: /start');
  const ids = s.ids || [];
  if (!ids.length) return reply(chat, 'Send /links first \u2014 then /edit &lt;number&gt; from that list.');
  const n = parseInt(arg, 10);
  if (!n || n < 1 || n > ids.length) return reply(chat, 'Send a number between 1 and ' + ids.length + ' (from the /links list). Example: /edit 1');
  const user = await L.getUser(s.name);
  const item = ((user && user.links) || []).find(l => l.id === ids[n - 1]);
  if (!item) return reply(chat, 'That link no longer exists \u2014 send /links to refresh the list.');
  await setSess(chat, { st: 'edit_title', name: s.name, id: item.id, t0: item.title, u0: item.url, ids: s.ids });
  return reply(chat, 'Editing <b>#' + n + '</b>\nTitle: ' + esc(item.title) + '\nURL: ' + esc(item.url) + '\n\nSend the <b>new title</b>, or <b>.</b> to keep the current one.');
}

async function delCmd(chat, s, arg) {
  if (!logged(s)) return reply(chat, 'Log in first: /start');
  const ids = s.ids || [];
  if (!ids.length) return reply(chat, 'Send /links first \u2014 then /del &lt;number&gt; from that list.');
  const n = parseInt(arg, 10);
  if (!n || n < 1 || n > ids.length) return reply(chat, 'Send a number between 1 and ' + ids.length + ' (from the /links list). Example: /del 1');
  const user = await L.getUser(s.name);
  const item = ((user && user.links) || []).find(l => l.id === ids[n - 1]);
  if (!item) return reply(chat, 'That link no longer exists \u2014 send /links to refresh the list.');
  await setSess(chat, { st: 'del_confirm', name: s.name, id: item.id, title: item.title, ids: s.ids });
  return reply(chat, 'Delete <b>#' + n + ' ' + esc(item.title) + '</b>?\n\nSend <b>YES</b> to delete or <b>NO</b> to cancel.');
}

async function manifestCmd(chat, s, host) {
  if (!logged(s)) return reply(chat, 'Log in first: /start');
  const url = 'https://' + host + '/@' + s.name + '/manifest.json';
  return reply(chat, 'Your addon install URL:\n\n<code>' + esc(url) + '</code>\n\nIn Stremio: <b>Addons</b> \u2192 <b>Community Addons</b> \u2192 \u2699 \u2192 <b>Add URL</b> \u2192 paste it.\nYour links show up in Stremio instantly \u2014 changes here apply right away.');
}

async function whoamiCmd(chat, s) {
  if (!logged(s)) return reply(chat, 'Not logged in. /start to log in, /register to create an account.');
  return reply(chat, 'Logged in as <b>@' + esc(s.name) + '</b>');
}

/* ---------- login wizard ---------- */
async function loginUser(chat, s, text) {
  const name = L.normName(text);
  if (!L.NAME_RE.test(name)) return reply(chat, 'Username must be 3-20 characters: letters, numbers or underscores. Send it again, or /cancel to stop.');
  const user = await L.getUser(name);
  if (!user) return reply(chat, 'No account named <b>@' + esc(name) + '</b>. Check the spelling, send another username, or /register to create one.');
  await setSess(chat, { st: 'login_pass', name });
  return reply(chat, 'Username: <b>@' + esc(name) + '</b>\nNow send your <b>password</b>.');
}

async function loginPass(chat, s, text, mid) {
  const user = await L.getUser(s.name);
  if (!user) { await setSess(chat, {}); return reply(chat, 'That account no longer exists. /register to create one.'); }
  const rl = 'rl:login:' + s.name + ':tg' + chat;
  if (await L.hits(rl) >= 10) return reply(chat, 'Too many wrong attempts. Try again in 15 minutes (/logout to cancel).');
  if (!L.checkPassword(text, user)) {
    const n = await L.hit(rl, 900);
    return reply(chat, 'Wrong password. ' + (10 - n) + ' attempts left \u2014 try again, or /cancel to stop.');
  }
  forget(chat, mid); // remove the password from the chat history
  await setSess(chat, idle(s.name));
  return reply(chat, menu(s.name));
}

/* ---------- register wizard ---------- */
async function regUser(chat, s, text) {
  const name = L.normName(text);
  if (!L.NAME_RE.test(name)) return reply(chat, 'Username must be 3-20 characters: letters, numbers or underscores. Send it again, or /cancel to stop.');
  if (await L.getUser(name)) return reply(chat, 'That username is taken. Send a different one, or /cancel to stop.');
  await setSess(chat, { st: 'reg_pass', name });
  return reply(chat, '<b>@' + esc(name) + '</b> is free \u2713\nNow send a <b>password</b> (6-100 characters).\nI will delete your password message right after checking it.');
}

async function regPass(chat, s, text, mid) {
  const pw = text;
  if (pw.length < 6 || pw.length > 100) return reply(chat, 'Password must be 6-100 characters. Send it again, or /cancel to stop.');
  forget(chat, mid);
  const user = { ...L.hashPassword(pw), links: [], created: Date.now() };
  if (!(await L.createUser(s.name, user))) {
    await setSess(chat, { st: 'reg_user' });
    return reply(chat, 'That username was just taken by someone else. Send a different username.');
  }
  await setSess(chat, idle(s.name));
  return reply(chat, 'Account created and logged in \u2713\n\n' + menu(s.name) + '\n\nNext: /add your first link, then /manifest to install the addon in Stremio.');
}

/* ---------- add / edit / delete wizards ---------- */
async function addTitle(chat, s, text) {
  const title = text.trim().slice(0, 200);
  if (!title) return reply(chat, 'Title can\'t be empty. Send a title, or /cancel to stop.');
  await setSess(chat, { st: 'add_url', name: s.name, title });
  return reply(chat, 'Title: <b>' + esc(title) + '</b>\nNow send the <b>link</b> (must start with http:// or https://).');
}

async function addUrl(chat, s, text) {
  const url = text.trim();
  if (!L.validUrl(url)) return reply(chat, 'That doesn\'t look like a link \u2014 it must start with http:// or https://. Send it again, or /cancel to stop.');
  const user = await L.getUser(s.name);
  if (!user) { await setSess(chat, {}); return reply(chat, 'That account no longer exists. /register to create a new one.'); }
  const links = user.links || [];
  if (links.length >= MAX_LINKS) { await setSess(chat, idleWith(s.name, s.ids)); return reply(chat, 'Limit of ' + MAX_LINKS + ' links reached \u2014 delete some with /del &lt;number&gt; first.'); }
  links.push({ id: crypto.randomBytes(5).toString('hex'), title: s.title, url });
  user.links = links;
  await L.saveUser(s.name, user);
  await setSess(chat, idleWith(s.name, links.map(l => l.id)));
  return reply(chat, 'Added \u2713 (' + links.length + ' of ' + MAX_LINKS + ' links)\n\n/links to see all \u00b7 /manifest for the Stremio URL');
}

async function editTitle(chat, s, text) {
  const t = text.trim();
  const title = t === '.' ? s.t0 : t.slice(0, 200);
  if (!title) return reply(chat, 'Title can\'t be empty. Send a title, or <b>.</b> to keep the current one.');
  await setSess(chat, { st: 'edit_url', name: s.name, id: s.id, nt: title, u0: s.u0, ids: s.ids });
  return reply(chat, 'New title: <b>' + esc(title) + '</b>\nNow send the <b>new URL</b>, or <b>.</b> to keep the current one.');
}

async function editUrl(chat, s, text) {
  const t = text.trim();
  const url = t === '.' ? s.u0 : t;
  if (!L.validUrl(url)) return reply(chat, 'That doesn\'t look like a link \u2014 it must start with http:// or https://. Send it again, or <b>.</b> to keep the current one.');
  const user = await L.getUser(s.name);
  const item = ((user && user.links) || []).find(l => l.id === s.id);
  if (!item) { await setSess(chat, idleWith(s.name, s.ids)); return reply(chat, 'That link was just deleted from somewhere else \u2014 /links to refresh.'); }
  item.title = s.nt; item.url = url;
  await L.saveUser(s.name, user);
  await setSess(chat, idleWith(s.name, s.ids));
  return reply(chat, 'Updated \u2713\n\n/links to see all.');
}

async function delConfirm(chat, s, text) {
  const t = text.trim().toLowerCase();
  if (t === 'yes' || t === 'y') {
    const user = await L.getUser(s.name);
    const links = (user && user.links) || [];
    const left = links.filter(l => l.id !== s.id);
    if (left.length === links.length) { await setSess(chat, idle(s.name)); return reply(chat, 'That link no longer exists \u2014 /links to refresh.'); }
    user.links = left;
    await L.saveUser(s.name, user);
    await setSess(chat, idleWith(s.name, left.map(l => l.id)));
    return reply(chat, 'Deleted \u2713 (' + left.length + ' links left)\n\n/links to see all.');
  }
  if (t === 'no' || t === 'n') { await setSess(chat, idleWith(s.name, s.ids)); return reply(chat, 'Cancelled.'); }
  return reply(chat, 'Send <b>YES</b> to delete or <b>NO</b> to cancel.');
}

/* ---------- router ---------- */
async function handle(chat, msg, text, host) {
  const s = await getSess(chat);
  if (text.startsWith('/')) {
    const parts = text.slice(1).split(/\s+/);
    const cmd = (parts[0] || '').split('@')[0].toLowerCase(); // /add@MyBot works too
    const arg = parts.slice(1).join(' ').trim();
    switch (cmd) {
      case 'start': case 'login': return startCmd(chat, s);
      case 'register': return registerCmd(chat, s);
      case 'help': return reply(chat, HELP);
      case 'logout': case 'reset': return logoutCmd(chat, s);
      case 'cancel': return cancelCmd(chat, s);
      case 'links': case 'list': return linksCmd(chat, s);
      case 'add': return addCmd(chat, s);
      case 'edit': return editCmd(chat, s, arg);
      case 'del': case 'delete': return delCmd(chat, s, arg);
      case 'manifest': return manifestCmd(chat, s, host);
      case 'whoami': return whoamiCmd(chat, s);
      default: return reply(chat, logged(s) ? 'Unknown command \u2014 send /help.' : 'Send /start to log in, /register to create an account, or /help.');
    }
  }
  switch (s.st) {
    case 'login_user': return loginUser(chat, s, text);
    case 'login_pass': return loginPass(chat, s, text, msg.message_id);
    case 'reg_user': return regUser(chat, s, text);
    case 'reg_pass': return regPass(chat, s, text, msg.message_id);
    case 'add_title': return addTitle(chat, s, text);
    case 'add_url': return addUrl(chat, s, text);
    case 'edit_title': return editTitle(chat, s, text);
    case 'edit_url': return editUrl(chat, s, text);
    case 'del_confirm': return delConfirm(chat, s, text);
    default:
      return reply(chat, logged(s)
        ? 'Use /links, /add, /edit &lt;number&gt;, /del &lt;number&gt; or /manifest \u2014 /help shows everything.'
        : 'Send /start to log in or /register to create an account.');
  }
}

module.exports = async (req, res) => {
  // optional shared secret: set TELEGRAM_WEBHOOK_SECRET and pass secret_token=
  // in the setWebhook call, and Telegram adds it as a header on every update
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) { res.statusCode = 401; res.end('Bad secret'); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end('Telegram webhook endpoint. Setup: BOT_SETUP.md'); return; }

  const upd = L.parseBody(req);
  const msg = upd && upd.message;
  res.statusCode = 200;
  if (!msg || !msg.chat || msg.chat.type !== 'private' || !msg.text) { res.end(); return; } // private chats only

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'stremio-custom-links.vercel.app');
  try { await handle(msg.chat.id, msg, String(msg.text).trim(), host); }
  catch (e) { try { await reply(msg.chat.id, 'Something went wrong on my side. Please try again.'); } catch (_) {} }
  res.end();
};
