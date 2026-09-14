/* Company wordmark.
   The image is a brand asset and is deliberately not committed, so a fresh clone of the
   public repo does not have it. Every page therefore has to look right WITHOUT it:
   the src is attached only after the error handler, and a missing file removes the node
   rather than leaving a broken-image icon in the header. */
(function () {
  document.querySelectorAll('img.brandlogo').forEach((img) => {
    img.addEventListener('error', () => {
      // take the divider with it, or a clone without the asset shows a rule against nothing
      const sep = img.nextElementSibling;
      if (sep && sep.classList.contains('brand-sep')) sep.remove();
      img.remove();
    });
    img.src = '/assets/kiswe-logo.png';
  });
})();
