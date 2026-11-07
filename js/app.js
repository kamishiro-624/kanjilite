/* KanjiLite – a small, unofficial WaniKani client. No build step, no dependencies.
   Entry point. The app itself lives in js/app/*.js (loaded first, in the order index.html lists them);
   each file shares what other files need through the window.KL object. */
(function (KL) {
  'use strict';
  const { flushBg, route, syncFailed } = KL;

  // Coming back to the tab (or the phone waking up): send anything waiting and pick up changes made elsewhere.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !api.token || !Local.hasData()) return;
    Local.refresh({ minAge: 2 * 60000 }).catch(syncFailed);
    if (api.pending().length || api.pendingStarts().length) flushBg();
  });

  // ---------- go ----------
  Sync.start();
  Sync.preload();
  route();
})(window.KL);
