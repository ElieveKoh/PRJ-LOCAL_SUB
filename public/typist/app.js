(function () {
  const $ = (id) => document.getElementById(id);
  const T = (k, ...a) => I18N.t(k, ...a);
  const el = {
    onAir: $('onAir'), langName: $('langName'), langCode: $('langCode'),
    telDelay: $('telDelay'), telSync: $('telSync'), telBuffer: $('telBuffer'),
    peers: $('peers'), uiLang: $('uiLang'),
    video: $('video'), videoPh: $('videoPh'), overlay: $('overlay'),
    grid: $('grid'), layoutBtn: $('layoutBtn'),
    timecode: $('timecode'), proto: $('proto'),
    monitor: $('monitor'), monitorBody: $('monitorBody'), monitorWho: $('monitorWho'),
    history: $('history'), histCount: $('histCount'),
    hkModal: $('hkModal'), hkBack: $('hkBack'), hkRows: $('hkRows'), hkStrip: $('hkStrip'),
    hkAdd: $('hkAdd'), hkSave: $('hkSave'), hkCancel: $('hkCancel'), hkClose: $('hkClose'),
    delay: $('delay'), delayVal: $('delayVal'),
    input: $('input'), counter: $('counter'), btnSend: $('btnSend'),
    btnRevoke: $('btnRevoke'), btnClear: $('btnClear'),
    warn: $('warn'), toasts: $('toasts'),
  };

  const conn = SubSocket.connect({ role: 'typist' });
  const WARN_CHARS = Number(conn.param('warnChars', 40));
  const startedAt = Date.now();
  const HK_KEY = 'sub.hotkeys';

  let myId = null;
  let myCid = conn.cid;
  let myName = '';
  let peers = [];
  let typingPeers = new Map();
  let items = [];               // oldest first - the list renders top-down, newest at the bottom
  let onAirIds = new Set();
  let dupName = false;
  let hotkeys = loadHotkeys();
  let suppressDelayEmit = false;

  document.title = `[${conn.lang}] 자막 입력`;

  // Layout is a seat preference, not a room setting - it stays in this browser, the same way
  // hotkeys do. 'video' keeps the picture in the wide column; 'text' gives that column to the
  // history and the other typist's line, which is what matters once a show is actually running.
  const LAYOUT_KEY = 'sub.layout';
  let layout = 'video';
  try { layout = localStorage.getItem(LAYOUT_KEY) === 'text' ? 'text' : 'video'; } catch (e) {}

  function renderLayout() {
    el.grid.dataset.layout = layout;
    el.layoutBtn.textContent = T(layout === 'video' ? 'layoutText' : 'layoutVideo');
  }
  el.layoutBtn.addEventListener('click', () => {
    layout = layout === 'video' ? 'text' : 'video';
    try { localStorage.setItem(LAYOUT_KEY, layout); } catch (e) {}
    renderLayout();
  });
  renderLayout();

  SubVideo.mount({
    box: el.video,
    placeholder: el.videoPh,
    statusEl: el.proto,
    override: conn.param('video', ''),
    t: T,
  });

  // ---------- i18n ----------
  function applyStatic() {
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = T(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach((n) => { n.innerHTML = T(n.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-title]').forEach((n) => { n.title = T(n.dataset.i18nTitle); });
    el.proto.title = T('vResyncTip');
    SubVideo.relabel();
    renderLayout();
    el.input.placeholder = T('placeholder');
    el.langName.textContent = I18N.langName(conn.lang);
    el.langCode.textContent = conn.lang.toUpperCase();
    el.uiLang.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.ui === I18N.lang));
  }
  el.uiLang.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) I18N.set(b.dataset.ui);
  });
  I18N.onChange(() => { applyStatic(); renderAll(); });

  function renderAll() {
    renderPeers(); renderMonitor(); renderHistory(); renderHotkeyStrip(); renderHeader();
  }

  // ---------- toast ----------
  function toast(msg, bad) {
    const d = document.createElement('div');
    d.className = 'toast' + (bad ? ' bad' : '');
    d.textContent = msg;
    el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }

  // ---------- header ----------
  function renderHeader() {
    const status = conn.getStatus();
    const online = status === 'online';
    const bc = peers.filter((p) => p.role === 'broadcast').length;

    el.onAir.classList.toggle('live', online && bc > 0);
    el.onAir.querySelector('b').textContent = online ? (bc > 0 ? T('onAir') : T('offAir')) : T('noLink');

    const me = peers.find((p) => p.id === myId);
    const rtt = me && me.rttMs;
    setTel(el.telSync, rtt == null ? '—' : rtt + 'ms',
      !online ? 'bad' : rtt == null ? '' : rtt > 300 ? 'warn' : 'ok');

    const waiting = items.filter((i) => i.kind === 'pending').length;
    const failed = items.filter((i) => i.kind === 'failed').length;
    if (!online) setTel(el.telBuffer, T('bufOff'), 'bad');
    else if (failed) setTel(el.telBuffer, `${T('bufFail')} ${failed}`, 'bad');
    else if (waiting) setTel(el.telBuffer, `${T('bufWait')} ${waiting}`, waiting > 2 ? 'warn' : '');
    else setTel(el.telBuffer, T('bufOk'), 'ok');

    el.warn.textContent = !online ? T('warnOffline')
      : dupName ? T('warnDupName')
      : bc === 0 ? T('warnNoBroadcast')
      : bc > 1 ? T('warnManyBc', bc) : '';
  }
  function setTel(node, text, cls) {
    node.querySelector('b').textContent = text;
    node.className = 'tel' + (cls ? ' ' + cls : '');
  }

  function renderPeers() {
    const status = conn.getStatus();
    el.peers.innerHTML = '';
    peers.forEach((p) => {
      const mine = p.id === myId;
      const d = document.createElement('div');
      d.className = 'peer ' + ((mine && status !== 'online') ? 'off' : (p.rttMs > 300 ? 'slow' : ''));
      d.innerHTML = `<span class="led"></span>` +
        `<span class="nm${mine ? ' me' : ''}">${esc(p.name)}${mine ? ` (${T('me')})` : ''}</span>` +
        `<span class="rt">${p.role === 'broadcast' ? T('roleBroadcast') : T('roleTypist')}` +
        ` ${p.rttMs == null ? '—' : p.rttMs + 'ms'}</span>`;
      if (mine) { d.style.cursor = 'pointer'; d.title = T('renamePrompt'); d.addEventListener('click', rename); }
      el.peers.appendChild(d);
    });
    if (status !== 'online') {
      const d = document.createElement('div');
      d.className = 'peer off';
      d.innerHTML = `<span class="led"></span><span class="nm">${T('bufOff')}</span>`;
      el.peers.appendChild(d);
    }
    const others = peers.filter((p) => p.role === 'typist' && p.id !== myId).length;
    el.peers.classList.toggle('alone', status === 'online' && others === 0);

    // identical display names make the history unreadable even though ownership is correct
    const names = peers.filter((p) => p.role === 'typist').map((p) => p.name);
    dupName = names.some((n, i) => names.indexOf(n) !== i);
    el.peers.querySelectorAll('.peer').forEach((node, i) => {
      const p = peers[i];
      if (p && p.role === 'typist' && names.filter((n) => n === p.name).length > 1) node.classList.add('dup');
    });
    renderHeader();
  }

  function rename() {
    const v = prompt(T('renamePrompt'), myName);
    if (v == null) return;
    const name = v.trim();
    if (!name) return;
    myName = name;
    // per-tab first (authoritative for this seat), browser-wide as the default for next time
    try { sessionStorage.setItem('sub.typist.name', name); } catch (e) {}
    try { localStorage.setItem('sub.typist.name', name); } catch (e) {}
    conn.emit('rename', name);
  }

  setInterval(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const p = (n) => String(n).padStart(2, '0');
    el.timecode.textContent = `SESSION ${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
    el.timecode.classList.toggle('rec', onAirIds.size > 0);
  }, 1000);

  let gating = false;
  conn.onStatus((s) => {
    el.input.classList.toggle('offline', s !== 'online');
    el.btnSend.disabled = s !== 'online';
    if (s === 'offline') toast(T('tOffline'), true);
    if (s === 'unauthorized' && !gating) {
      gating = true;
      SubAuth.clear();
      SubAuth.gate({ title: T('brand'), note: '비밀번호가 필요합니다.' }).then(() => location.reload());
    }
    renderPeers();
  });
  conn.on('peers', (list) => {
    peers = list || [];
    // safety net replacing the old idle timer: a peer who left cannot still be typing
    const live = new Set(peers.map((p) => p.id));
    let dropped = false;
    typingPeers.forEach((_, id) => { if (!live.has(id)) { typingPeers.delete(id); dropped = true; } });
    if (dropped) renderMonitor();
    renderPeers();
  });

  conn.on('state_sync', (st) => {
    myId = st.you && st.you.id;
    myCid = (st.you && st.you.cid) || myCid;
    myName = (st.you && st.you.name) || '';
    el.delay.max = st.maxDelayMs || 10000;
    setDelayUI(st.delayMs);
    const failed = items.filter((i) => i.kind === 'failed');
    items = (st.lines || []).map((l) => ({
      kind: 'sent', id: l.id, from: l.from, text: l.text, ts: l.serverTs,
      mine: l.cid === myCid,
    })).concat(failed);
    renderHistory(true);
    renderPeers();
  });

  // ---------- delay ----------
  function setDelayUI(ms) {
    suppressDelayEmit = true;
    el.delay.value = ms;
    showDelay(ms);
    suppressDelayEmit = false;
  }
  function showDelay(ms) {
    el.delayVal.textContent = (ms / 1000).toFixed(1) + 's';
    setTel(el.telDelay, (ms / 1000).toFixed(1) + 's', ms > 0 ? '' : 'ok');
  }
  el.delay.addEventListener('input', () => {
    const ms = Number(el.delay.value);
    showDelay(ms);
    if (!suppressDelayEmit) conn.emit('delay_set', { delayMs: ms });
  });
  conn.on('delay_changed', (d) => {
    setDelayUI(d.delayMs);
    if (d.by && d.by !== myName) toast(T('tDelayBy', d.by, (d.delayMs / 1000).toFixed(1)));
  });

  // ---------- monitor ----------
  conn.on('typing_update', (d) => {
    if (!d.text) typingPeers.delete(d.fromId);
    else typingPeers.set(d.fromId, d);
    renderMonitor();
  });
  function renderMonitor() {
    const live = [...typingPeers.values()].filter((t) => t.text);
    el.monitor.classList.toggle('active', live.length > 0);
    el.btnSend.classList.toggle('conflict', live.length > 0);
    el.monitorWho.textContent = live.length
      ? live.map((t) => esc(t.name || t.from)).join(', ') + ' ' + T('typing') : '';
    el.monitorBody.innerHTML = live.length
      ? live.map((t) => `<div>${esc(t.text)}<span class="caret"></span></div>`).join('')
      : `<span class="idle">${T('monitorIdle')}</span>`;
  }
  // No idle timer here on purpose. Every case that should clear the peer's in-progress text
  // already sends an explicit empty typing_update (send, Esc, tab close, disconnect), so a
  // timeout would only ever fire while the other typist is pausing to think - exactly when
  // their draft is most worth keeping on screen.
  setInterval(() => {
    el.history.querySelectorAll('.hwho[data-cd]').forEach((n) => { n.textContent = remain(Number(n.dataset.cd)); });
  }, 400);

  // ---------- on-air mirror ----------
  conn.on('onair', (d) => {
    onAirIds = new Set(d.ids || []);
    el.overlay.innerHTML = (d.texts || []).map((t) => `<div class="ov">${esc(t)}</div>`).join('');
    renderHistory();
  });

  // ---------- history ----------
  function statusOf(it) {
    if (it.kind === 'failed') return { cls: 'fail', label: T('stFail') };
    if (it.kind === 'pending') return { cls: 'wait', label: T('stWait') };
    if (it.revoked) return { cls: 'done', label: T('stRevoked') };
    if (onAirIds.has(it.id)) return { cls: 'live', label: T('stLive') };
    return { cls: 'done', label: T('stDone') };
  }

  function renderHistory(force) {
    const atBottom = force || (el.history.scrollHeight - el.history.scrollTop - el.history.clientHeight < 60);
    const shown = items.slice(-14);
    el.histCount.textContent = items.length ? items.length + T('count') : '';
    if (!shown.length) { el.history.innerHTML = `<li class="empty">${T('histEmpty')}</li>`; return; }
    el.history.innerHTML = '';
    shown.forEach((it) => {
      const st = statusOf(it);
      const li = document.createElement('li');
      li.className = `s-${st.cls} ${it.mine ? 'mine' : 'other'}${it.revoked ? ' revoked' : ''}`;
      const when = it.kind === 'pending'
        ? `<span class="hwho" data-cd="${it.fireAt}">${remain(it.fireAt)}</span>`
        : `<span class="hwho">${it.ts ? new Date(it.ts).toTimeString().slice(0, 8) : ''}</span>`;
      li.innerHTML =
        `<div class="hmeta">` +
          `<span class="who ${it.mine ? 'mine' : 'theirs'}">${it.mine ? T('me') : esc(it.from || '?')}</span>` +
          `<span class="st ${st.cls}"><i></i>${st.label}</span>${when}` +
        `</div><div class="htext">${esc(it.text)}</div>`;
      const act = action(it, st);
      if (act) li.appendChild(act);
      el.history.appendChild(li);
    });
    if (atBottom) el.history.scrollTop = el.history.scrollHeight;
    renderHeader();
  }

  function action(it, st) {
    const b = document.createElement('button');
    b.className = 'hbtn';
    if (it.kind === 'failed') {
      b.className += ' retry'; b.textContent = T('actRetry');
      b.addEventListener('click', () => retry(it));
    } else if (it.kind === 'pending') {
      b.textContent = T('actCancel');
      b.addEventListener('click', () => conn.emit('subtitle_cancel', { pendingId: it.pendingId }));
    } else if (st.cls === 'live' && !it.revoked) {
      b.textContent = T('actRevoke');
      b.addEventListener('click', () => conn.emit('subtitle_revoke', { id: it.id }));
    } else return null;
    const wrap = document.createElement('div');
    wrap.className = 'hact';
    wrap.appendChild(b);
    return wrap;
  }

  function retry(it) {
    if (conn.getStatus() !== 'online') { toast(T('tNotOnline'), true); return; }
    items = items.filter((i) => i !== it);
    renderHistory();
    conn.emit('subtitle_send', { localId: Date.now() + '-retry', text: it.text });
    toast(T('tRetried'));
  }

  const remain = (at) => Math.max(0, (at - Date.now()) / 1000).toFixed(1) + 's';

  conn.on('pending_add', (p) => {
    items.push({ kind: 'pending', pendingId: p.pendingId, from: p.from, text: p.text,
                 fireAt: p.fireAt, mine: p.cid === myCid });
    renderHistory();
  });
  const dropPending = (p) => { items = items.filter((i) => i.pendingId !== p.pendingId); renderHistory(); };
  conn.on('pending_cancel', dropPending);
  conn.on('pending_done', dropPending);
  conn.on('subtitle_new', (l) => {
    items.push({ kind: 'sent', id: l.id, from: l.from, text: l.text, ts: l.serverTs,
                 mine: l.cid === myCid });
    items = items.slice(-60);
    renderHistory();
  });
  conn.on('subtitle_revoke', (d) => {
    const it = items.find((i) => i.id === d.id);
    if (it) { it.revoked = true; renderHistory(); }
  });
  conn.on('clear_all', () => {
    onAirIds = new Set(); el.overlay.innerHTML = ''; renderHistory(); toast(T('tCleared'));
  });

  // ---------- hotkeys ----------
  // A binding is stored as a normalized combo string built from event.code, so it is
  // keyboard-layout independent: "Ctrl+Shift+Digit1", "Alt+KeyQ", "F5".
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

  // Keys this app already owns. Kept in sync with the keydown handlers below by hand.
  const OURS = ['Enter', 'Shift+Enter', 'Escape',
                'Ctrl+Backspace', 'Meta+Backspace', 'Ctrl+KeyZ', 'Meta+KeyZ'];

  function parseCombo(combo) {
    const parts = combo.split('+');
    const base = parts[parts.length - 1];
    return {
      base,
      ctrl: parts.includes('Ctrl'),
      alt: parts.includes('Alt'),
      shift: parts.includes('Shift'),
      meta: parts.includes('Meta'),
      nMods: parts.length - 1,
    };
  }

  const has = (list, v) => list.indexOf(v) !== -1;

  /** Why this combo cannot be a hotkey, or null if it is fine. */
  function blockReason(combo) {
    if (has(OURS, combo)) return 'hkReserved';
    const k = parseCombo(combo);
    const cmd = k.ctrl || k.meta;          // primary modifier on either platform

    // 1. the browser or OS never lets the page see these - preventDefault does nothing
    if (has(['F11', 'F12', 'PrintScreen', 'ContextMenu'], k.base)) return 'hkBlockOs';
    if (cmd && has(['KeyW', 'KeyT', 'KeyN', 'KeyQ'], k.base)) return 'hkBlockOs';
    if (cmd && k.shift && has(['KeyW', 'KeyT', 'KeyN'], k.base)) return 'hkBlockOs';
    if (k.alt && k.base === 'F4') return 'hkBlockOs';
    if ((k.meta || k.alt) && k.base === 'Tab') return 'hkBlockOs';
    if (k.ctrl && k.shift && has(['KeyI', 'KeyJ', 'KeyC'], k.base)) return 'hkBlockOs';   // devtools
    if (k.meta && k.alt && has(['KeyI', 'KeyJ', 'KeyC', 'KeyU'], k.base)) return 'hkBlockOs';
    if (k.meta && has(['KeyM', 'KeyH', 'Space', 'Backquote'], k.base)) return 'hkBlockOs';

    // 2. input-method toggles - stealing these leaves the typist unable to switch languages
    if (k.base === 'Space' && (k.ctrl || k.shift || k.alt)) return 'hkBlockIme';
    if (has(['HangulMode', 'Lang1', 'Lang2', 'Convert', 'NonConvert', 'KanaMode'], k.base)) return 'hkBlockIme';
    if (k.alt && !cmd && k.base === 'Backquote') return 'hkBlockIme';

    // 3. text editing - a typist uses these constantly inside the composer
    if (cmd && !k.alt && has(['KeyC', 'KeyV', 'KeyX', 'KeyA', 'KeyZ', 'KeyY'], k.base)) return 'hkBlockEdit';

    // 4. browser shortcuts we could technically swallow but should not
    if (cmd && !k.alt && has(['KeyR', 'KeyL', 'KeyD', 'KeyP', 'KeyS', 'KeyF', 'KeyG',
                              'KeyO', 'KeyU', 'KeyJ', 'KeyH', 'KeyK', 'KeyB', 'KeyE'], k.base)) return 'hkBlockBrowser';
    if (cmd && !k.shift && !k.alt && /^Digit[0-9]$/.test(k.base)) return 'hkBlockBrowser';  // tab switching
    if (cmd && k.base === 'Tab') return 'hkBlockBrowser';
    if (k.alt && !cmd && has(['KeyE', 'KeyF', 'KeyD', 'Home', 'ArrowLeft', 'ArrowRight'], k.base)) return 'hkBlockBrowser';

    return null;
  }

  function comboOf(e) {
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    parts.push(e.code || e.key);
    return parts.join('+');
  }

  // F11/F12 are excluded on purpose - the browser owns them
  const isFn = (code) => /^F([1-9]|10)$/.test(code);
  function comboValid(combo) {
    const k = parseCombo(combo);
    if (isFn(k.base)) return true;
    if (k.nMods === 0) return false;                 // a bare key would eat normal typing
    if (k.nMods === 1 && k.shift) return false;      // Shift+x is just an uppercase letter
    return true;
  }

  function comboLabel(combo) {
    if (!combo) return T('hkUnset');
    const sym = IS_MAC ? { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' } : {};
    const out = combo.split('+').map((p) => sym[p] || p
      .replace(/^Digit/, '').replace(/^Key/, '').replace(/^Numpad/, 'Num')
      .replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→')
      .replace('Backquote', '`').replace('Minus', '-').replace('Equal', '=')
      .replace('BracketLeft', '[').replace('BracketRight', ']').replace('Semicolon', ';')
      .replace('Quote', "'").replace('Comma', ',').replace('Period', '.').replace('Slash', '/')
      .replace('Backslash', '\\'));
    return IS_MAC ? out.join('') : out.join('+');
  }

  function loadHotkeys() {
    let raw = [];
    try { raw = JSON.parse(localStorage.getItem(HK_KEY) || '[]'); } catch (e) {}
    if (!Array.isArray(raw)) raw = [];
    // migrate the old fixed F1-F10 slot format
    return raw.map((h, i) => ({
      combo: h && h.combo ? h.combo : 'F' + (i + 1),
      label: (h && h.label) || '',
      text: (h && h.text) || '',
    })).filter((h) => h.text || h.label);
  }

  function saveHotkeys(list) {
    hotkeys = list;
    try { localStorage.setItem(HK_KEY, JSON.stringify(hotkeys)); } catch (e) {}
    renderHotkeyStrip();
  }

  function renderHotkeyStrip() {
    el.hkStrip.innerHTML = '';
    const any = hotkeys.some((h) => h.text);
    if (!any) {
      const note = document.createElement('span');
      note.className = 'hknote';
      note.textContent = T('hkEmpty');
      el.hkStrip.appendChild(note);
    }
    hotkeys.forEach((h) => {
      if (!h.text) return;
      const b = document.createElement('button');
      b.className = 'hkchip';
      b.type = 'button';
      b.innerHTML = `<b>${esc(comboLabel(h.combo))}</b><span>${esc(h.label || h.text)}</span>`;
      b.title = h.text;
      b.addEventListener('click', () => insertAtCaret(h.text));
      el.hkStrip.appendChild(b);
    });
    const cfg = document.createElement('button');
    cfg.className = 'hkcfg' + (any ? '' : ' cta');
    cfg.type = 'button';
    cfg.innerHTML = `<b>⚙</b><span>${any ? T('hkSettings') : T('hkSetup')}</span>`;
    cfg.addEventListener('click', openHotkeyModal);
    el.hkStrip.appendChild(cfg);
  }

  // hotkeys fill the composer rather than going straight to air, so the typist can
  // edit or chain fragments before committing with Enter
  function insertAtCaret(text) {
    const v = el.input.value;
    let a = el.input.selectionStart, b = el.input.selectionEnd;
    if (a == null || document.activeElement !== el.input) { a = b = v.length; }
    const needsSpace = a > 0 && !/\s$/.test(v.slice(0, a)) && !/^\s/.test(text);
    const chunk = (needsSpace ? ' ' : '') + text;
    el.input.value = v.slice(0, a) + chunk + v.slice(b);
    const pos = a + chunk.length;
    el.input.focus();
    el.input.setSelectionRange(pos, pos);
    updateCounter();
    emitTyping(true);
  }

  // ---- modal ----
  let draft = [];
  let listeningRow = null;

  function openHotkeyModal() {
    draft = hotkeys.map((h) => ({ ...h }));
    if (!draft.length) draft.push({ combo: '', label: '', text: '' });
    renderDraft();
    el.hkModal.hidden = false;
    const first = el.hkRows.querySelector('input');
    if (first) first.focus();
  }
  function closeHotkeyModal() {
    listeningRow = null;
    el.hkModal.hidden = true;
    el.input.focus();
  }

  function renderDraft() {
    el.hkRows.innerHTML = '';
    draft.forEach((h, i) => {
      const row = document.createElement('div');
      row.className = 'hkrow';

      const bad = h.combo ? blockReason(h.combo) : null;
      const cap = document.createElement('button');
      cap.type = 'button';
      cap.className = 'keycap' + (h.combo ? '' : ' unset') + (bad ? ' bad' : '');
      cap.textContent = comboLabel(h.combo);
      if (bad) cap.title = T(bad);
      cap.addEventListener('click', () => startCapture(i, cap));

      const lab = document.createElement('input');
      lab.value = h.label; lab.placeholder = T('hkLabel'); lab.maxLength = 16;
      lab.addEventListener('input', () => { draft[i].label = lab.value; });

      const txt = document.createElement('input');
      txt.value = h.text; txt.placeholder = T('hkText');
      txt.addEventListener('input', () => { draft[i].text = txt.value; });

      const del = document.createElement('button');
      del.type = 'button'; del.className = 'hkdel'; del.textContent = '✕'; del.title = T('hkDel');
      del.addEventListener('click', () => { draft.splice(i, 1); renderDraft(); });

      row.append(cap, lab, txt, del);
      el.hkRows.appendChild(row);
    });
  }

  function startCapture(i, cap) {
    listeningRow = i;
    el.hkRows.querySelectorAll('.keycap').forEach((c) => c.classList.remove('listening'));
    cap.classList.add('listening');
    cap.textContent = T('hkPress');
  }

  // capture runs on the modal itself so it never leaks into the composer
  el.hkModal.addEventListener('keydown', (e) => {
    if (listeningRow == null) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeHotkeyModal(); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { listeningRow = null; renderDraft(); return; }
    const combo = comboOf(e);
    if (!combo) return;
    if (!comboValid(combo)) { toast(T('hkBadKey'), true); return; }
    const why = blockReason(combo);
    if (why) { toast(`${comboLabel(combo)} — ${T(why)}`, true); return; }
    if (draft.some((h, j) => j !== listeningRow && h.combo === combo)) { toast(T('hkDup'), true); return; }
    draft[listeningRow].combo = combo;
    listeningRow = null;
    renderDraft();
  }, true);

  el.hkAdd.addEventListener('click', () => { draft.push({ combo: '', label: '', text: '' }); renderDraft(); });
  el.hkSave.addEventListener('click', () => {
    saveHotkeys(draft.filter((h) => h.combo && h.text));
    closeHotkeyModal();
    toast(T('hkSaved'));
  });
  el.hkCancel.addEventListener('click', closeHotkeyModal);
  el.hkClose.addEventListener('click', closeHotkeyModal);
  el.hkBack.addEventListener('click', closeHotkeyModal);

  // ---------- composing ----------
  let lastTypingSent = 0, typingTrailer = null;
  function emitTyping(force) {
    const now = Date.now();
    if (typingTrailer) { clearTimeout(typingTrailer); typingTrailer = null; }
    if (!force && now - lastTypingSent < 80) {
      typingTrailer = setTimeout(() => { typingTrailer = null; emitTyping(true); }, 90);
      return;
    }
    lastTypingSent = now;
    conn.emit('typing_update', { text: el.input.value });
  }

  function updateCounter() {
    const n = [...el.input.value].length;
    el.counter.textContent = n;
    const over = n > WARN_CHARS;
    el.counter.classList.toggle('over', over);
    el.input.classList.toggle('warn', over);
  }

  function sendText(text) {
    text = String(text || '').trim();
    if (!text) return;
    if (conn.getStatus() !== 'online') {
      items.push({ kind: 'failed', id: 'fail-' + Date.now() + Math.random(), text, mine: true, ts: Date.now() });
      renderHistory(true);
      toast(T('tFail'), true);
      return;
    }
    conn.emit('subtitle_send', {
      localId: Date.now() + '-' + Math.random().toString(36).slice(2, 7), text,
    });
  }

  function sendInput() {
    const text = el.input.value.trim();
    if (!text) return;
    el.input.value = '';
    updateCounter();
    emitTyping(true);
    sendText(text);
  }

  el.input.addEventListener('input', () => { emitTyping(); updateCounter(); });

  let enterAfterCompose = false;
  el.input.addEventListener('compositionend', () => {
    if (!enterAfterCompose) return;
    enterAfterCompose = false;
    setTimeout(() => sendInput(), 0);
  });

  // hotkeys must fire regardless of where focus sits, but never inside the settings modal
  window.addEventListener('keydown', (e) => {
    if (!el.hkModal.hidden) return;
    const combo = comboOf(e);
    if (!combo) return;
    const hit = hotkeys.find((h) => h.combo === combo && h.text);
    if (!hit || blockReason(combo)) return;
    e.preventDefault();
    insertAtCaret(hit.text);
  });

  el.input.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      if (e.isComposing) { enterAfterCompose = true; return; }
      e.preventDefault();
      sendInput();
      return;
    }
    // Esc hides everything currently on air; Ctrl+Backspace pulls back only my last line.
    // Ctrl+Z is deliberately left to the textarea's own undo.
    if (e.key === 'Escape') {
      e.preventDefault();
      enterAfterCompose = false;
      // escape cancels the smallest thing first: a half-typed line, then the whole screen.
      // without this, one stray Esc mid-sentence would wipe everything on air.
      if (el.input.value) { el.input.value = ''; updateCounter(); emitTyping(true); return; }
      clearScreen();
      return;
    }
    if (mod && e.key === 'Backspace') { e.preventDefault(); revokeLast(); }
  });

  el.btnSend.addEventListener('click', () => sendInput());
  el.btnRevoke.addEventListener('click', revokeLast);
  el.btnClear.addEventListener('click', clearScreen);

  function clearScreen() {
    if (conn.getStatus() !== 'online') { toast(T('tNotOnline'), true); return; }
    if (!onAirIds.size && !items.some((i) => i.kind === 'pending')) return;
    conn.emit('clear_all');
  }

  function revokeLast() {
    const pend = [...items].reverse().find((i) => i.kind === 'pending' && i.mine);
    if (pend) { conn.emit('subtitle_cancel', { pendingId: pend.pendingId }); toast(T('tCancelled')); return; }
    const last = [...items].reverse().find((i) => i.kind === 'sent' && i.mine && !i.revoked && onAirIds.has(i.id));
    if (!last) { toast(T('tNothing'), true); return; }
    conn.emit('subtitle_revoke', { id: last.id });
    toast(T('tRevoked'));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  applyStatic();
  renderAll();
  el.input.focus();
  window.addEventListener('beforeunload', () => conn.emit('typing_update', { text: '' }));
})();
