const express = require('express');
const http = require('http');
const os = require('os');
const dns = require('dns');
const path = require('path');
const { Server } = require('socket.io');
const baseConfig = require('./config.json');

// The real password never lives in the repo: it comes from the environment, or from a
// gitignored config.local.json. config.json ships with auth off and an empty password.
function loadConfig() {
  const merged = JSON.parse(JSON.stringify(baseConfig));
  try {
    const local = require('./config.local.json');
    Object.keys(local).forEach((k) => {
      merged[k] = (local[k] && typeof local[k] === 'object' && !Array.isArray(local[k]))
        ? Object.assign({}, merged[k], local[k]) : local[k];
    });
  } catch (e) { /* optional */ }
  if (process.env.SUB_PASSWORD) {
    merged.auth = Object.assign({}, merged.auth, { enabled: true, password: process.env.SUB_PASSWORD });
  }
  return merged;
}
const config = loadConfig();
const STARTED_AT = Date.now();
const AUTH = config.auth || { enabled: false, password: '' };
const authOn = () => Boolean(AUTH.enabled && AUTH.password);
const authOk = (pw) => !authOn() || String(pw || '') === String(AUTH.password);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Page hits are logged, static assets are not. This is what tells you whether something
// actually reached the server - a renderer that loads the page but cannot open a websocket
// shows up here and nowhere else.
app.use((req, res, next) => {
  if (!/\.(css|js|png|jpg|svg|ico|map|woff2?)$/i.test(req.path) && !req.path.startsWith('/socket.io')) {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const ts = new Date().toTimeString().slice(0, 8);
    console.log(`  ${ts}  HTTP  ${req.method} ${req.originalUrl}  ← ${ip}`);
  }
  next();
});

// routes first: express.static would 301 /typist -> /typist/ otherwise
app.get('/api/config', (req, res) => {
  const safe = JSON.parse(JSON.stringify(config));
  delete safe.auth;
  safe.authRequired = authOn();
  res.json(safe);
});

// The dashboard lists channels, and a channel nobody is on looks the same as one that is
// staffed unless the server says so. This is the room census: who is connected where.
app.get('/api/status', (req, res) => {
  const langs = {};
  (config.languages || []).forEach((l) => { langs[l.code] = { typists: 0, outputs: 0, onair: false }; });
  Object.keys(roomState).forEach((lang) => {
    const st = roomState[lang];
    const row = langs[lang] || (langs[lang] = { typists: 0, outputs: 0, onair: false });
    st.users.forEach((u) => { if (u.role === 'broadcast') row.outputs += 1; else row.typists += 1; });
    const bc = canonicalBroadcast(st);
    const v = bc ? st.onair.get(bc.id) : null;
    row.onair = !!(v && v.texts && v.texts.length);
  });
  res.json({ langs, uptimeMs: Date.now() - STARTED_AT });
});

app.use(express.json({ limit: '4kb' }));

app.post('/api/login', (req, res) => {
  const ok = authOk(req.body && req.body.pw);
  if (!ok) console.log(`  로그인 실패  ← ${(req.socket.remoteAddress || '').replace(/^::ffff:/, '')}`);
  res.status(ok ? 200 : 401).json({ ok });
});
app.get('/typist', (req, res) => res.sendFile(path.join(__dirname, 'public/typist/index.html')));
app.get('/broadcast', (req, res) => res.sendFile(path.join(__dirname, 'public/broadcast/index.html')));

// hls.js is served from the app, not a CDN: a venue LAN has no internet.
app.use('/vendor/hls', express.static(path.join(__dirname, 'node_modules/hls.js/dist')));

app.use(express.static(path.join(__dirname, 'public')));

// ---- socket relay ----
const ROOM_CFG = config.room || {};
const BUFFER_SIZE = ROOM_CFG.bufferSize || 4;
const MAX_DELAY = ROOM_CFG.maxDelayMs || 10000;

/** roomState[lang] = { seq, lines[], delayMs, pending:Map, users:Map } */
const roomState = {};

function getRoom(lang) {
  if (!roomState[lang]) {
    roomState[lang] = {
      seq: 0,
      lines: [],
      delayMs: ROOM_CFG.defaultDelayMs || 0,
      pending: new Map(),
      users: new Map(),
      onair: new Map(),
    };
  }
  return roomState[lang];
}

const typistRoom = (lang) => `${lang}:typist`;

// Report one screen, not a blend of all of them. Several output views drain their queues at
// slightly different moments, so relaying whichever spoke last let a laggard resurrect lines
// that had already left the other screens - the status oscillated and never settled.
// The longest-connected screen is the canonical one; if it leaves, the next-oldest takes over.
function canonicalBroadcast(state) {
  let best = null;
  state.users.forEach((u) => {
    if (u.role !== 'broadcast') return;
    if (!state.onair.has(u.id)) return;
    if (!best || u.since < best.since) best = u;
  });
  return best;
}

