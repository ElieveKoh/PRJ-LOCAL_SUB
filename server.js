const express = require('express');
const http = require('http');
const os = require('os');
const dns = require('dns');
const path = require('path');
const { Server } = require('socket.io');
const config = require('./config.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// routes first: express.static would 301 /typist -> /typist/ otherwise
app.get('/api/config', (req, res) => res.json(config));
app.get('/typist', (req, res) => res.sendFile(path.join(__dirname, 'public/typist/index.html')));
app.get('/broadcast', (req, res) => res.sendFile(path.join(__dirname, 'public/broadcast/index.html')));

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
    };
  }
  return roomState[lang];
}

const typistRoom = (lang) => `${lang}:typist`;

function emitPeers(lang) {
  const state = roomState[lang];
  if (!state) return;
  io.to(lang).emit('peers', [...state.users.values()]);
}

io.on('connection', (socket) => {
  let lang = null;
  let me = null;

  socket.on('join', async (data = {}) => {
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

  // the broadcast view is the only place that knows what is actually on screen right now
  socket.on('onair', (data = {}) => {
    if (!lang) return;
    io.to(typistRoom(lang)).emit('onair', { ids: Array.isArray(data.ids) ? data.ids : [], texts: data.texts || [] });
  });

  socket.on('disconnect', () => {
    if (!lang || !me) return;
    const state = getRoom(lang);
    state.users.delete(socket.id);
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
server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log('====================================');
  console.log('🚀 자막 중계 서버 기동');
  console.log(`   호스트명 : ${os.hostname()}`);
  console.log(`   로컬 접속: http://localhost:${PORT}`);
  addrs.forEach((a) => console.log(`   외부 접속: http://${a.address}:${PORT}   (${a.name})`));
  if (!addrs.length) console.log('   ⚠️  LAN 인터페이스를 찾지 못했습니다. Wi-Fi/이더넷 연결을 확인하세요.');
  console.log('====================================');
});

module.exports = { app, server, io, resolveHost, ipOf };
