/* Password gate shared by all three pages.
   The switcher cannot type, so the output page takes the password from ?pw= instead. */
(function (global) {
  const KEY = 'sub.pw';
  const params = new URLSearchParams(location.search);

  function stored() {
    try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function token() {
    const fromUrl = params.get('pw');
    if (fromUrl) { save(fromUrl, false); return fromUrl; }
    return stored();
  }
  function save(pw, remember) {
    try {
      sessionStorage.setItem(KEY, pw);
      if (remember) localStorage.setItem(KEY, pw); else localStorage.removeItem(KEY);
    } catch (e) {}
  }
  function clear() {
    try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch (e) {}
  }
  async function verify(pw) {
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pw }),
      });
      return r.ok;
    } catch (e) { return false; }
  }

  /** gate({title, note}) -> Promise<string>  resolves with the accepted password */
  function gate(opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'sub-gate';
      wrap.innerHTML = `
        <form class="sub-gate-box" autocomplete="off">
          <h1>${esc(o.title || '자막 시스템')}</h1>
          <p>${esc(o.note || '계속하려면 비밀번호를 입력하세요.')}</p>
          <input id="subGatePw" type="password" placeholder="비밀번호" autocomplete="current-password" autofocus>
          <label class="sub-gate-remember">
            <input id="subGateRemember" type="checkbox"> 이 브라우저에 기억하기
          </label>
          <button type="submit">들어가기</button>
          <span class="sub-gate-err" id="subGateErr"></span>
        </form>`;
      document.body.appendChild(wrap);

      const form = wrap.querySelector('form');
      const pw = wrap.querySelector('#subGatePw');
      const remember = wrap.querySelector('#subGateRemember');
      const err = wrap.querySelector('#subGateErr');
      setTimeout(() => pw.focus(), 50);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = pw.value;
        if (!v) return;
        err.textContent = '';
        form.classList.add('busy');
        const ok = await verify(v);
        form.classList.remove('busy');
        if (!ok) {
          err.textContent = '비밀번호가 맞지 않습니다.';
          pw.select();
          return;
        }
        save(v, remember.checked);
        wrap.remove();
        resolve(v);
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Show the gate only when the server actually requires one and we have no working token. */
  async function ensure(opts) {
    let cfg = {};
    try { cfg = await fetch('/api/config').then((r) => r.json()); } catch (e) {}
    if (!cfg.authRequired) return '';
    const have = token();
    if (have && await verify(have)) return have;
    clear();
    return gate(opts);
  }

  global.SubAuth = { token, save, clear, verify, gate, ensure };
})(window);