function emitOnAir(lang) {
  const state = roomState[lang];
  if (!state) return;
  const bc = canonicalBroadcast(state);
  const v = bc ? state.onair.get(bc.id) : null;
  io.to(typistRoom(lang)).emit('onair', { ids: v ? v.ids : [], texts: v ? v.texts : [] });
}

function emitPeers(lang) {
  const state = roomState[lang];
  if (!state) return;
  io.to(lang).emit('peers', [...state.users.values()]);
}

io.on('connection', (socket) => {
  let lang = null;
  let me = null;

  socket.on('join', async (data = {}) => {
    if (!authOk(data.pw)) {
      socket.emit('auth_failed');
      return;
    }
    lang = String(data.lang || 'ko');
    const state = getRoom(lang);
    const ip = ipOf(socket);
    const host = await resolveHost(ip);

    me = {
      id: socket.id,
      name: (data.name || '').trim() || host,
      host,
      ip,
      role: data.role === 'broadcast' ? 'broadcast' : 'typist',
      cid: String(data.cid || socket.id),
      rttMs: null,
      since: Date.now(),
    };

    socket.join(lang);
    if (me.role === 'typist') socket.join(typistRoom(lang));
    state.users.set(socket.id, me);
    console.log(`[${lang}] + ${me.role} ${me.name} (${host} / ${ip})`);

    if (me.role === 'typist') {
      const bc = canonicalBroadcast(state);
      const v = bc ? state.onair.get(bc.id) : null;
      socket.emit('onair', { ids: v ? v.ids : [], texts: v ? v.texts : [] });
    }

    socket.emit('state_sync', {
      lines: state.lines,
      seq: state.seq,
      delayMs: state.delayMs,
      maxDelayMs: MAX_DELAY,
      you: { id: socket.id, cid: me.cid, name: me.name, host },
    });
    emitPeers(lang);
  });

  socket.on('rename', (name) => {
    if (!me) return;
    me.name = String(name || '').trim() || me.host;
    emitPeers(lang);
  });

  socket.on('rtt', (cb) => { if (typeof cb === 'function') cb(); });

  socket.on('rtt_report', (ms) => {
    if (!me) return;
    me.rttMs = Number(ms) || 0;
    emitPeers(lang);
  });

  // typists only - the broadcast view must never see in-progress text
  socket.on('typing_update', (data = {}) => {
    if (!lang || !me) return;
    socket.to(typistRoom(lang)).emit('typing_update', {
      from: me.name,
      fromId: socket.id,
      text: String(data.text || ''),
      ts: Date.now(),
    });
  });

  // room-wide delay, owned by the server so both typists always agree
  socket.on('delay_set', (data = {}) => {
    if (!lang || !me) return;
    const state = getRoom(lang);
    state.delayMs = Math.max(0, Math.min(MAX_DELAY, Number(data.delayMs) || 0));
    io.to(lang).emit('delay_changed', { delayMs: state.delayMs, by: me.name });
  });

  socket.on('subtitle_send', (data = {}) => {
    if (!lang || !me) return;
    const state = getRoom(lang);
    const text = String(data.text || '').trim();
    if (!text) return;

    const pendingId = `${socket.id}:${data.localId || Date.now()}`;
    const delayMs = state.delayMs;
    const fireAt = Date.now() + delayMs;
    const fire = () => {
      state.pending.delete(pendingId);
      state.seq++;
      const line = {
        id: pendingId,
        seq: state.seq,
        from: me.name,
        cid: me.cid,
        text,
        serverTs: Date.now(),
      };
      state.lines.push(line);
      while (state.lines.length > BUFFER_SIZE) state.lines.shift();
      io.to(lang).emit('subtitle_new', line);
      io.to(typistRoom(lang)).emit('pending_done', { pendingId });
    };

    if (delayMs <= 0) {
      fire();
      return;
    }
    state.pending.set(pendingId, { timer: setTimeout(fire, delayMs), from: me.name, text });
    io.to(typistRoom(lang)).emit('pending_add', { pendingId, from: me.name, cid: me.cid, text, fireAt });
  });

  socket.on('subtitle_cancel', (data = {}) => {
    if (!lang) return;
    const state = getRoom(lang);
    const item = state.pending.get(data.pendingId);
    if (!item) return;
    clearTimeout(item.timer);
    state.pending.delete(data.pendingId);
    io.to(typistRoom(lang)).emit('pending_cancel', { pendingId: data.pendingId });
  });

  socket.on('subtitle_revoke', (data = {}) => {
    if (!lang) return;
    const state = getRoom(lang);
    state.lines = state.lines.filter((l) => l.id !== data.id);
    io.to(lang).emit('subtitle_revoke', { id: data.id });
  });

  socket.on('clear_all', () => {
    if (!lang) return;
    const state = getRoom(lang);
    state.lines = [];
    // an emergency clear must also kill whatever is still sitting in the delay queue,
    // otherwise a cleared screen repopulates a second later
    const killed = [...state.pending.keys()];
    state.pending.forEach((item) => clearTimeout(item.timer));
    state.pending.clear();
    io.to(lang).emit('clear_all');
    killed.forEach((pendingId) => io.to(typistRoom(lang)).emit('pending_cancel', { pendingId }));
  });

  // Only the output view knows what is actually on screen. Several may be connected at once
  // (a second switcher, a leftover tab), so keep each one's report separately and relay the
  // freshest - otherwise their queues interleave and lines look stuck on air forever.
  socket.on('onair', (data = {}) => {
    if (!lang || !me || me.role !== 'broadcast') return;
    const state = getRoom(lang);
    state.onair.set(socket.id, {
      ids: Array.isArray(data.ids) ? data.ids : [],
      texts: Array.isArray(data.texts) ? data.texts : [],
      at: Date.now(),
    });
    emitOnAir(lang);
  });

  socket.on('disconnect', () => {
    if (!lang || !me) return;
    const state = getRoom(lang);
    state.users.delete(socket.id);
    if (state.onair.delete(socket.id)) emitOnAir(lang);
    // pending items are intentionally left to fire - they were already committed
    socket.to(typistRoom(lang)).emit('typing_update', { from: me.name, fromId: socket.id, text: '', ts: Date.now() });
    console.log(`[${lang}] - ${me.role} ${me.name}`);
    emitPeers(lang);
  });
});

