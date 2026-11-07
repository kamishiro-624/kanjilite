/* KanjiLite – Keeping your data: Keep (browser storage guard) and Backup.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const { $, app, settings, toast } = KL;

  // ---------- keeping your data ----------
  /** Ask the browser not to evict this site's data (plan, settings, saved copy) when it clears space. */
  const Keep = {
    async request() {
      try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) { /* not supported */ }
    },
    async status() {
      try {
        if (!(navigator.storage && navigator.storage.persisted)) return '';
        return (await navigator.storage.persisted())
          ? 'This browser has agreed to keep KanjiLite’s data.'
          : 'This browser may still clear KanjiLite’s data (for example in private windows or when it frees space). A backup file is the safe way to keep your plan.';
      } catch (e) { return ''; }
    },
  };
  window.Keep = Keep;

  /** A file with your plan and settings (and, only if asked, your token) that can be loaded back later. */
  const Backup = {
    skip: (k) => (window.Sync ? Sync.isVolatile(k) : /^(kl_(req_log|blocked_until|pending_reviews|pending_starts|session|user|notify_armed)$|kl_kanji_total_)/.test(k)),
    save(withToken) {
      const data = {};
      Object.keys(localStorage).filter((k) => k.startsWith('kl_') && !Backup.skip(k) && (withToken || k !== 'kl_token')).forEach((k) => { data[k] = localStorage.getItem(k); });
      const blob = new Blob([JSON.stringify({ app: 'kanjilite', v: 1, saved: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kanjilite-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(withToken ? 'Backup saved. It contains your API token, so keep it private.' : 'Backup saved.');
    },
    async restore(file) {
      let parsed;
      try { parsed = JSON.parse(await file.text()); } catch (e) { parsed = null; }
      const entries = parsed && parsed.app === 'kanjilite' && parsed.data && typeof parsed.data === 'object'
        ? Object.entries(parsed.data).filter(([k, v]) => k.startsWith('kl_') && !Backup.skip(k) && typeof v === 'string')
        : null;
      if (!entries || !entries.length) { toast('That file is not a KanjiLite backup.'); return; }
      const ok = await UI.confirm({
        title: 'Restore this backup?',
        message: 'Your plan and settings in this browser will be replaced by the ones in the file' + (entries.some(([k]) => k === 'kl_token') ? ', and you will be logged in with the token it contains' : '') + '.',
        ok: 'Restore',
      });
      if (!ok) return;
      try { entries.forEach(([k, v]) => localStorage.setItem(k, v)); } catch (e) { toast('The browser would not let KanjiLite save that.'); return; }
      toast('Backup restored.');
      setTimeout(() => location.reload(), 600);
    },
  };

  Object.assign(KL, { Backup, Keep });
})(window.KL);
