/* KanjiLite – The home (dashboard) view.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const S = KL.S;
  const { $, Keep, Session, app, ensureLocal, esc, flushBg, guardContext, loading, openModal, openSettings, setPracticeMode, setPracticeOrder, setPracticeSize, setSessionSize, settings, signInToSync, syncFailed, tile, toast, userKnown } = KL;

  // ---------- home ----------
  // Everything on this screen is worked out from the saved copy of your data, so it opens instantly, costs no
  // requests, and keeps itself current (counts change as reviews become due, uploads finish, syncs arrive).
  async function homeView(my) {
    const stale = () => my !== S.routeSeq;
    if (!Local.hasData() || !userKnown()) loading('Setting up your account…');
    const user = await ensureLocal();
    if (stale()) return;

    const hourLabel = (iso) => {
      const d = new Date(iso);
      const sameDay = d.toDateString() === new Date().toDateString();
      return d.toLocaleString([], sameDay ? { hour: 'numeric' } : { weekday: 'short', hour: 'numeric' });
    };
    let shown = '';
    let progressHtml = '';
    let numbersHtml = '';
    let critHtml = '';
    let planHtml = '';
    let todayHtml = '';
    let guardHtml = '';
    let guardRes = null;
    let announced = false;
    let practiceHtml = '';
    let spreadHtml = '';
    let editing = false; // the dashboard is being customized: every widget shows its controls (hidden ones too)
    let busy = false; // a widget is being dragged or resized: the screen must not be rebuilt under the pointer
    Stats.bind(user.id);
    // What the widgets below the progress bars are built from. Filled from the saved copies first, refreshed in the background.
    const X = { lp: null, hist: null, rs: null, rsSummary: null, subs: new Map(), progress: null, levelIds: null, loaded: false, lpLevel: null };

    // The inside of one widget at a level of detail (1 brief, 2 standard, 3 detailed). The dashboard uses the saved level;
    // the preview in the gear menu asks for others. Widgets whose detail only hides notes are done in css (data-min).
    function bodyHtml(id, v, sd) {
      switch (id) {
        case 'guard': return `<div class="dw-body" id="dash-guard">${v === Layout.get().cfg.guard.v ? guardHtml : guardFor(v)}</div>`;
        case 'plan': return `<div class="dw-body" id="dash-plan">${planHtml}</div>`;
        case 'today': return `<div class="dw-body" id="dash-today">${todayHtml}</div>`;
        case 'todo': return `<div class="dw-body todo">
          <a class="reviews${sd.reviews ? '' : ' off'}" href="#/reviews"><span class="what">Reviews</span><span class="count">${sd.reviews}</span></a>
          <a class="lessons${sd.lessons ? '' : ' off'}" href="#/lessons"><span class="what">Lessons</span><span class="count">${sd.lessons}</span></a>
        </div>`;
        case 'session': return `<div class="dw-body"><div class="panel session-panel">
          <label for="h-size"><b>Reviews per session</b></label>
          ${UI.stepperHTML('h-size', settings.sessionSize, { min: 0, max: 5000, step: 5, label: 'Reviews per session' })}
          <span class="muted" data-min="2">0 means everything that’s due. <button class="link inline" id="h-more" type="button">More study options</button></span>
        </div></div>`;
        case 'practice': return `<div class="dw-body" id="dash-practice">${practiceHtml}</div>`;
        case 'spread': return `<div class="dw-body" id="dash-spread">${spreadHtml}</div>`;
        case 'progress': return `<div class="dw-body" id="lvl-progress">${progressHtml}</div>`;
        case 'numbers': return `<div class="dw-body" id="dash-numbers">${numbersHtml}</div>`;
        case 'critical': return `<div class="dw-body" id="dash-critical">${v === Layout.get().cfg.critical.v ? critHtml : critFor(v)}</div>`;
        case 'upcoming': return `<div class="dw-body"><div class="panel">
          <h2>Coming up</h2>
          ${sd.upcomingAll.length ? Dash.comingUp(sd.upcomingAll, v, hourLabel)
            : `<p class="muted">${sd.nextReviewsAt ? 'Next reviews: ' + esc(new Date(sd.nextReviewsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })) : 'Nothing scheduled in the next 24 hours.'}</p>`}
        </div></div>`;
        default: return '';
      }
    }

    function draw(force) {
      if (stale()) return;
      const u = S.userCache ? S.userCache.u : user;
      const sd = Local.summary();
      const pendR = api.pending().length;
      const pendS = api.pendingStarts().length;
      const snap = Session.load();
      const sig = JSON.stringify([u.level, sd, pendR, pendS, snap && snap.items.length]);
      if (!force && sig === shown) return;
      // Don't rebuild the screen under someone who is typing in the session-length box.
      if (!force && app.contains(document.activeElement) && (document.activeElement.tagName === 'INPUT' || document.activeElement.classList.contains('select-btn'))) return;
      if (!force && busy) return;
      // Nor under the customize buttons while one has focus.
      if (!force && editing && document.activeElement && document.activeElement.closest && document.activeElement.closest('.dw-bar')) return;
      shown = sig;

      const syncSt = Sync.status();
      const syncHint = Sync.configured && !syncSt.user && !syncSt.remembered && localStorage.getItem('kl_sync_hint') !== '0';
      const waiting = [pendR ? `<b>${pendR} finished review${pendR > 1 ? 's' : ''}</b>` : '', pendS ? `<b>${pendS} started lesson${pendS > 1 ? 's' : ''}</b>` : ''].filter(Boolean).join(' and ');

      // The widgets, each as its own cell in a grid. Order, width, detail and presence come from Layout (see logic/layout.js).
      const L = Layout.get();
      const shownIds = L.order.filter((id) => editing || L.cfg[id].on);
      const cells = shownIds.map((id) => {
        const c = L.cfg[id], def = Layout.byId(id);
        const body = bodyHtml(id, c.v, sd);
        return `<section class="dw${c.on ? '' : ' is-off'}${c.h ? ' has-h' : ''}" data-w="${id}" data-span="${c.span}" data-v="${c.v}" style="grid-column:span ${c.span}${c.h ? `;height:${c.h}px` : ''}">${editing ? Dash.widgetBar(def, c) : ''}${c.on ? body : `<div class="dw-body" inert>${body}</div>`}${editing ? Dash.widgetHandles(def, c) : ''}</section>`;
      }).join('');
      const editBar = editing ? `<div class="panel dash-edit" role="region" aria-label="Customize the dashboard">
          <div class="row between"><h2>Customize the dashboard</h2>
            <div class="row"><button class="btn ghost small" id="dash-reset" type="button"${Layout.isDefault() ? ' disabled' : ''}>Reset layout</button><button class="btn small" id="dash-done" type="button">Done</button></div></div>
          <p class="muted">Drag a widget by its grip to move it, and drag its right or bottom edge to resize it (double-click an edge to put it back). The gear shows how much a widget says, with a preview. Changes are saved on this device. On a narrow screen every widget is full width.</p></div>` : '';
      app.innerHTML = `<div class="wrap">
        <div class="greet row between"><div><h1>Hello, ${esc(u.username)}</h1><p class="muted">Level ${u.level}</p></div>
          ${editing ? '' : '<button class="btn ghost small" id="dash-edit" type="button">Customize</button>'}</div>
        ${waiting ? `<div class="banner">${waiting} still waiting to be sent to WaniKani. <button class="link" id="retry-sync" type="button">Send now</button></div>` : ''}
        ${syncHint ? '<div class="banner info">Keep your plan and settings the same on all your devices. <button class="link" id="sync-hint-in" type="button">Sign in</button> <button class="link" id="sync-hint-x" type="button">Not now</button></div>' : ''}
        ${snap ? `<div class="banner info">You have an unfinished review session with <b>${snap.items.length} item${snap.items.length > 1 ? 's' : ''}</b> left. Open Reviews to pick it up. <button class="link" id="discard-session" type="button">Discard it</button></div>` : ''}
        ${editBar}
        <div class="dash-grid${editing ? ' editing' : ''}">${cells}</div>
      </div>`;

      bindPlan();
      bindGuard();
      bindProgress();
      paintPractice();
      paintSpread();
      bindLayout();
      const hs = $('#h-size');
      if (hs) {
        UI.bindStepper(hs.closest('[data-stepper]'), (v) => { setSessionSize(v); toast('Session length saved.'); });
        $('#h-more').onclick = () => openSettings('study');
      }
      const discard = $('#discard-session');
      if (discard) discard.onclick = async () => {
        const ok = await UI.confirm({ title: 'Discard this session?', message: 'Items you already finished are safe on WaniKani.', ok: 'Discard', danger: true });
        if (ok) { Session.clear(); draw(true); }
      };
      const sin = $('#sync-hint-in');
      if (sin) sin.onclick = () => {
        const off = Sync.on(() => { if (Sync.status().user) { off(); draw(true); } });
        signInToSync();
      };
      const sx = $('#sync-hint-x');
      if (sx) sx.onclick = () => { localStorage.setItem('kl_sync_hint', '0'); draw(true); };
      const retry = $('#retry-sync');
      if (retry) retry.onclick = async () => {
        retry.disabled = true;
        try { await api.flushPending(); toast('Sent to WaniKani.'); } catch (e) { toast(e.message); }
        draw();
      };
    }

    // Extra practice: counts come from the saved copy (no requests); "critical" and "current level" fill in once their data has loaded.
    function paintPractice() {
      if (stale()) return;
      const ctx = {
        all: Local.allAssignments(), assignmentFor: Local.assignmentFor, mistakes: Practice.readLog(user.id),
        rows: X.rs ? X.rs.rows : null, levelIds: X.levelIds, size: settings.practiceSize,
        classes: Practice.readClasses(), dakuten: settings.practiceDakuten, mode: settings.practiceMode,
      };
      const kinds = Practice.KINDS.map((k) => ({ key: k.key, title: k.title, desc: k.desc, count: Practice.count(k.key, ctx) }));
      practiceHtml = Dash.practice(kinds, UI.stepperHTML('p-size', settings.practiceSize, { min: 5, max: 200, step: 5, label: 'Items per practice' }),
        UI.selectHTML('p-order', Practice.ORDERS, Practice.orderValue(settings.practiceOrder), 'Practice order'),
        UI.selectHTML('p-mode', Practice.MODES, Practice.modeValue(settings.practiceMode), 'Practice style'), Practice.modeValue(settings.practiceMode) === 'meaning');
      const box = $('#dash-practice');
      if (!box) return;
      // Don't rebuild the panel under someone who is typing in its size box.
      if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      box.innerHTML = practiceHtml;
      UI.bindStepper($('#p-size').closest('[data-stepper]'), (v) => { setPracticeSize(v); toast('Practice length saved.'); });
      UI.bindSelect($('#p-order').closest('[data-select]'), (v) => { setPracticeOrder(v); toast('Practice order saved.'); });
      UI.bindSelect($('#p-mode').closest('[data-select]'), (v) => { setPracticeMode(v); toast('Practice style saved.'); });
    }

    // Item spread: every started item, by SRS stage and kind, from the saved copy.
    function paintSpread() {
      if (stale()) return;
      const counts = {};
      Local.allAssignments().forEach((a) => {
        const d = a.data;
        if (d.hidden || !(d.srs_stage >= 1)) return;
        const g = Dash.spreadGroup(d.srs_stage);
        const c = counts[g] || (counts[g] = [0, 0, 0]);
        c[d.subject_type === 'radical' ? 0 : d.subject_type === 'kanji' ? 1 : 2]++;
      });
      spreadHtml = Dash.spread(counts);
      const box = $('#dash-spread');
      if (box) box.innerHTML = spreadHtml;
    }

    const guardFor = (v) => (X.loaded && guardRes ? GuardView.panel(guardRes, settings.sessionSize, v) : '');
    // The workload check. Rebuilt from guardRes whenever the data or a setting changes.
    function paintGuard() {
      if (stale()) return;
      guardHtml = guardFor(Layout.get().cfg.guard.v);
      const box = $('#dash-guard');
      if (box) { box.innerHTML = guardHtml; bindGuard(); }
    }
    function bindGuard() {
      const box = $('#dash-guard');
      if (!box) return;
      box.querySelectorAll('[data-guard-snooze]').forEach((b) => {
        b.onclick = () => {
          const w = guardRes && guardRes.warnings.find((x) => x.id === b.dataset.guardSnooze);
          if (w) Guard.snooze(w);
          paintGuard();
        };
      });
      box.querySelectorAll('[data-guard-session]').forEach((b) => {
        b.onclick = () => { const n = Number(b.dataset.guardSession); setSessionSize(n); toast(`Sessions are now ${n} reviews, so each one is easier to finish.`); paintGuard(); };
      });
    }

    // Customizing. Every change is saved at once and the screen is rebuilt, so focus is put back on the control that was used.
    function relayout(focus) {
      if (X.loaded) paintExtras(); // the workload check, critical items and coming-up lists depend on their detail level
      draw(true);
      const el = (focus && $(focus)) || null;
      const ok = el && !el.disabled ? el : (el && el.closest('.dw') ? el.closest('.dw').querySelector('.dw-bar button') : $('#dash-done') || $('#dash-edit'));
      if (ok) ok.focus();
    }
    const clampN = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

    // Dragging a widget by its grip: it follows the pointer, and a bar shows where it will land on the edge of the widget under it.
    // Pointer events, so it works with a finger as well. Arrow keys on the grip move it one place at a time.
    function bindDrag(grid) {
      grid.querySelectorAll('.dw-grip').forEach((grip) => {
        const cell = grip.closest('.dw'), id = cell.dataset.w;
        grip.onkeydown = (e) => {
          const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
          if (!dir) return;
          e.preventDefault();
          Layout.move(id, dir);
          relayout(`.dw[data-w="${id}"] .dw-grip`);
        };
        grip.onpointerdown = (e) => {
          if (e.button != null && e.button > 0) return;
          e.preventDefault();
          const others = [...grid.querySelectorAll(':scope > .dw')].filter((c) => c !== cell);
          const sx = e.clientX, sy = e.clientY, scroll0 = window.scrollY;
          let px = sx, py = sy, hit = null, after = false, raf = 0, live = true;
          busy = true;
          cell.classList.add('dragging');
          grid.classList.add('dragging-any');
          try { grip.setPointerCapture(e.pointerId); } catch (err) { /* the drag still works without capture */ }
          const mark = (target, side) => {
            others.forEach((c) => c.removeAttribute('data-drop'));
            if (target) target.setAttribute('data-drop', side);
          };
          const place = () => {
            cell.style.transform = `translate(${px - sx}px, ${py - sy + (window.scrollY - scroll0)}px)`;
            const gr = grid.getBoundingClientRect();
            let best = null, bd = Infinity;
            others.forEach((c) => {
              const r = c.getBoundingClientRect();
              const inside = px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
              const d = inside ? 0 : Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2));
              if (d < bd) { bd = d; best = { c, r }; }
            });
            if (!best) { hit = null; mark(null); return; }
            // A wide widget is entered from above or below, a narrow one from its left or right.
            const wide = best.r.width > gr.width * 0.7;
            after = wide ? py > best.r.top + best.r.height / 2 : px > best.r.left + best.r.width / 2;
            hit = best.c;
            mark(hit, wide ? (after ? 'bottom' : 'top') : (after ? 'right' : 'left'));
          };
          // Near the top or bottom of the screen the page scrolls by itself, so a long dashboard can be rearranged.
          const loop = () => {
            if (!live) return;
            const edge = 70;
            if (py < edge) window.scrollBy(0, -Math.ceil((edge - py) / 4));
            else if (py > window.innerHeight - edge) window.scrollBy(0, Math.ceil((py - (window.innerHeight - edge)) / 4));
            place();
            raf = requestAnimationFrame(loop);
          };
          grip.onpointermove = (ev) => { px = ev.clientX; py = ev.clientY; };
          const finish = (drop) => {
            live = false;
            cancelAnimationFrame(raf);
            grip.onpointermove = grip.onpointerup = grip.onpointercancel = null;
            try { grip.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
            const target = drop && hit ? hit.dataset.w : null;
            busy = false;
            if (target) { Layout.moveTo(id, target, after); relayout(`.dw[data-w="${id}"] .dw-grip`); return; }
            cell.classList.remove('dragging');
            grid.classList.remove('dragging-any');
            cell.style.transform = '';
            mark(null);
          };
          grip.onpointerup = () => finish(true);
          grip.onpointercancel = () => finish(false);
          loop();
        };
      });
    }

    // The bars on a widget's right and bottom edges. The width snaps to the columns of the grid (2 to 6 of 6) and shows
    // how many; the height is free. Both can be set with the arrow keys too, and a double-click puts them back.
    function bindResize(grid) {
      grid.querySelectorAll('.dw-rs').forEach((h) => {
        const cell = h.closest('.dw'), id = cell.dataset.w, wide = h.dataset.dw === 'rs-w';
        const sel = `.dw[data-w="${id}"] [data-dw="${h.dataset.dw}"]`;
        h.ondblclick = () => { Layout.set(id, wide ? { span: Layout.DEFAULT_SPAN } : { h: null }); relayout(sel); };
        h.onkeydown = (e) => {
          const cur = Layout.get().cfg[id];
          if (wide && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) Layout.set(id, { span: cur.span + (e.key === 'ArrowRight' ? 1 : -1) });
          else if (!wide && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) Layout.set(id, { h: (cur.h || cell.offsetHeight) + (e.key === 'ArrowDown' ? 24 : -24) });
          else if (!wide && e.key === 'Home') Layout.set(id, { h: null });
          else return;
          e.preventDefault();
          relayout(sel);
        };
        h.onpointerdown = (e) => {
          if (e.button != null && e.button > 0) return;
          e.preventDefault();
          busy = true;
          cell.classList.add('resizing');
          try { h.setPointerCapture(e.pointerId); } catch (err) { /* works without capture */ }
          const gap = parseFloat(getComputedStyle(grid).columnGap) || 14;
          let span = Layout.get().cfg[id].span, height = null;
          h.onpointermove = (ev) => {
            const r = cell.getBoundingClientRect();
            if (wide) {
              const colW = (grid.getBoundingClientRect().width - gap * 5) / 6;
              const n = clampN(Math.round((ev.clientX - r.left + gap) / (colW + gap)), Layout.MIN_SPAN, Layout.MAX_SPAN);
              span = n;
              cell.style.gridColumn = `span ${n}`;
              cell.dataset.span = n;
              h.dataset.badge = `${n} of 6`;
            } else {
              height = clampN(Math.round(ev.clientY - r.top), Layout.MIN_H, Layout.MAX_H);
              cell.style.height = height + 'px';
              cell.classList.add('has-h');
              h.dataset.badge = height + ' px';
            }
          };
          const finish = (keep) => {
            h.onpointermove = h.onpointerup = h.onpointercancel = null;
            try { h.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
            busy = false;
            if (keep && (wide || height != null)) Layout.set(id, wide ? { span } : { h: height });
            relayout(sel);
          };
          h.onpointerup = () => finish(true);
          h.onpointercancel = () => finish(false);
        };
      });
    }

    // The gear: pick a level of detail and see the widget as it will look before saving it.
    function openDetailMenu(id) {
      const def = Layout.byId(id);
      const cur = Layout.get().cfg[id].v;
      let pick = cur;
      const sd = Local.summary();
      // The preview is a copy of the widget, so its ids are dropped (the real one keeps them) and it is made inert (nothing in it can be clicked).
      const preview = () => bodyHtml(id, pick, sd).replace(/\s(id|for)="[^"]*"/g, '');
      openModal(`<div class="dm"><h2>${esc(def.name)}: how much to show</h2>
        <div class="dw-seg" role="group" aria-label="Amount of detail">${def.levels.map((l) => `<button type="button" data-dm="${l}" aria-pressed="${l === pick}">${esc(Layout.LEVEL_NAMES[l])}</button>`).join('')}</div>
        <p class="muted dm-desc" id="dm-desc" aria-live="polite"></p>
        <div class="dm-preview-label muted">Preview</div>
        <div class="dm-preview" inert><div class="dw" id="dm-view"></div></div>
        <div class="dm-actions"><button type="button" class="btn ghost small" data-close>Cancel</button><button type="button" class="btn small" id="dm-save">Use this</button></div></div>`);
      const paint = () => {
        $('#dm-desc').textContent = def.detail[pick] + (pick === cur ? ' (what you have now)' : '');
        const v = $('#dm-view');
        v.dataset.v = pick;
        v.innerHTML = preview();
        $('#dm-save').disabled = pick === cur;
        document.querySelectorAll('[data-dm]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.dm) === pick)));
      };
      document.querySelectorAll('[data-dm]').forEach((b) => { b.onclick = () => { pick = Number(b.dataset.dm); paint(); }; });
      $('#dm-save').onclick = () => {
        Layout.set(id, { v: pick });
        document.getElementById('modal').close();
        relayout(`.dw[data-w="${id}"] .dw-gear`);
      };
      paint();
    }

    function bindLayout() {
      const edit = $('#dash-edit');
      if (edit) edit.onclick = () => { editing = true; relayout('#dash-done'); };
      const done = $('#dash-done');
      if (done) done.onclick = () => { editing = false; relayout('#dash-edit'); };
      const reset = $('#dash-reset');
      if (reset) reset.onclick = async () => {
        const ok = await UI.confirm({ title: 'Reset the layout?', message: 'Every widget goes back to its usual place, size and detail, and hidden widgets come back.', ok: 'Reset' });
        if (ok) { Layout.reset(); relayout('#dash-done'); toast('Layout reset.'); }
      };
      const grid = $('.dash-grid.editing');
      if (!grid) return;
      bindDrag(grid);
      bindResize(grid);
      grid.querySelectorAll('.dw-gear').forEach((b) => { b.onclick = () => openDetailMenu(b.closest('.dw').dataset.w); });
      grid.querySelectorAll('.dw-vis').forEach((b) => {
        b.onclick = () => { const id = b.closest('.dw').dataset.w; Layout.set(id, { on: !Layout.get().cfg[id].on }); relayout(`.dw[data-w="${id}"] .dw-vis`); };
      });
    }

    function bindPlan() {
      const d = $('#plan-dismiss');
      if (d) d.onclick = () => { Plan.dismiss(); planHtml = ''; const b = $('#dash-plan'); if (b) b.innerHTML = ''; };
    }

    // Level progress, split into radicals, kanji and vocabulary and coloured by SRS stage.
    // 90% of the level's kanji at Guru or above unlocks the next level. The arrows in its title browse earlier levels.
    let lpSeq = 0;
    async function drawProgress() {
      const seq = ++lpSeq;
      const cur = (S.userCache ? S.userCache.u : user).level;
      if (X.lpLevel != null && (X.lpLevel >= cur || X.lpLevel < 1)) X.lpLevel = null;
      const shown = X.lpLevel == null ? cur : X.lpLevel;
      try {
        const subs = await Local.levelSubjects(cur, { background: true });
        if (stale() || seq !== lpSeq) return;
        // Everything below the progress panel (plan, practice, estimates) is about the level you are on, whatever the panel shows.
        X.levelIds = new Set(subs.filter((x) => !x.data.hidden_at).map((x) => x.id));
        const kanji = subs.filter((x) => x.object === 'kanji' && !x.data.hidden_at);
        const need = Math.ceil(kanji.length * 0.9);
        const done = kanji.filter((x) => { const a = Local.assignmentFor(x.id); return a && a.data.srs_stage >= 5; }).length;
        X.progress = need ? { fraction: Math.min(1, done / need) } : null;
        S.lastFrac = X.progress ? X.progress.fraction : null;
        let panelSubs = subs;
        if (shown !== cur) {
          paintProgress(Dash.levelProgress(shown, null, Local.assignmentFor, cur)); // the arrows work while it loads
          panelSubs = await Local.levelSubjects(shown, { background: true });
          if (stale() || seq !== lpSeq) return;
        }
        progressHtml = Dash.levelProgress(shown, panelSubs, Local.assignmentFor, cur);
        paintProgress(progressHtml);
      } catch (e) { /* progress is a nice-to-have */ }
      if (seq === lpSeq) paintExtras();
    }
    function paintProgress(html) {
      const box = $('#lvl-progress');
      if (box) { box.innerHTML = html; bindProgress(); }
    }
    function bindProgress() {
      const box = $('#lvl-progress');
      if (!box) return;
      box.querySelectorAll('[data-lp-to]').forEach((b) => {
        b.onclick = () => {
          const cur = (S.userCache ? S.userCache.u : user).level;
          const to = Number(b.dataset.lpTo);
          X.lpLevel = to >= cur ? null : Math.max(1, to);
          drawProgress();
          const again = box.querySelector(`[data-lp-to="${to}"]`) || box.querySelector('.lp-nav:not([disabled])');
          if (again) again.focus();
        };
      });
      // One popup shared by all the segments, placed so its arrow always points at the segment (or the pointer on a long one)
      // and the bubble itself never leaves the card.
      const panel = box.querySelector('.lp');
      const tip = box.querySelector('.lp-tip');
      if (!panel || !tip) return;
      const hide = () => tip.classList.remove('on');
      const show = (seg, clientX) => {
        tip.textContent = seg.dataset.tip;
        tip.classList.add('on');
        const pr = panel.getBoundingClientRect(), sr = seg.getBoundingClientRect();
        const ax = (clientX == null ? sr.left + sr.width / 2 : Math.min(sr.right - 2, Math.max(sr.left + 2, clientX))) - pr.left;
        const w = tip.offsetWidth, h = tip.offsetHeight;
        const left = Math.max(6, Math.min(pr.width - w - 6, ax - w / 2));
        tip.style.left = left + 'px';
        tip.style.top = (sr.top - pr.top - h - 9) + 'px';
        tip.style.setProperty('--ax', Math.max(10, Math.min(w - 10, ax - left)) + 'px');
      };
      panel.querySelectorAll('.lp-bar i[data-tip]').forEach((seg) => {
        seg.onpointerenter = seg.onpointermove = (e) => show(seg, e.clientX);
        seg.onpointerleave = hide;
        seg.onfocus = () => show(seg, null);
        seg.onblur = hide;
      });
    }

    // Critical condition at a level of detail: the detailed one lists 24 items instead of 8 (the brief one hides them with css).
    function critFor(v) {
      if (!X.rs) return Dash.critical(null, 0, 75, tile);
      const live = (id) => { const a = Local.assignmentFor(id); return !!a && !a.data.hidden && a.data.srs_stage >= 1 && a.data.srs_stage < 9; };
      const cr = Stats.criticalItems(X.rs.rows, live, { below: 75, limit: v >= 3 ? 24 : 8 });
      const missing = cr.items.map((x) => x.id).filter((id) => !X.subs.has(id));
      if (missing.length) {
        api.getSubjects(missing, { background: true }).then((m) => { m.forEach((val, k) => X.subs.set(k, val)); paintExtras(); }).catch(() => {});
      }
      const items = cr.items.filter((x) => X.subs.has(x.id)).map((x) => Object.assign({ subject: X.subs.get(x.id) }, x));
      return Dash.critical(missing.length && !items.length ? null : items, cr.count, 75, tile);
    }

    // "Your numbers" and "Critical condition".
    function paintExtras() {
      if (stale()) return;
      const u = S.userCache ? S.userCache.u : user;
      const lvl = u.level;
      const now = Date.now();
      const counts = Stats.dayCounts(X.hist);
      const streak = Stats.streakInfo(counts, now);
      const ls = Stats.levelStats(X.lp || [], lvl, now);
      let basis = localStorage.getItem('kl_pace_basis') || 'all';
      const pace = Stats.paceFor(ls.done, basis, Number(localStorage.getItem('kl_pace_custom')) || 12);
      const est = X.lp ? Stats.estimate({ level: lvl, target: lvl + 1, pace, elapsedDays: ls.elapsedDays, progress: X.progress ? X.progress.fraction : null, now }) : null;
      const all = Local.allAssignments().filter((a) => !a.data.hidden && a.data.srs_stage >= 1);
      if (X.rs && !X.rsSummary) X.rsSummary = Stats.summarizeReviewStats(X.rs.rows);
      const ans = X.rsSummary ? X.rsSummary.answers : null;
      numbersHtml = Dash.numbers({
        user: u, level: lvl, streak, haveHistory: !!(X.hist && X.hist.n), ls, pace, est,
        reviewsToday: streak.today, bestDay: X.hist && X.hist.n ? Math.max.apply(null, [0].concat(Object.keys(counts).map((k) => counts[k]))) : 0,
        burned: all.filter((a) => a.data.srs_stage === 9).length, started: all.length,
        accuracy: ans && ans.c + ans.i ? Math.round(ans.c / (ans.c + ans.i) * 1000) / 10 : null, answers: ans ? ans.c + ans.i : 0,
      });
      const nb = $('#dash-numbers'); if (nb) nb.innerHTML = numbersHtml;

      // Workload check: what you are piling up against what you manage. Needs your review history, so it waits for that.
      guardRes = Guard.evaluate(guardContext(user.id, lvl, X.hist, X.rs, X.progress ? X.progress.fraction : null));
      const guardOn = Guard.prefs().on;
      paintGuard();
      // A toast the first time per day the picture gets worse (and only once the saved copy is fresh, so a stale one can't cry wolf).
      if (!announced && X.loaded && guardOn && (Local._lastRefresh > 0 || navigator.onLine === false)) {
        announced = true;
        const msg = Guard.toAnnounce(guardRes);
        if (msg) toast(msg, 7000);
      }

      // Off-track warning against the saved plan (needs the level progress, so it waits for that).
      const plan = Plan.load(user.id);
      planHtml = plan && X.progress && !Plan.dismissedToday() ? PlanView.banner(plan, Plan.evaluate(plan, lvl + X.progress.fraction, now), guardOn ? guardRes : null) : '';
      const pb = $('#dash-plan'); if (pb) { pb.innerHTML = planHtml; bindPlan(); }

      // Today's lessons and reviews against the plan (all from the saved copy, no requests).
      if (plan && X.progress && Plan.evaluate(plan, lvl + X.progress.fraction, now).state !== 'done') {
        const dk = Stats.dayKey(new Date(now));
        const doneToday = counts[dk] || 0;
        const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
        // The day's review total is worked out once and kept (see Plan.reviewsToday), so the bar only moves as you review.
        // It waits for the saved copy to be brought up to date first, so stale data isn't locked in.
        const rt = Plan.reviewsToday(doneToday, Local.reviewsDueBy(midnight.getTime()), Local._lastRefresh > 0 || navigator.onLine === false);
        const acc = X.rs ? Stats.accuracyOf(X.rs.rows) : null;
        const planAcc = plan.acc != null ? plan.acc : Plan.DEFAULT_ACC;
        todayHtml = PlanView.today(plan, {
          lessonsDone: Local.allAssignments().filter((a) => a.data.started_at && Stats.dayKey(new Date(a.data.started_at)) === dk).length,
          lessonsQueue: Local.lessonsAvailable().length,
          reviewsDone: doneToday,
          reviewsDue: Local.reviewsDue().length,
          reviewsTotal: rt.total,
          acc,
          guard: Object.assign({ on: guardOn }, guardRes.allowance, { note: guardRes.recovery ? guardRes.recovery.planText : '' }),
          // Reviews a day from new lessons at your accuracy now (the saved figure is from when you made the plan).
          rpd: plan.lpd ? Plan.reviewsPerDay(plan.lpd, Math.max(1, (plan.end - plan.start) / 86400000), acc != null ? acc : planAcc) : 0,
        });
      } else todayHtml = '';
      const tb = $('#dash-today'); if (tb) tb.innerHTML = todayHtml;

      critHtml = critFor(Layout.get().cfg.critical.v);
      const cb = $('#dash-critical'); if (cb) cb.innerHTML = critHtml;
      paintPractice();
      paintSpread();
    }

    async function loadExtras() {
      try {
        const [lp, hist, rs] = await Promise.all([Stats.savedProgressions(), Stats.savedHistory(), Stats.savedReviewStats()]);
        if (stale()) return;
        X.lp = lp ? lp.rows : null; X.hist = hist; X.rs = rs; X.rsSummary = null; X.loaded = true;
        paintExtras();
        if (!lp || Date.now() - lp.at > 5 * 60000) {
          Stats.fetchProgressions({ background: true }).then((rows) => { X.lp = rows; paintExtras(); }).catch(() => {});
        }
        if (!rs || Date.now() - rs.at > 30 * 60000) {
          Stats.syncReviewStats({}).then((r) => { X.rs = r; X.rsSummary = null; paintExtras(); }).catch(() => {});
        }
      } catch (e) { X.loaded = true; /* these widgets are a nice-to-have */ }
    }

    const redraw = () => { draw(); drawProgress(); };
    draw(true);
    drawProgress();
    loadExtras();
    // Once the quiet sync from opening the app has finished, redraw so today's review total is worked out from fresh data.
    Promise.resolve(Local._refreshing).catch(() => {}).then(() => { if (!stale()) paintExtras(); });

    // Keep it current: when data changes, once a half-minute (reviews fall due with time), and a quiet sync every few minutes.
    S.onUserChange = () => { draw(true); drawProgress(); };
    // The review length can also be changed in Settings, so keep the box on this screen in step with it.
    const onSettings = () => {
      const st = $('#h-size'); if (st) UI.setStepper(st.closest('[data-stepper]'), settings.sessionSize);
      const ps = $('#p-size'); if (ps) UI.setStepper(ps.closest('[data-stepper]'), settings.practiceSize);
      if (X.loaded) paintExtras(); // the workload guard's settings (or the session length) may have changed
      else paintPractice(); // the practice style changes how many items each set holds
    };
    window.addEventListener('kl-settings', onSettings);
    const unsub = Local.subscribe(redraw);
    const tick = setInterval(() => { if (document.visibilityState === 'visible') draw(); }, 30000);
    const sync = setInterval(() => { if (document.visibilityState === 'visible') Local.refresh({ minAge: 4 * 60000 }).catch(syncFailed); }, 60000);
    S.cleanup = () => { clearInterval(tick); clearInterval(sync); unsub(); S.onUserChange = null; window.removeEventListener('kl-settings', onSettings); };

    // Send anything waiting, in the background.
    if (api.pending().length || api.pendingStarts().length) flushBg().then(() => draw());
  }

  Object.assign(KL, { homeView });
})(window.KL);