function ipOf(socket) {
  const raw = socket.handshake.address || '';
  return raw.replace(/^::ffff:/, '');
}

// Resolve a LAN peer's hostname; falls back to the ip itself.
function resolveHost(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '::1' || ip === '127.0.0.1') return resolve('this-machine');
    const t = setTimeout(() => resolve(ip), 400);
    dns.reverse(ip, (err, names) => {
      clearTimeout(t);
      resolve(err || !names.length ? ip : names[0].replace(/\.local$/, ''));
    });
  });
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address });
    }
  }
  return out;
}

const PORT = config.port || 3000;

// mDNS/Bonjour name. macOS reports "<name>.local" already; Windows/Linux report the bare name.
// Same-network clients (macOS, iOS, Windows 10+) can resolve this without any setup.
function mdnsHost() {
  const h = os.hostname();
  return h.includes('.') ? h : h + '.local';
}

// CJK glyphs occupy two terminal columns, so box drawing needs display width, not length.
function width(str) {
  let w = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    w += (c >= 0x1100 && (c <= 0x115f || c === 0x2329 || c === 0x232a
      || (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f)
      || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60)
      || (c >= 0xffe0 && c <= 0xffe6))) ? 2 : 1;
  }
  return w;
}

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  const W = 46;
  const line = (s = '', indent = 2) => {
    const body = ' '.repeat(indent) + s;
    return '  │' + body + ' '.repeat(Math.max(0, W - width(body))) + '│';
  };
  const rule = (l, m, r) => '  ' + l + '─'.repeat(W) + r;

  console.log('');
  console.log(rule('┌', '', '┐'));
  console.log(line('자막 중계 서버 기동'));
  console.log(rule('├', '', '┤'));
  console.log(line('팀에 보낼 주소'));
  console.log(line(`http://${mdnsHost()}:${PORT}`, 4));
  console.log(rule('├', '', '┤'));
  if (addrs.length) {
    console.log(line('위 주소가 안 되면 — IP 직접'));
    addrs.forEach((a) => console.log(line(`http://${a.address}:${PORT}`, 4)));
  } else {
    console.log(line('LAN 인터페이스를 찾지 못했습니다.'));
    console.log(line('Wi-Fi / 이더넷 연결을 확인하세요.'));
  }
  console.log(rule('├', '', '┤'));
  console.log(line(`http://localhost:${PORT}  — 이 PC에서만`));
  console.log(rule('└', '', '┘'));
  console.log('');
  const bare = os.hostname().replace(/\.local$/, '');
  if (bare !== (config.preferredHostname || 'local-sub')) {
    console.log(`  주소를 바꾸려면 이 PC의 컴퓨터 이름을 바꾸세요 (현재: ${bare})`);
    console.log(`    macOS  : sudo scutil --set LocalHostName ${config.preferredHostname || 'local-sub'}`);
    console.log('    Windows: 설정 → 시스템 → 정보 → 이 PC의 이름 바꾸기');
    console.log('');
  }
  console.log(authOn()
    ? '  🔒 비밀번호가 설정되어 있습니다. 접속 시 입력이 필요합니다.'
    : '  ⚠️  비밀번호 없음 — 같은 네트워크의 누구나 자막을 보낼 수 있습니다.');
  console.log('');
  console.log('  이 창을 닫으면 서버가 꺼지고 모든 자막 화면이 멈춥니다.');
  console.log('');
});

module.exports = { app, server, io, resolveHost, ipOf };
