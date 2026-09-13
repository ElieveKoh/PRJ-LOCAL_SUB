/* Shared socket bootstrap for both views.
   URL params are the single source of truth: the output software only opens a URL and
   cannot reach the page's own settings. */
(function (global) {
  const params = new URLSearchParams(location.search);
  const NAME_KEY = 'sub.typist.name';
  const CID_KEY = 'sub.clientId';

  // Identity is per TAB, not per browser: sessionStorage survives reloads (so restored history
  // still reads as mine) but is not shared with another tab, so two typists on one machine -
  // or one person testing both seats - are correctly seen as two different people.
  function clientId() {
    try {
      let v = sessionStorage.getItem(CID_KEY);
      if (!v) {
        v = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        sessionStorage.setItem(CID_KEY, v);
      }
      return v;
    } catch (e) { return 'c' + Math.random().toString(36).slice(2, 10); }
  }

  const lang = params.get('lang') || 'ko';

  // ?name= wins, then this tab's own name, then the browser-wide default from the landing page.
  // The per-tab layer is what stops two tabs from overwriting each other's name.
  function resolveName(role) {
    if (role === 'broadcast') return 'BROADCAST';
    const fromUrl = (params.get('name') || '').trim();
    if (fromUrl) {
      try { sessionStorage.setItem(NAME_KEY, fromUrl); } catch (e) {}
      return fromUrl;
    }
    try {
      const tab = (sessionStorage.getItem(NAME_KEY) || '').trim();
      if (tab) return tab;
      return (localStorage.getItem(NAME_KEY) || '').trim();
    } catch (e) { return ''; }
  }

  /** connect({ role }) -> { socket, lang, name, on, emit, onStatus } */
  function connect(opts) {
    const role = opts && opts.role === 'broadcast' ? 'broadcast' : 'typist';
    const name = resolveName(role);
    const socket = io({ reconnectionDelay: 500, reconnectionDelayMax: 2000 });
    const statusHandlers = [];
    let status = 'connecting';

    function setStatus(s) {
      if (status === s) return;
      status = s;
      statusHandlers.forEach((fn) => fn(s));
    }

    socket.on('connect', () => {
      socket.emit('join', {
        lang, role, name, cid: clientId(),
        pw: (global.SubAuth ? global.SubAuth.token() : ''),
      });
      setStatus('online');
    });
    socket.on('disconnect', () => setStatus('offline'));
    socket.on('auth_failed', () => setStatus('unauthorized'));
    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));

    // round-trip measurement drives the connection LED
    setInterval(() => {
      if (!socket.connected) return;
      const t0 = performance.now();
      socket.timeout(3000).emit('rtt', (err) => {
        if (err) return;
        socket.emit('rtt_report', Math.round(performance.now() - t0));
      });
    }, 2000);

    return {
      socket,
      lang,
      name,
      role,
      cid: clientId(),
      param: (k, d) => (params.has(k) ? params.get(k) : d),
      params,
      on: (ev, fn) => socket.on(ev, fn),
      emit: (ev, payload) => socket.emit(ev, payload),
      onStatus: (fn) => { statusHandlers.push(fn); fn(status); },
      getStatus: () => status,
    };
  }

  global.SubSocket = { connect, lang, params };
})(window);
