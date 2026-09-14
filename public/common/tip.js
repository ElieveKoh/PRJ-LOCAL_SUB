/* Hover explanations for the badges that carry a number.

   The browser's own title tooltip was the obvious choice and it does not work here: it waits
   about a second of perfectly still hovering, it is easy to miss entirely, and some setups
   never show it at all - the pointer turns into a question mark and nothing follows. So the
   page draws its own: it appears quickly, it is styled, and it is always there.

   Mark an element with data-tip="…". Nothing else is needed; elements added later work too,
   because the listeners live on the document. */
(function (global) {
  const SHOW_AFTER = 120;
  let box = null;
  let timer = null;
  let current = null;

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'subtip';
    box.setAttribute('role', 'tooltip');
    document.body.appendChild(box);
    return box;
  }

  function place(el) {
    const b = ensureBox();
    const r = el.getBoundingClientRect();
    const margin = 8;
    b.style.maxWidth = Math.min(300, document.documentElement.clientWidth - margin * 2) + 'px';
    b.style.visibility = 'hidden';
    b.classList.add('on');
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;

    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(margin, Math.min(left, document.documentElement.clientWidth - bw - margin));

    // below by default, above when there is no room - the header sits at the top of the page,
    // so most of these open downwards and the ones near the bottom flip
    let top = r.bottom + 7;
    if (top + bh > document.documentElement.clientHeight - margin) top = r.top - bh - 7;
    if (top < margin) top = margin;

    b.style.left = Math.round(left) + 'px';
    b.style.top = Math.round(top) + 'px';
    b.style.visibility = '';
  }

  function show(el) {
    const text = el.getAttribute('data-tip');
    if (!text) return;
    current = el;
    ensureBox().textContent = text;
    place(el);
  }

  function hide() {
    clearTimeout(timer);
    current = null;
    if (box) box.classList.remove('on');
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el || el === current) return;
    hide();
    clearTimeout(timer);
    timer = setTimeout(() => show(el), SHOW_AFTER);
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    hide();
  });

  // keyboard users get the same text, and any of these gestures means the reader has moved on
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('click', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

  global.SubTip = { hide };
})(window);
