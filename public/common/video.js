/* Live program feed in the typist panel.

   A browser cannot play SRT or RTMP - there is no decoder for either, and <video src="srt://...">
   is silently ignored. Some media server upstream has to receive the feed once and republish it
   as something a page can read. WHICH server does that is an operational decision that changes
   per venue, so this module does not care: it takes a URL and picks a player from the URL itself.

     *.m3u8          HLS / LL-HLS   hls.js, or the browser's own player where it has one
     ws:// wss://    SLDP           needs the vendor player in /vendor/sldp (not bundled)
     anything else                  iframe - the pre-existing ?video= escape hatch

   Source precedence: ?video= beats config.video.url, so one seat can be pointed somewhere
   else for a test without disturbing the room.

   Audio is the part typists actually work from, but browsers refuse to autoplay a page with
   sound. So playback starts muted and the panel offers a single click to turn sound on. */
(function (global) {
  const HLS_LIB = '/vendor/hls/hls.min.js';
  const SLDP_LIB = '/vendor/sldp/sldp.js';
  const RETRY_MS = 3000;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('missing ' + src));
      document.head.appendChild(s);
    });
  }

  function kindOf(url) {
    if (/^wss?:\/\//i.test(url)) return 'sldp';
    if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
    return 'embed';
  }

  /** mount({ box, placeholder, statusEl, override, t }) */
  function mount(opts) {
    const box = opts.box;
    const ph = opts.placeholder;
    const status = opts.statusEl;
    const t = opts.t || ((k) => k);
    let retryTimer = null;
    let node = null;
    let stopWatchdog = null;

    function setStatus(text, state) {
      if (!status) return;
      status.textContent = text;
      status.removeAttribute('data-i18n');   // stop applyStatic() from overwriting it
      status.dataset.state = state || '';
    }

    // A failure has to say which of the three things went wrong - no feed, no player file,
    // or a feed that dropped - because the fix is different for each.
    function fail(msg, state) {
      teardown();
      ph.hidden = false;
      ph.querySelector('.ph-s').textContent = msg;
      setStatus(t('vSignalLost'), state || 'bad');
    }

    function teardown() {
      if (stopWatchdog) { stopWatchdog(); stopWatchdog = null; }
      if (node && node.destroy) node.destroy();
      if (node && node.el && node.el.parentNode) node.el.remove();
      node = null;
      const btn = box.querySelector('.video-sound');
      if (btn) btn.remove();
    }

    function scheduleRetry() {
      clearTimeout(retryTimer);
      setStatus(t('vRetrying'), 'warn');
      retryTimer = setTimeout(start, RETRY_MS);
    }

    function makeVideo() {
      const v = document.createElement('video');
      v.autoplay = true;
      v.muted = true;              // required, or the browser blocks playback outright
      v.playsInline = true;
      box.insertBefore(v, ph);
      // The autoplay attribute alone is not enough - the element can sit fully buffered and
      // still paused, which leaves the panel reading CONNECTING over a picture that is ready.
      // Asking to play on every canplay is harmless and covers the stall.
      v.addEventListener('canplay', () => v.play().catch(() => {}));
      v.addEventListener('playing', () => {
        ph.hidden = true;
        setStatus(t('vLive'), 'ok');
      });
      // Liveness is judged from the picture, not from the player's error events: a live
      // playlist that starts 404ing is retried forever and never reported as fatal, so the
      // player stays quiet while the panel freezes - and a frozen picture labelled LIVE is
      // worse than no picture, because the typist keeps trusting it.
      ['waiting', 'stalled'].forEach((ev) => {
        v.addEventListener(ev, () => setStatus(t('vRetrying'), 'warn'));
      });
      // Starvation does not always raise an event, so also watch the clock. Never while the
      // tab is hidden: the browser pauses media in a background tab on its own, and calling
      // that a lost signal would flag RECONNECTING every time a typist switches away.
      let lastAt = -1;
      const watchdog = setInterval(() => {
        if (document.hidden || v.paused) return;
        if (lastAt >= 0) setStatus(v.currentTime === lastAt ? t('vRetrying') : t('vLive'),
                                   v.currentTime === lastAt ? 'warn' : 'ok');
        lastAt = v.currentTime;
      }, 2000);
      v.addEventListener('emptied', () => clearInterval(watchdog));
      stopWatchdog = () => clearInterval(watchdog);
      addSoundButton(v);
      return v;
    }

    function addSoundButton(v) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'video-sound';
      btn.textContent = t('vSoundOn');
      btn.addEventListener('click', () => {
        v.muted = false;
        v.volume = 1;
        v.play().catch(() => {});
        btn.remove();
      });
      box.appendChild(btn);
    }

    function startHls(url) {
      const v = makeVideo();
      node = { el: v };
      // Ask hls.js first, never the <video> element. Chrome answers "maybe" to
      // canPlayType('application/vnd.apple.mpegurl') and then plays nothing at all, so
      // trusting that check leaves the panel stuck on CONNECTING with no error.
      loadScript(HLS_LIB).then(() => {
        if (global.Hls && global.Hls.isSupported()) {
          const hls = new global.Hls({ lowLatencyMode: true, backBufferLength: 10 });
          node.destroy = () => hls.destroy();
          hls.on(global.Hls.Events.ERROR, (_e, d) => { if (d.fatal) scheduleRetry(); });
          hls.loadSource(url);
          hls.attachMedia(v);
          return;
        }
        // Safari and iOS decode HLS themselves and have no Media Source to hand hls.js.
        v.src = url;
        v.addEventListener('error', scheduleRetry);
      }).catch(() => fail(t('vNoPlayer', 'hls.js'), 'bad'));
    }

    function startSldp(url) {
      // Deliberately not implemented against a guessed API. The vendor player is not
      // redistributable so it is not committed, and until a copy is on disk its init
      // signature cannot be verified - writing a call from memory would fail silently
      // in front of a typist. Drop sldp.js into public/vendor/sldp/ and wire it here.
      loadScript(SLDP_LIB)
        .then(() => fail(t('vSldpTodo'), 'warn'))
        .catch(() => fail(t('vNoPlayer', 'SLDP'), 'bad'));
    }

    function startEmbed(url) {
      const f = document.createElement('iframe');
      f.src = encodeURI(url);
      f.allow = 'autoplay; fullscreen';
      box.insertBefore(f, ph);
      node = { el: f };
      ph.hidden = true;
      setStatus('EMBED', 'ok');
    }

    let sourceUrl = '';

    function start() {
      teardown();
      if (!sourceUrl) return;
      setStatus(t('vConnecting'), 'warn');
      const kind = kindOf(sourceUrl);
      if (kind === 'hls') startHls(sourceUrl);
      else if (kind === 'sldp') startSldp(sourceUrl);
      else startEmbed(sourceUrl);
    }

    const override = (opts.override || '').trim();
    if (override) {
      sourceUrl = override;
      start();
      return;
    }
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        sourceUrl = ((cfg.video && cfg.video.url) || '').trim();
        if (sourceUrl) start();
      })
      .catch(() => {});
  }

  global.SubVideo = { mount };
})(window);
