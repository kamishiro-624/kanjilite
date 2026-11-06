/* Keeps the layout usable when the on-screen keyboard is open.
   - Publishes the visible height as --vvh and flags <html class="kb-open"> while a keyboard is up.
   - iOS shifts the visual viewport instead of resizing the page; the top bar is nudged down so it stays in view,
     and the quiz (which sits at the top of the page) is scrolled back to the top. */
(function () {
  'use strict';
  var vv = window.visualViewport;
  var root = document.documentElement;
  if (!vv) return;
  var base = window.innerHeight;
  function update() {
    // Remember the tallest height seen (rotation resets it) so we can tell "keyboard open" from "just a small window".
    if (window.innerHeight > base || Math.abs(window.innerWidth - (update.w || window.innerWidth)) > 50) base = window.innerHeight;
    update.w = window.innerWidth;
    var lost = Math.max(base - vv.height, 0);
    var kb = lost > 120 && /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '');
    root.classList.toggle('kb-open', kb);
    root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
    root.style.setProperty('--vvt', (kb ? Math.round(vv.offsetTop) : 0) + 'px');
    // Only snap back to the top while the answer box itself is focused. Typing in a synonym or note box (down in
    // the details) must be left alone, otherwise the page keeps jumping away from what you're typing.
    var ae = document.activeElement;
    var inAnswer = ae && ae.id === 'q-input';
    if (kb && inAnswer && document.body.classList.contains('in-quiz') && window.scrollY) window.scrollTo(0, 0);
  }
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  window.addEventListener('orientationchange', function () { setTimeout(function () { base = window.innerHeight; update(); }, 300); });
  document.addEventListener('focusin', function (e) {
    setTimeout(update, 50);
    // A note/synonym box inside the details: bring it above the keyboard once, after the keyboard has opened.
    var t = e.target;
    if (t && t.closest && t.closest('.mat-box') && /^(INPUT|TEXTAREA)$/.test(t.tagName)) {
      setTimeout(function () { try { t.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (err) { /* ignore */ } }, 350);
    }
  });
  document.addEventListener('focusout', function () { setTimeout(update, 150); });
  update();
})();
