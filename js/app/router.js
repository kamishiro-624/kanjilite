/* KanjiLite – Routing and the signed-in user.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const S = KL.S;
  const { $, app, dlg, esc, guardNow } = KL;
  // From files loaded later; looked up when called.
  const homeView = (...a) => KL.homeView(...a);
  const lessonsView = (...a) => KL.lessonsView(...a);
  const levelsView = (...a) => KL.levelsView(...a);
  const loginView = (...a) => KL.loginView(...a);
  const planView = (...a) => KL.planView(...a);
  const practiceView = (...a) => KL.practiceView(...a);
  const reviewsView = (...a) => KL.reviewsView(...a);
  const searchView = (...a) => KL.searchView(...a);
  const statsView = (...a) => KL.statsView(...a);

  // ---------- routing ----------

  function readUser() {
    try { const x = JSON.parse(localStorage.getItem('kl_user')); return x && x.u && x.u.id ? x : null; } catch (e) { return null; }
  }
  function fetchUser(background) {
    return api.request('/user', { background }).then((r) => {
      S.userCache = { t: Date.now(), u: r.data };
      try { localStorage.setItem('kl_user', JSON.stringify(S.userCache)); } catch (e) { /* ignore */ }
      return r.data;
    });
  }
  const userKnown = () => !!(S.userCache || readUser());

  /**
   * Who you are and your level. Answered from the saved copy straight away; if that copy is more than a few
   * minutes old it is refreshed quietly in the background. Only the very first call waits for the network.
   */
  async function getUser(force) {
    if (!S.userCache) S.userCache = readUser();
    if (force || !S.userCache) return fetchUser(false);
    if (Date.now() - S.userCache.t > 5 * 60000 && !S.userRefresh) {
      const before = S.userCache.u.level;
      S.userRefresh = fetchUser(true)
        .then((u) => { if (u.level !== before && S.onUserChange) S.onUserChange(); })
        .catch(syncFailed)
        .finally(() => { S.userRefresh = null; });
    }
    return S.userCache.u;
  }

  // A background sync that finds the token revoked sends you to the login screen; any other failure is ignored
  // (the saved data keeps working and the next sync tries again).
  function syncFailed(err) {
    if (err && err.status === 401 && api.token) {
      api.token = ''; S.userCache = null;
      try { localStorage.removeItem('kl_user'); } catch (e) { /* ignore */ }
      loginView(err.message);
    }
  }

  /**
   * Make the saved copy of your WaniKani data ready: the first time on this device it is downloaded (with a
   * progress count); after that it is used as it is and refreshed quietly in the background.
   */
  async function ensureLocal() {
    await Local.ready;
    const user = await getUser();
    await Local.bind(user);
    Stats.bind(user.id); // so reviews recorded from here on are saved under this account
    if (!Local.hasData()) {
      const el = $('#app .muted');
      if (el) { el.textContent = 'Setting up your account…'; el.dataset.setup = ''; }
      await Local.refresh({
        interactive: true, minAge: 0,
        onProgress: (n) => { const p = $('#app .muted[data-setup]'); if (p) p.textContent = `Setting up your account… ${n} items so far`; },
      });
    } else {
      Local.refresh().catch(syncFailed);
    }
    Local.prefetchSubjects(user).catch(() => {}); // quiet, low priority, once per visit
    // Review notifications run on every screen, not just the dashboard (no-op if already started or switched off).
    Notify.start({
      summary: () => Local.summary(), sync: () => Local.refresh({ minAge: 60000 }), subscribe: Local.subscribe,
      guard: async () => { const r = await guardNow(); return r ? Guard.toPush(r) : null; },
    });
    return user;
  }

  function route() {
    const my = ++S.routeSeq;
    if (S.cleanup) { S.cleanup(); S.cleanup = null; }
    UI.closeSelect();
    if (dlg.open) dlg.close();
    window.scrollTo(0, 0);
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const name = parts[0] || 'home';
    $('#nav').hidden = !api.token;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', (a.dataset.nav || 'home') === name));
    if (!api.token) return loginView();
    const views = { home: homeView, reviews: reviewsView, lessons: lessonsView, levels: levelsView, stats: statsView, search: searchView, plan: planView, practice: practiceView };
    (views[name] || homeView)(my, parts[1]).catch((err) => fail(err, my));
  }
  window.addEventListener('hashchange', route);

  function fail(err, my) {
    if (my !== S.routeSeq) return;
    if (err && err.status === 401) { api.token = ''; S.userCache = null; try { localStorage.removeItem('kl_user'); } catch (e) { /* ignore */ } return loginView(err.message); }
    app.innerHTML = `<div class="wrap center"><h1>Something went wrong</h1><p class="error">${esc(err && err.message ? err.message : err)}</p>
      <div class="row" style="justify-content:center"><button class="btn" id="retry">Try again</button><a class="btn ghost" href="#/">Home</a></div></div>`;
    $('#retry').onclick = route;
  }

  Object.assign(KL, { ensureLocal, getUser, route, syncFailed, userKnown });
})(window.KL);
