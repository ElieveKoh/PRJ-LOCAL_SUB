(function () {
  const $ = (id) => document.getElementById(id);
  const el = {
    stage: $('stage'), safe: $('safe'), queue: $('queue'), offdot: $('offdot'),
    chrome: $('chrome'), peers: $('peers'), panel: $('panel'), panelBody: $('panelBody'),
    btnGear: $('btnGear'), btnFull: $('btnFull'), btnClose: $('btnClose'),
    genUrl: $('genUrl'), btnCopy: $('btnCopy'), btnReset: $('btnReset'), btnPreview: $('btnPreview'),
  };

  const conn = SubSocket.connect({ role: 'broadcast' });
  let S = {};            // resolved settings
  let DEF = {};          // config defaults
  let fromUrl = new Set();
  let lines = [];        // { id, text, bornAt, minUntil, node }
  let peerList = [];
  let lastPushAt = 0;

  document.title = `[${conn.lang}] 자막 송출`;

  // The page may be rendered on a machine we do not control (a switcher PC, or a cloud
  // renderer), which will not have Korean/Japanese/Chinese fonts installed. Ship the face
  // with the page instead of hoping the host has it - otherwise subtitles render as tofu.
  // This is a networked tool, so the fetch is fine; what it must not be is load-bearing.
  // If it is slow, blocked by a corporate proxy, or simply fails, the fallback chain in
  // config.json names a real CJK face for every OS and the picture still goes out.
  const WEBFONT = { ko: 'Noto+Sans+KR', ja: 'Noto+Sans+JP', zh: 'Noto+Sans+SC' };
  (function loadFont() {
    const fam = WEBFONT[conn.lang];
    if (!fam) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${fam}:wght@400;500;700;900&display=swap`;
    document.head.appendChild(l);
  })();

  const FIELDS = [
    ['배경', [
      ['bgMode', 'select', { options: [['chroma', '크로마키'], ['solid', '단색'], ['transparent', '투명(알파)']] }],
      ['bgColor', 'color'],
      ['safeArea', 'select', { options: [['fit', '창에 맞춤'], ['1080', '1920×1080 고정'], ['720', '1280×720 고정']] }],
    ]],
    ['텍스트', [
      ['textColor', 'color'],
      ['outlineColor', 'color'],
      ['outlineWidth', 'range', { min: 0, max: 8, step: 1, unit: 'px' }],
      ['fontFamily', 'text'],
      ['fontSize', 'range', { min: 16, max: 140, step: 1, unit: 'px' }],
      ['fontWeight', 'range', { min: 300, max: 900, step: 100 }],
      ['letterSpacing', 'range', { min: -4, max: 12, step: .5, unit: 'px' }],
      ['lineHeight', 'range', { min: 1, max: 2.4, step: .05 }],
    ]],
    ['레이아웃', [
      ['align', 'select', { options: [['center', '가운데'], ['left', '왼쪽'], ['right', '오른쪽']] }],
      ['paddingX', 'range', { min: 0, max: 400, step: 4, unit: 'px' }],
      ['paddingY', 'range', { min: 0, max: 400, step: 4, unit: 'px' }],
    ]],
    ['큐 동작', [
      ['baseLines', 'range', { min: 1, max: 4, step: 1, unit: '줄' }],
      ['maxLines', 'range', { min: 1, max: 6, step: 1, unit: '줄' }],
      ['minDurationMs', 'range', { min: 0, max: 8000, step: 100, unit: 'ms' }],
      ['shrinkIdleMs', 'range', { min: 0, max: 8000, step: 100, unit: 'ms' }],
      ['fadeMs', 'range', { min: 0, max: 1200, step: 25, unit: 'ms' }],
    ]],
  ];
  const LABEL = {
    bgMode: '배경 모드', bgColor: '배경색', safeArea: '캔버스', textColor: '글자색',
    outlineColor: '외곽선색', outlineWidth: '외곽선', fontFamily: '폰트', fontSize: '크기',
    fontWeight: '굵기', letterSpacing: '자간', lineHeight: '행간', align: '정렬',
    paddingX: '좌우 여백', paddingY: '상하 여백', baseLines: '기본 줄수', maxLines: '최대 줄수',
    minDurationMs: '최소 노출', shrinkIdleMs: '축소 대기', fadeMs: '페이드',
  };

  // ---------------- settings ----------------
  fetch('/api/config').then((r) => r.json()).then((cfg) => {
    DEF = cfg.defaultSettings;
    const r = SubSettings.resolve(DEF, conn.lang, conn.params);
    S = r.settings;
    fromUrl = r.fromUrl;
    applySettings();
    buildPanel();
  });

  function applySettings() {
    const st = el.stage.style;
    const alpha = S.bgMode === 'transparent';
    el.stage.classList.toggle('transparent', alpha);
    document.documentElement.classList.toggle('alpha', alpha);
    st.setProperty('--bg', S.bgMode === 'solid' ? S.bgColor : S.bgColor);
    const q = el.queue.style;
    q.setProperty('--fg', S.textColor);
    q.setProperty('--ff', S.fontFamily);
    q.setProperty('--fs', S.fontSize + 'px');
    q.setProperty('--fw', S.fontWeight);
    q.setProperty('--lsp', S.letterSpacing + 'px');
    q.setProperty('--lh', S.lineHeight);
    q.setProperty('--px', S.paddingX + 'px');
    q.setProperty('--py', S.paddingY + 'px');
    q.setProperty('--fade', S.fadeMs + 'ms');
    q.setProperty('--stroke', outlineShadow(S.outlineWidth, S.outlineColor));
    el.queue.className = 'queue align-' + (S.align || 'center');
    applySafeArea();
  }

  // a black halo around glyphs is what kills chroma-key green spill
  function outlineShadow(w, color) {
    w = Number(w) || 0;
    if (!w) return 'none';
    const out = [];
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      out.push(`${(Math.cos(a) * w).toFixed(2)}px ${(Math.sin(a) * w).toFixed(2)}px 0 ${color}`);
    }
    out.push(`0 0 ${w * 2}px ${color}`);
    return out.join(',');
  }

  // safeArea 'fit' = fill the window; '1080'/'720' = fixed canvas scaled to fit,
  // so subtitle geometry never shifts when the capture window resizes.
  function applySafeArea() {
    const mode = String(S.safeArea || 'fit');
    if (mode === 'fit') {
      el.safe.classList.remove('fixed');
      el.safe.style.transform = '';
      return;
    }
    const h = mode === '720' ? 720 : 1080;
    const w = Math.round(h * 16 / 9);
    el.safe.classList.add('fixed');
    el.safe.style.width = w + 'px';
    el.safe.style.height = h + 'px';
    const scale = Math.min(window.innerWidth / w, window.innerHeight / h);
    el.safe.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', () => { if (S.safeArea) applySafeArea(); });

  // ---------------- smart queue ----------------
  function push(line) {
    const node = document.createElement('div');
    node.className = 'line enter';
    node.textContent = line.text;
    el.queue.appendChild(node);
    // Force a reflow instead of requestAnimationFrame: rAF is throttled to a standstill when the
    // broadcast window is backgrounded, which would leave every line stuck at opacity 0.
    void node.offsetHeight;
    node.classList.remove('enter');

    const now = Date.now();
    lines.push({ id: line.id, text: line.text, bornAt: now, minUntil: now + Number(S.minDurationMs || 0), node });
    lastPushAt = now;

    // overflow roll-up ignores minDuration on purpose: a backed-up queue must drain
    while (lines.length > Number(S.maxLines || 4)) remove(lines[0]);
    reportOnAir();
  }

  function remove(item) {
    const i = lines.indexOf(item);
    if (i < 0) return;
    lines.splice(i, 1);
    item.node.classList.add('leave');
    setTimeout(() => item.node.remove(), Number(S.fadeMs || 250));
    reportOnAir();
  }

  // let the typists mirror exactly what the audience sees
  let onAirT = null;
  function reportOnAir() {
    clearTimeout(onAirT);
    onAirT = setTimeout(() => {
      conn.emit('onair', { ids: lines.map((l) => l.id), texts: lines.map((l) => l.text) });
    }, 60);
  }

  setInterval(() => {
    if (!lines.length) return;
    const now = Date.now();
    const base = Number(S.baseLines || 2);
    const idle = now - lastPushAt;

    // shrink back to baseLines once input stops
    if (lines.length > base && idle > Number(S.shrinkIdleMs || 1500)) {
      if (now > lines[0].minUntil) { remove(lines[0]); return; }
    }
    // then retire the rest, oldest first, once they have had their minimum on screen
    if (idle > Number(S.shrinkIdleMs || 1500) + Number(S.minDurationMs || 2500)) {
      if (now > lines[0].minUntil) remove(lines[0]);
    }
  }, 250);

  // ---------------- socket ----------------
  conn.on('state_sync', (st) => {
    el.queue.innerHTML = '';
    lines = [];
    (st.lines || []).forEach(push);
  });
  conn.on('subtitle_new', push);
  conn.on('subtitle_revoke', (d) => {
    const it = lines.find((l) => l.id === d.id);
    if (it) remove(it);
  });
  conn.on('clear_all', () => { lines.slice().forEach(remove); reportOnAir(); });
  conn.on('peers', (list) => renderPeers(list));
  conn.onStatus((s) => {
    el.offdot.hidden = s === 'online';
    if (s === 'unauthorized') showAuthError();
    renderPeers();
  });

  // A switcher cannot type a password, so say what is wrong right on the output surface.
  function showAuthError() {
    if (document.getElementById('authErr')) return;
    const d = document.createElement('div');
    d.id = 'authErr';
    d.style.cssText = 'position:fixed;inset:0;z-index:90;display:flex;align-items:center;'
      + 'justify-content:center;background:#111;color:#ff8a8e;font-size:20px;text-align:center;'
      + 'font-family:-apple-system,sans-serif;padding:24px;line-height:1.6';
    d.textContent = '비밀번호가 필요합니다 — 주소 끝에 ?pw=... 를 붙여 주세요';
    document.body.appendChild(d);
  }

  function renderPeers(list) {
    if (list) peerList = list;
    el.peers.innerHTML = '';
    peerList.forEach((p) => {
      const d = document.createElement('div');
      d.className = 'peer ' + (p.rttMs > 300 ? 'slow' : '');
      d.innerHTML = `<span class="led"></span>${esc(p.name)} <span style="opacity:.6">${p.role === 'broadcast' ? 'BC' : 'TY'}</span>`;
      el.peers.appendChild(d);
    });
  }

  // ---------------- hover chrome ----------------
  let hideT = null;
  window.addEventListener('mousemove', () => {
    document.body.classList.add('hover');
    clearTimeout(hideT);
    hideT = setTimeout(() => { if (el.panel.hidden) document.body.classList.remove('hover'); }, 2000);
  });
  el.btnGear.addEventListener('click', () => { el.panel.hidden = false; refreshUrl(); });
  el.btnClose.addEventListener('click', () => { el.panel.hidden = true; });
  el.btnFull.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });

  // ---------------- settings panel + URL builder ----------------

  function buildPanel() {
    el.panelBody.innerHTML = '';
    FIELDS.forEach(([title, rows]) => {
      const g = document.createElement('div');
      g.className = 'grp';
      g.innerHTML = `<h4>${title}</h4>`;
      rows.forEach(([key, type, opt]) => g.appendChild(field(key, type, opt || {})));
      el.panelBody.appendChild(g);
    });
    refreshUrl();
  }

  function field(key, type, opt) {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = LABEL[key] || key;
    row.appendChild(lab);

    let input;
    if (type === 'select') {
      input = document.createElement('select');
      opt.options.forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        input.appendChild(o);
      });
    } else if (type === 'color') {
      input = document.createElement('input');
      input.type = 'color';
    } else if (type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.min = opt.min; input.max = opt.max; input.step = opt.step;
    } else if (type === 'text') {
      input = document.createElement('input');
      input.type = 'text';
    } else {
      input = document.createElement('input');
      input.type = 'text';
    }
    input.value = S[key];
    row.appendChild(input);

    // a slider alone cannot hit an exact value - pair every range with a typed number box
    let num = null;
    if (type === 'range') {
      num = document.createElement('input');
      num.type = 'number';
      num.className = 'numbox';
      num.min = opt.min; num.max = opt.max; num.step = opt.step;
      num.value = S[key];
      row.appendChild(num);
      if (opt.unit) {
        const u = document.createElement('span');
        u.className = 'unit';
        u.textContent = opt.unit;
        row.appendChild(u);
      }
    }

    const val = document.createElement('span');
    val.className = 'val' + (fromUrl.has(key) ? ' url' : '');
    val.textContent = fromUrl.has(key) ? 'URL' : '';
    if (!fromUrl.has(key)) val.style.flex = '0 0 0';
    row.appendChild(val);

    function commit(raw, from) {
      let v = (type === 'range') ? Number(raw) : raw;
      if (type === 'range') {
        if (!Number.isFinite(v)) return;
        v = Math.min(Number(opt.max), Math.max(Number(opt.min), v));
      }
      S[key] = v;
      if (from !== 'range' && input) input.value = v;
      if (from !== 'num' && num) num.value = v;
      SubSettings.writeStore(conn.lang, S);
      applySettings();
      refreshUrl();
    }

    input.addEventListener('input', () => commit(input.value, 'range'));
    if (num) {
      // apply while typing, but only rewrite the box on commit - clamping mid-keystroke
      // would stop you from typing "120" when the minimum is 16
      num.addEventListener('input', () => { if (num.value !== '') commit(num.value, 'num'); });
      const normalize = () => { num.value = S[key]; };
      num.addEventListener('blur', () => { commit(num.value === '' ? S[key] : num.value, 'num'); normalize(); });
      num.addEventListener('change', normalize);
      num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { num.blur(); } });
    }
    return row;
  }

  function refreshUrl() {
    el.genUrl.value = SubSettings.buildUrl('/broadcast', conn.lang, S, DEF);
  }

  el.btnCopy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(el.genUrl.value); toast('URL을 복사했습니다'); }
    catch (e) { el.genUrl.select(); toast('복사 실패 — 직접 선택해 복사하세요'); }
  });
  el.btnReset.addEventListener('click', () => {
    SubSettings.clearStore(conn.lang);
    S = Object.assign({}, DEF);
    fromUrl = new Set();
    applySettings();
    buildPanel();
    toast('기본값으로 되돌렸습니다');
  });
  el.btnPreview.addEventListener('click', () => {
    const samples = ['미리보기 자막입니다.', '두 번째 줄이 이렇게 쌓입니다.',
                     '세 번째 줄 — 최대 줄수를 넘으면 위가 밀려납니다.', '네 번째 줄까지 확장됩니다.'];
    samples.forEach((t, i) => setTimeout(() => push({ id: 'prev' + Date.now() + i, text: t }), i * 600));
  });

  function toast(msg) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2200);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------- S6: extension stubs (not implemented) ----------------
  window.SubExt = {
    mountPlayer(/* el, cfg */) { console.info('[stub] mountPlayer — RTMP/SRT 연동 예정'); },
    translate(/* text, src, dst */) { console.info('[stub] translate — 기계번역 연동 예정'); return null; },
  };
})();
