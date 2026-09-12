/* Settings resolution: URL params > localStorage > config.json defaults.
   URL wins because the output software only opens a URL and cannot touch the page. */
(function (global) {
  const NUM = new Set(['fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'paddingX', 'paddingY',
                       'baseLines', 'maxLines', 'minDurationMs', 'shrinkIdleMs', 'fadeMs', 'outlineWidth']);
  // short aliases accepted in the URL
  const ALIAS = {
    size: 'fontSize', weight: 'fontWeight', ls: 'letterSpacing', lh: 'lineHeight',
    px: 'paddingX', py: 'paddingY', bg: 'bgColor', fg: 'textColor',
    minDuration: 'minDurationMs', shrinkIdle: 'shrinkIdleMs', fade: 'fadeMs',
    outline: 'outlineWidth', safe: 'safeArea', lines: 'maxLines', base: 'baseLines',
  };

  function storageKey(lang) { return `sub.broadcast.${lang}`; }

  function readStore(lang) {
    try { return JSON.parse(localStorage.getItem(storageKey(lang)) || '{}'); } catch (e) { return {}; }
  }
  function writeStore(lang, obj) {
    try { localStorage.setItem(storageKey(lang), JSON.stringify(obj)); } catch (e) {}
  }
  function clearStore(lang) {
    try { localStorage.removeItem(storageKey(lang)); } catch (e) {}
  }

  function coerce(key, raw) {
    if (raw == null || raw === '') return undefined;
    if (NUM.has(key)) { const n = Number(raw); return Number.isFinite(n) ? n : undefined; }
    return String(raw);
  }

  /** resolve(defaults, lang, params) -> { settings, fromUrl:Set } */
  function resolve(defaults, lang, params) {
    const out = Object.assign({}, defaults, readStore(lang));
    const fromUrl = new Set();
    params.forEach((raw, rawKey) => {
      const key = ALIAS[rawKey] || rawKey;
      if (!(key in defaults)) return;
      const v = coerce(key, raw);
      if (v === undefined) return;
      out[key] = v;
      fromUrl.add(key);
    });
    return { settings: out, fromUrl };
  }

  /** buildUrl(base, lang, settings, defaults) - only non-default keys go in the URL */
  function buildUrl(base, lang, settings, defaults) {
    const u = new URL(base, location.origin);
    u.searchParams.set('lang', lang);
    Object.keys(defaults).forEach((k) => {
      if (settings[k] !== undefined && String(settings[k]) !== String(defaults[k])) {
        u.searchParams.set(k, settings[k]);
      }
    });
    return u.toString();
  }

  global.SubSettings = { resolve, buildUrl, readStore, writeStore, clearStore, storageKey, ALIAS };
})(window);
