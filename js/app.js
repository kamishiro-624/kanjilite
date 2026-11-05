/* KanjiLite – a small, unofficial WaniKani client. No build step, no dependencies. */
(function () {
  'use strict';

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app');
  const dlg = $('#modal');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rand = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const getNum = (k, d) => { const v = localStorage.getItem(k); return v === null ? d : Number(v); };
  const settings = {
    get lessonBatch() { return getNum('kl_lesson_batch', 5); },
    get sessionSize() { return getNum('kl_session_size', 100); }, // 0 = everything
    get backToBack() { return localStorage.getItem('kl_b2b') === '1'; },
    get firstQ() { return localStorage.getItem('kl_first') || 'random'; }, // random | meaning | reading
    get showLevel() { return localStorage.getItem('kl_show_level') !== '0'; },
    get showStage() { return localStorage.getItem('kl_show_stage') !== '0'; },
    get srsToast() { return localStorage.getItem('kl_srs_toast') !== '0'; },
    get autoplay() { return localStorage.getItem('kl_autoplay') === '1'; }, // off unless switched on
    get wrongDelay() { return getNum('kl_wrong_delay', 1000); }, // ms "Next" stays locked after a wrong answer
    get theme() { return localStorage.getItem('kl_theme') || 'system'; }, // system | light | dark
  };
  function applyTheme() {
    const t = settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  applyTheme();

  // Unfinished review session, saved after every answer so you can leave and come back.
  const Session = {
    key: 'kl_session',
    load() {
      try { const x = JSON.parse(localStorage.getItem(this.key)); return x && x.v === 1 && Array.isArray(x.items) && x.items.length ? x : null; } catch (e) { return null; }
    },
    save(x) { try { localStorage.setItem(this.key, JSON.stringify(x)); } catch (e) { /* storage full or blocked */ } },
    clear() { localStorage.removeItem(this.key); },
  };
  const LESSON_CAP = 100;

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
  }

  // The API layer paces itself to WaniKani's rate limit; tell the person when a screen has to wait.
  let waitToastAt = 0;
  api.onWait = (ms) => {
    if (Date.now() - waitToastAt < 8000) return;
    waitToastAt = Date.now();
    toast(`Pausing about ${Math.ceil(ms / 1000)}s to stay within WaniKani’s rate limit…`);
  };

  // Uploads started in the background used to fail silently. Say so when WaniKani refuses one outright,
  // and when the token is missing the permission needed to save anything at all.
  api.onRefused = (item, err) => toast('WaniKani did not accept one result (' + err.message + '). It was skipped.');
  let permToastAt = 0;
  function flushBg() {
    return api.flushPending().catch((e) => {
      if (e && e.status === 403 && Date.now() - permToastAt > 30000) { permToastAt = Date.now(); toast(e.message); }
      return api.pending().length + api.pendingStarts().length;
    });
  }

  const loading = (msg) => { app.innerHTML = `<div class="wrap center"><div class="spinner"></div><p class="muted">${esc(msg || 'Loading…')}</p></div>`; };
  const empty = (title, text) => { app.innerHTML = `<div class="wrap center"><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p><a class="btn" href="#/">Back home</a></div>`; };

  function go(hash) {
    if (location.hash === hash) route(); else location.hash = hash;
  }

  // ---------- subject helpers ----------
  const typeClass = (t) => (t === 'kana_vocabulary' ? 'vocabulary' : t);
  const TYPE_LABEL = { radical: 'Radical', kanji: 'Kanji', vocabulary: 'Vocabulary', kana_vocabulary: 'Vocabulary' };
  const TYPE_ORDER = { radical: 0, kanji: 1, vocabulary: 2, kana_vocabulary: 3 };
  const STAGES = ['Lesson', 'Apprentice I', 'Apprentice II', 'Apprentice III', 'Apprentice IV', 'Guru I', 'Guru II', 'Master', 'Enlightened', 'Burned'];
  // Where WaniKani moves an item after a review: +1 when every answer was right; otherwise it drops by
  // ceil(wrong answers / 2) stages (twice that from Guru up), never below Apprentice I.
  function nextStage(stage, wrong) {
    if (!wrong) return Math.min(9, stage + 1);
    return Math.max(1, stage - Math.ceil(wrong / 2) * (stage >= 5 ? 2 : 1));
  }
  const stageGroup = (n) => (n <= 0 ? 'lesson' : n <= 4 ? 'apprentice' : n <= 6 ? 'guru' : n === 7 ? 'master' : n === 8 ? 'enlightened' : 'burned');

  function glyph(s) {
    const d = s.data;
    if (d.characters) return esc(d.characters);
    const imgs = d.character_images || [];
    const pick = imgs.find((i) => i.content_type === 'image/svg+xml' && i.metadata && i.metadata.inline_styles)
      || imgs.find((i) => i.content_type === 'image/png') || imgs[0];
    return pick ? `<img src="${esc(pick.url)}" alt="${esc(d.slug)}">` : esc(d.slug);
  }
  const glyphClass = (s) => ((s.data.characters || '').length > 4 ? 'long' : '');
  const primaryMeaning = (s) => ((s.data.meanings.find((m) => m.primary) || s.data.meanings[0] || {}).meaning) || '';
  const primaryReading = (s) => { const r = (s.data.readings || []).find((x) => x.primary); return r ? r.reading : ''; };

  // Mnemonics use pseudo tags like <radical>…</radical>; escape everything, then re-enable those.
  function mnem(text) {
    return esc(text || '')
      .replace(/&lt;(\/?)(radical|kanji|vocabulary|meaning|reading|ja)&gt;/g, (m, slash, tag) => (slash ? '</span>' : `<span class="tag tag-${tag}">`))
      .replace(/\n/g, '<br>');
  }

  /** opts.guru: show how far the item is from Guru I (stage 5), or that it has passed it. */
  function tile(s, assignment, opts) {
    const locked = assignment === null || (assignment && !assignment.data.unlocked_at);
    const stage = assignment && assignment.data.srs_stage > 0 ? stageGroup(assignment.data.srs_stage) : '';
    const title = locked ? 'Locked' : assignment ? STAGES[assignment.data.srs_stage] : '';
    const reading = primaryReading(s);
    let prog = '';
    if (opts && opts.guru && assignment && !locked) {
      const st = assignment.data.srs_stage || 0;
      const passed = st >= 5;
      const n = Math.min(st, 5);
      prog = `<span class="gprog${passed ? ' done' : ''}" aria-hidden="true"><i style="width:${n / 5 * 100}%"></i></span>`
        + `<span class="gtxt">${passed ? '✓ ' + esc(STAGES[st]) : n + '/5 to Guru'}</span>`;
    }
    return `<button type="button" class="tile t-${typeClass(s.object)}${locked ? ' locked' : ''}${prog ? ' kp' : ''}" data-subject="${s.id}" title="${esc(title)}">
      <span class="tg">${glyph(s)}</span>
      <span class="tm">${esc(primaryMeaning(s))}</span>
      ${reading ? `<span class="tr">${esc(reading)}</span>` : ''}
      ${prog}
      ${stage ? `<span class="stage stage-${stage}"></span>` : ''}
    </button>`;
  }

  function hero(s) {
    const d = s.data;
    return `<div class="hero t-${typeClass(s.object)}">
      <div class="hglyph">${glyph(s)}</div>
      <div class="hname">${esc(primaryMeaning(s))}</div>
      <div class="hsub">${TYPE_LABEL[s.object]}, level ${d.level}</div>
    </div>`;
  }

  /** Buttons that open the item on WaniKani and on Jisho, each in a new tab. */
  function externalLinks(s) {
    const l = Search.links(s);
    const a = (href, text) => `<a class="ext-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}<span aria-hidden="true"> ↗</span><span class="sr-only"> (opens in a new tab)</span></a>`;
    const parts = [];
    if (l.wanikani) parts.push(a(l.wanikani, 'Open on WaniKani'));
    if (l.jisho) parts.push(a(l.jisho, 'Open on Jisho'));
    return parts.length ? `<div class="ext-links">${parts.join('')}</div>` : '';
  }

  /** Meanings, readings, mnemonics, sentences and relations for one subject. */
  function renderInfo(s, related, opts) {
    const d = s.data;
    const showUsedIn = !opts || opts.usedIn !== false;
    let h = '';

    const primary = d.meanings.filter((m) => m.primary).map((m) => m.meaning);
    const alts = d.meanings.filter((m) => !m.primary && m.accepted_answer).map((m) => m.meaning);
    h += `<section><h3>Meaning</h3><p class="big">${esc(primary.join(', '))}</p>`;
    if (alts.length) h += `<p class="muted">Also accepted: ${esc(alts.join(', '))}</p>`;
    if (d.meaning_mnemonic) h += `<p>${mnem(d.meaning_mnemonic)}</p>`;
    if (d.meaning_hint) h += `<p class="hint">${mnem(d.meaning_hint)}</p>`;
    h += '</section>';

    const readings = d.readings || [];
    if (readings.length) {
      h += '<section><h3>Reading</h3>';
      if (s.object === 'kanji') {
        const labels = { onyomi: 'On’yomi', kunyomi: 'Kun’yomi', nanori: 'Nanori' };
        h += '<dl class="kv">';
        ['onyomi', 'kunyomi', 'nanori'].forEach((t) => {
          const rs = readings.filter((r) => r.type === t);
          if (!rs.length) return;
          const cls = rs.some((r) => r.accepted_answer) ? '' : ' class="muted"';
          h += `<dt${cls}>${labels[t]}</dt><dd${cls}>${esc(rs.map((r) => r.reading).join('、'))}</dd>`;
        });
        h += '</dl>';
      } else {
        h += `<p class="big" style="font-family:var(--mincho)">${esc(readings.map((r) => r.reading).join('、'))}</p>`;
      }
      if (d.reading_mnemonic) h += `<p>${mnem(d.reading_mnemonic)}</p>`;
      if (d.reading_hint) h += `<p class="hint">${mnem(d.reading_hint)}</p>`;
      h += '</section>';
    }

    h += `<section class="mat"><h3>Your synonyms and notes</h3><div class="mat-box" data-mat="${s.id}">${matHTML(s)}</div></section>`;

    // Native-speaker audio: a word's own recording, or recordings of words that use the kanji.
    if (window.Sound) h += Sound.sectionHTML(s);

    if (d.parts_of_speech && d.parts_of_speech.length) {
      h += `<section><h3>Part of speech</h3><p>${esc(d.parts_of_speech.join(', ').replace(/_/g, ' '))}</p></section>`;
    }

    // Pitch accent: a word shows its own readings; a kanji shows a few of the words it appears in.
    {
      const items = [];
      if (s.object === 'vocabulary') {
        (d.readings || []).forEach((r) => items.push({ w: d.characters, r: r.reading }));
      } else if (s.object === 'kanji' && related && showUsedIn) {
        (d.amalgamation_subject_ids || []).map((id) => related.get(id))
          .filter((v) => v && v.object === 'vocabulary' && v.data.characters && primaryReading(v))
          .slice(0, 6).forEach((v) => items.push({ w: v.data.characters, r: primaryReading(v), show: true }));
      }
      if (items.length) {
        h += `<section><h3>Pitch accent${s.object === 'kanji' ? ' in words with this kanji' : ''}</h3><div class="pitch" data-pitch="${esc(JSON.stringify(items))}"></div></section>`;
      }
    }

    if (d.context_sentences && d.context_sentences.length) {
      h += '<section class="sentences"><h3>Example sentences</h3>';
      d.context_sentences.slice(0, 3).forEach((c) => { h += `<p class="ja">${esc(c.ja)}</p><p class="muted">${esc(c.en)}</p>`; });
      h += '</section>';
    }

    if (related) {
      const parts = (d.component_subject_ids || []).map((id) => related.get(id)).filter(Boolean);
      if (parts.length) {
        const title = s.object === 'vocabulary' ? 'Kanji in this word' : 'Made of these radicals';
        h += `<section><h3>${title}</h3><div class="tiles">${parts.map((p) => tile(p)).join('')}</div></section>`;
      }
      if (showUsedIn) {
        const used = (d.amalgamation_subject_ids || []).slice(0, 30).map((id) => related.get(id)).filter(Boolean);
        if (used.length) {
          const title = s.object === 'radical' ? 'Found in kanji' : 'Found in vocabulary';
          h += `<section><h3>${title}</h3><div class="tiles">${used.map((p) => tile(p)).join('')}</div></section>`;
        }
      }
    }

    if (d.document_url) h += `<p class="muted"><a href="${esc(d.document_url)}" target="_blank" rel="noopener">Open on WaniKani</a></p>`;
    return h;
  }

  /** Your own synonyms and notes for one subject (stored on WaniKani as its study material). */
  const matBusy = new Set();
  function matHTML(s, status) {
    const m = Local.material(s.id);
    const busy = matBusy.has(s.id) ? ' disabled' : '';
    const hasReading = (s.data.readings || []).length > 0;
    const chips = m.synonyms.length
      ? m.synonyms.map((x, i) => `<span class="syn"><span>${esc(x)}</span><button type="button" class="syn-del" data-syn-del="${i}" aria-label="Remove synonym ${esc(x)}"${busy}>×</button></span>`).join('')
      : '<span class="muted">None yet. Anything you add here is also accepted as a meaning answer.</span>';
    return `<div class="syn-list">${chips}</div>
      <div class="syn-add"><input type="text" class="mat-in" data-syn-input maxlength="100" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="Add a synonym" aria-label="Add a synonym"${busy}>
        <button type="button" class="btn ghost small" data-syn-add${busy}>Add</button></div>
      <label class="mat-label">Meaning note<textarea class="mat-in" data-note="meaning_note" rows="2" maxlength="5000" placeholder="Your own note on the meaning"${busy}>${esc(m.meaning_note)}</textarea></label>
      ${hasReading ? `<label class="mat-label">Reading note<textarea class="mat-in" data-note="reading_note" rows="2" maxlength="5000" placeholder="Your own note on the reading"${busy}>${esc(m.reading_note)}</textarea></label>` : ''}
      <div class="mat-foot"><button type="button" class="btn ghost small" data-note-save${busy}>Save notes</button><span class="mat-status${status && status.error ? ' bad' : ''}" role="status">${esc((status && status.text) || '')}</span></div>`;
  }

  function redrawMat(id, status) {
    document.querySelectorAll(`.mat-box[data-mat="${id}"]`).forEach((box) => {
      // Keep what is typed in the other fields while one part is saved.
      const typed = {};
      box.querySelectorAll('[data-note]').forEach((t) => { typed[t.dataset.note] = t.value; });
      const keepSyn = (box.querySelector('[data-syn-input]') || {}).value || '';
      const s = api.subjectCache.get(id);
      if (!s) return;
      box.innerHTML = matHTML(s, status);
      box.querySelectorAll('[data-note]').forEach((t) => { if (t.dataset.note in typed) t.value = typed[t.dataset.note]; });
      const inp = box.querySelector('[data-syn-input]');
      if (inp) inp.value = keepSyn;
    });
  }

  async function matSave(id, patch, doneText) {
    if (matBusy.has(id)) return false;
    matBusy.add(id);
    redrawMat(id, { text: 'Saving…' });
    try {
      await Local.saveMaterial(id, patch);
      matBusy.delete(id);
      redrawMat(id, { text: doneText });
      window.dispatchEvent(new Event('kl-materials'));
      return true;
    } catch (e) {
      matBusy.delete(id);
      redrawMat(id, { text: (e && e.message) || 'Could not save.', error: true });
      return false;
    }
  }

  document.addEventListener('click', (e) => {
    const box = e.target.closest('.mat-box');
    if (!box) return;
    const id = Number(box.dataset.mat);
    const del = e.target.closest('[data-syn-del]');
    if (del) {
      const list = Local.material(id).synonyms;
      list.splice(Number(del.dataset.synDel), 1);
      matSave(id, { synonyms: list }, 'Synonym removed.');
      return;
    }
    if (e.target.closest('[data-syn-add]')) addSynonym(box, id);
    else if (e.target.closest('[data-note-save]')) saveNotes(box, id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('[data-syn-input]')) return;
    e.preventDefault();
    e.stopPropagation();
    addSynonym(e.target.closest('.mat-box'), Number(e.target.closest('.mat-box').dataset.mat));
  });

  async function addSynonym(box, id) {
    const input = box.querySelector('[data-syn-input]');
    const word = input.value.replace(/\s+/g, ' ').trim();
    if (!word) return;
    const list = Local.material(id).synonyms;
    if (list.some((x) => x.toLowerCase() === word.toLowerCase())) { redrawMat(id, { text: 'You already have that synonym.', error: true }); return; }
    list.push(word);
    const ok = await matSave(id, { synonyms: list }, 'Synonym added.');
    if (ok) document.querySelectorAll(`.mat-box[data-mat="${id}"] [data-syn-input]`).forEach((i) => { i.value = ''; });
  }

  function saveNotes(box, id) {
    const patch = {};
    box.querySelectorAll('[data-note]').forEach((t) => { patch[t.dataset.note] = t.value.trim(); });
    matSave(id, patch, 'Notes saved.');
  }

  // ---------- modal ----------
  function openModal(html) {
    $('#modal-body').innerHTML = html;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });

  async function openSubject(id) {
    openModal('<div class="spinner"></div>');
    try {
      const s = (await api.getSubjects([id])).get(id);
      if (!s) throw new Error('Subject not found');
      const relIds = [].concat(s.data.component_subject_ids || [], (s.data.amalgamation_subject_ids || []).slice(0, 30));
      const related = await api.getSubjects(relIds);
      openModal(hero(s) + externalLinks(s) + `<div class="info-body">${renderInfo(s, related)}</div>`);
    } catch (e) {
      openModal(`<p class="error">${esc(e.message)}</p>`);
    }
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-subject]');
    if (t) openSubject(Number(t.dataset.subject));
  });

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

  // ---------- sync across devices (optional, see SYNC.md) ----------
  // The sign-in form: Google, or an email and password (create an account, sign in, reset a forgotten password).
  // It is used inside Settings and in a small dialog opened from the header, the home banner and the login screen.
  let syAuthN = 0;
  function syncAuthHTML() {
    const n = ++syAuthN;
    return `<div class="sy-auth">
      <button class="btn ghost" type="button" data-sy="google">Continue with Google</button>
      <p class="muted sy-or">or use your email address</p>
      <form data-sy="form" novalidate>
        <div class="field"><label for="sy-email-${n}">Email</label>
          <input id="sy-email-${n}" data-sy="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" inputmode="email"></div>
        <div class="field"><label for="sy-pass-${n}">Password</label>
          <input id="sy-pass-${n}" data-sy="pass" type="password" autocomplete="current-password">
          <span class="muted" data-sy="hint" hidden>At least 8 characters.</span></div>
        <div class="error" data-sy="err" role="alert"></div>
        <p class="sy-note" data-sy="note" role="status"></p>
        <div class="sy-actions">
          <button class="btn small" type="submit" data-sy="submit">Sign in</button>
          <button class="link inline" type="button" data-sy="mode">Create an account</button>
          <button class="link inline" type="button" data-sy="forgot">Forgot password?</button>
        </div>
      </form>
    </div>`;
  }

  /** Wire up a form made by syncAuthHTML(). opts: { withToken, onDone } (onDone runs once someone is signed in). */
  function bindSyncAuth(root, opts) {
    opts = opts || {};
    const q = (name) => root.querySelector(`[data-sy="${name}"]`);
    const form = q('form'), err = q('err'), note = q('note'), emailEl = q('email'), passEl = q('pass');
    const signOpts = opts.withToken ? { withToken: true } : undefined;
    let creating = false;

    const busy = (on) => root.querySelectorAll('button, input').forEach((el) => { el.disabled = on; });
    const paint = () => {
      q('submit').textContent = creating ? 'Create account' : 'Sign in';
      q('mode').textContent = creating ? 'I already have an account' : 'Create an account';
      q('forgot').hidden = creating;
      q('hint').hidden = !creating;
      passEl.autocomplete = creating ? 'new-password' : 'current-password';
      err.textContent = ''; note.textContent = '';
    };
    const finish = async () => { if (Sync.status().user && opts.onDone) await opts.onDone(); };
    paint();

    q('google').onclick = async () => {
      err.textContent = ''; note.textContent = '';
      busy(true);
      try { wantsRefresh(); await Sync.signIn(signOpts); await finish(); } catch (e) { err.textContent = (e && e.message) || 'Could not sign in.'; }
      busy(false);
    };
    q('mode').onclick = () => { creating = !creating; paint(); };
    q('forgot').onclick = async () => {
      err.textContent = ''; note.textContent = '';
      const email = emailEl.value.trim();
      if (!email) { err.textContent = 'Enter your email address above first.'; emailEl.focus(); return; }
      busy(true);
      try {
        await Sync.resetPassword(email);
        note.textContent = `If an account exists for ${email}, an email with a link to choose a new password is on its way.`;
      } catch (e) { err.textContent = (e && e.message) || 'Could not send the email.'; }
      busy(false);
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = ''; note.textContent = '';
      const email = emailEl.value.trim(), pw = passEl.value;
      if (!email) { err.textContent = 'Enter your email address.'; emailEl.focus(); return; }
      if (!pw) { err.textContent = 'Enter your password.'; passEl.focus(); return; }
      busy(true);
      try {
        wantsRefresh();
        if (creating) await Sync.signUpEmail(email, pw, signOpts); else await Sync.signInEmail(email, pw, signOpts);
        await finish();
      } catch (e2) { err.textContent = (e2 && e2.message) || 'Could not sign in.'; }
      busy(false);
    };
  }

  /** A small dialog with the sign-in form, for the places outside Settings. */
  function openSyncDialog(opts) {
    opts = opts || {};
    Sync.preload();
    openModal(`<h2>${esc(opts.title || 'Sign in to sync')}</h2>
      <p class="muted">${esc(opts.intro || 'Keep your plan and settings the same on every device you use. Sign in with Google, or with an email address and password. They are stored in your own Firebase project, readable only by your account.')}</p>
      ${syncAuthHTML()}`);
    bindSyncAuth($('#modal-body .sy-auth'), {
      withToken: opts.withToken,
      onDone: async () => { dlg.close(); if (opts.onDone) await opts.onDone(); },
    });
    const first = $('#modal-body [data-sy=email]'); if (first) first.focus();
  }

  function renderSyncCard() {
    const el = $('#s-sync');
    if (!el) return;
    const st = Sync.status();
    if (!st.configured) {
      el.innerHTML = '<p class="muted">Not set up. Add your Firebase details to <b>js/config.js</b> (the steps are in SYNC.md) to keep your plan and settings in step across your devices.</p>';
      return;
    }
    Sync.preload();
    const when = st.last ? 'Last synced ' + new Date(st.last).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.' : '';
    if (!st.user) {
      el.innerHTML = `<p class="muted">Sign in to keep your plan and settings the same on every device you use. They are stored in your own Firebase project, readable only by your account.</p>
        ${st.error ? `<p class="error">${esc(st.error)}</p>` : ''}
        ${syncAuthHTML()}`;
      bindSyncAuth(el.querySelector('.sy-auth'), { onDone: async () => renderSyncCard() });
    } else {
      const needsVerify = st.user.password && !st.user.verified;
      el.innerHTML = `<p class="muted">Signed in as ${esc(st.user.email || st.user.name || 'your account')}. Your plan and settings sync automatically. ${st.busy ? 'Syncing…' : esc(when)}</p>
        ${needsVerify ? '<p class="muted">Your email address is not verified yet. Open the link in the email we sent you. <button class="link inline" id="s-sy-verify" type="button">Send it again</button></p>' : ''}
        ${st.error ? `<p class="error">${esc(st.error)}</p>` : ''}
        ${st.tokenAllowed ? UI.switchHTML('s-sy-token', st.withToken, 'Also sync my API token', 'Lets a new device restore everything by signing in to your account alone. The token is stored in the sync database, so use this only if you are comfortable with that. Turning it off removes it from there.') : ''}
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
          <button class="btn ghost small" id="s-sy-now" type="button"${st.busy ? ' disabled' : ''}>Check now</button>
          <button class="btn ghost small" id="s-sy-out" type="button">Sign out of sync</button>
          <button class="btn ghost small" id="s-sy-del" type="button">Delete my synced data</button>
        </div>`;
      const tk = $('#s-sy-token'); if (tk) tk.onchange = (e) => Sync.setTokenSync(e.target.checked);
      const vf = $('#s-sy-verify');
      if (vf) vf.onclick = async () => {
        vf.disabled = true;
        try { await Sync.sendVerification(); toast('Verification email sent.'); } catch (e) { toast((e && e.message) || 'Could not send it.'); }
        vf.disabled = false;
      };
      $('#s-sy-del').onclick = async () => {
        const ok = await UI.confirm({ title: 'Delete your synced data?', message: 'This removes your plan and settings from the sync database and turns sync off on this device. Nothing on this device is deleted.', ok: 'Delete', danger: true });
        if (!ok) return;
        try { await Sync.deleteData(); toast('Your synced data was deleted.'); } catch (e) { toast((e && e.message) || 'Could not delete it.'); }
        renderSyncCard();
      };
      $('#s-sy-now').onclick = () => Sync.syncNow();
      $('#s-sy-out').onclick = async () => { await Sync.signOut(); renderSyncCard(); };
    }
    renderSyncCard.uid = st.user ? st.user.uid : '';
    // Keep the card current while the dialog is open (a sync finishing, an error, signing in).
    if (!renderSyncCard.off) {
      renderSyncCard.off = Sync.on(() => {
        if (!$('#s-sync')) { renderSyncCard.off(); renderSyncCard.off = null; return; }
        // Do not rebuild the sign-in form under someone who is typing in it (unless they have just signed in or out).
        const ae = document.activeElement;
        const nowUid = (Sync.status().user || {}).uid || '';
        if (ae && ae.tagName === 'INPUT' && ae.closest && ae.closest('#s-sync') && nowUid === renderSyncCard.uid) return;
        if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#s-sync') && document.activeElement.id === 's-sy-token') return;
        renderSyncCard();
      });
    }
  }

  // New data arrived from another device. Show it by refreshing the page, but never in the middle of a quiz,
  // while a dialog is open or while you are typing: then it waits until you are done.
  let pendingRefresh = null; // 'reload' | 'route'
  let forceUntil = 0;
  const inQuiz = () => /^#\/?(reviews|lessons)/.test(location.hash);
  const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  const wantsRefresh = () => { forceUntil = Date.now() + 30000; }; // the person just signed in: show what arrived right away

  function flushRefresh() {
    if (!pendingRefresh || !api.token || inQuiz()) return;
    const forced = Date.now() < forceUntil;
    if (!forced && (dlg.open || typing())) return;
    const kind = pendingRefresh;
    pendingRefresh = null;
    let recent = false;
    try { recent = Date.now() - Number(sessionStorage.getItem('kl_reload_at') || 0) < 15000; } catch (e) { /* ignore */ }
    if (kind === 'reload' && !recent) {
      try { sessionStorage.setItem('kl_reload_at', String(Date.now())); } catch (e) { /* ignore */ }
      location.reload();
    } else if (!dlg.open) route();
  }
  window.addEventListener('kl-synced', (e) => {
    const keys = (e.detail && e.detail.keys) || [];
    // Only the review counts changed: redraw quietly. Anything else: reload so every screen shows it.
    pendingRefresh = keys.some((k) => k !== 'kl_rev_days') ? 'reload' : (pendingRefresh || 'route');
    flushRefresh();
  });
  window.addEventListener('hashchange', () => setTimeout(flushRefresh, 0));
  dlg.addEventListener('close', () => setTimeout(flushRefresh, 0));
  document.addEventListener('focusout', () => setTimeout(flushRefresh, 400));

  // Sign in from the header or the home banner: a small dialog with the Google and email options.
  function signInToSync() { openSyncDialog(); }

  function paintSyncButton() {
    const b = $('#sync-btn');
    if (!b) return;
    if (!Sync.configured) { b.hidden = true; return; }
    b.hidden = false;
    const st = Sync.status();
    let state = 'off', long = 'Sign in to sync', short = 'Sync', tip = 'Sign in to keep your plan and settings the same on all your devices.';
    if (st.user) {
      if (st.error) { state = 'error'; long = 'Sync error'; tip = st.error; }
      else if (st.busy) { state = 'busy'; long = 'Syncing…'; tip = 'Syncing your plan and settings.'; }
      else { state = 'ok'; long = 'Synced'; tip = 'Your plan and settings are kept in sync automatically. Open Settings to manage.'; }
    } else if (st.remembered) { state = 'busy'; long = 'Sync'; tip = 'Connecting to sync…'; }
    b.dataset.state = state;
    b.querySelector('.sync-long').textContent = long;
    b.querySelector('.sync-short').textContent = short;
    b.title = tip;
    b.setAttribute('aria-label', long === 'Sync' ? 'Sync' : long);
  }
  $('#sync-btn').addEventListener('click', () => {
    const st = Sync.status();
    if (!st.user && !st.remembered) { signInToSync(); return; }
    openSettings();
    setTimeout(() => { const el = $('#s-sync'); if (el) el.scrollIntoView({ block: 'center' }); }, 50);
  });
  if (Sync.configured) Sync.on(paintSyncButton);
  paintSyncButton();

  // ---------- settings ----------
  const setSessionSize = (v) => {
    localStorage.setItem('kl_session_size', String(clampInt(v, 0, 5000)));
    window.dispatchEvent(new Event('kl-settings')); // screens showing a setting keep in step with it
  };
  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v))));

  const bindSel = (id, fn) => UI.bindSelect($('#' + id).closest('[data-select]'), fn);

  /** Settings dialog. General holds appearance, lessons and the account; Reviews holds review options only. */
  function openSettings(tab) {
    const which = tab === 'reviews' ? 'reviews' : 'general';
    const nums = (list) => list.map((n) => ({ value: n, label: String(n) }));
    const delays = [[0, 'Off'], [500, '0.5 seconds'], [1000, '1 second'], [1500, '1.5 seconds'], [2000, '2 seconds'], [3000, '3 seconds']]
      .map(([value, label]) => ({ value, label }));
    const themes = [{ value: 'system', label: 'Match my device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark (matte black)' }];
    const firsts = [{ value: 'random', label: 'Random' }, { value: 'meaning', label: 'Meaning' }, { value: 'reading', label: 'Reading' }];

    openModal(`<h2>Settings</h2>
      <div class="tabs" role="tablist" aria-label="Settings sections">
        <button type="button" role="tab" id="tab-general" data-tab="general" aria-controls="panel-general" aria-selected="${which === 'general'}" tabindex="${which === 'general' ? 0 : -1}">General</button>
        <button type="button" role="tab" id="tab-reviews" data-tab="reviews" aria-controls="panel-reviews" aria-selected="${which === 'reviews'}" tabindex="${which === 'reviews' ? 0 : -1}">Reviews</button>
      </div>

      <div role="tabpanel" id="panel-general" aria-labelledby="tab-general"${which === 'general' ? '' : ' hidden'}>
        <section class="setcard"><h3>Appearance</h3>
          <div class="field"><label for="s-theme">Theme</label>${UI.selectHTML('s-theme', themes, settings.theme)}</div>
        </section>
        <section class="setcard"><h3>Lessons</h3>
          <div class="field"><label for="s-batch">Lessons per batch</label>${UI.selectHTML('s-batch', nums([3, 5, 7, 10]), settings.lessonBatch)}
            <span class="muted">How many new items you study before each quiz.</span></div>
        </section>
        <section class="setcard"><h3>Notifications</h3>
          ${UI.switchHTML('s-notify', Notify.enabled(), 'Notify me when new reviews are available', 'Shown while KanjiLite is open in a browser tab, including a background tab.')}
          <div class="field"><label for="s-notify-min">Only when at least this many are due</label>
            ${UI.stepperHTML('s-notify-min', Notify.minReviews(), { min: 1, max: 500, step: 1, label: 'Minimum reviews for a notification' })}</div>
          <p class="muted" id="s-notify-status">${esc(Notify.statusText())}</p>
          <button class="btn ghost small" id="s-notify-test" type="button">Send a test notification</button>
        </section>
        <section class="setcard"><h3>Sync across devices</h3><div id="s-sync"></div></section>
        <section class="setcard"><h3>Back up and restore</h3>
          <p class="muted">Your plan and settings live in this browser. If the browser clears its data they go with it, so keep a copy to restore from.</p>
          ${UI.switchHTML('s-bk-token', false, 'Include my API token in the file', 'The file would then give access to your WaniKani account, within the permissions of your token. Keep it private.')}
          <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
            <button class="btn ghost small" id="s-bk-save" type="button">Save backup file</button>
            <button class="btn ghost small" id="s-bk-load" type="button">Restore from file</button>
            <input type="file" id="s-bk-file" accept="application/json,.json" hidden>
          </div>
          <p class="muted" id="s-bk-status" style="margin-top:8px"></p>
        </section>
        <section class="setcard"><h3>Account</h3>
          <p class="muted">Your token is stored only in this browser and sent only to WaniKani.</p>
          <button class="btn ghost" id="s-logout" type="button">Log out</button>
        </section>
      </div>

      <div role="tabpanel" id="panel-reviews" aria-labelledby="tab-reviews"${which === 'reviews' ? '' : ' hidden'}>
        <section class="setcard"><h3>Session</h3>
          <div class="field"><label for="s-size">Reviews per session</label>
            ${UI.stepperHTML('s-size', settings.sessionSize, { min: 0, max: 5000, step: 5, label: 'Reviews per session' })}
            <span class="muted">Any number you like. 0 means everything that’s due.</span></div>
        </section>
        <section class="setcard"><h3>Questions</h3>
          ${UI.switchHTML('s-b2b', settings.backToBack, 'Ask an item’s reading and meaning back to back')}
          <div class="field"><label for="s-first">Question asked first</label>${UI.selectHTML('s-first', firsts, settings.firstQ)}</div>
        </section>
        <section class="setcard"><h3>Audio</h3>
          ${UI.switchHTML('s-autoplay', settings.autoplay, 'Play audio after a correct answer', 'Plays the native-speaker recording of a vocabulary word. Kanji and radicals don’t play automatically. Off by default.')}
        </section>
        <section class="setcard"><h3>After a wrong answer</h3>
          <div class="field"><label for="s-delay">Lock “Next” for</label>${UI.selectHTML('s-delay', delays, settings.wrongDelay)}
            <span class="muted">Keeps a stray extra Enter press from skipping the correction. Undo still works.</span></div>
        </section>
        <section class="setcard"><h3>Display</h3>
          ${UI.switchHTML('s-level', settings.showLevel, 'Show the item’s level on review cards')}
          ${UI.switchHTML('s-stage', settings.showStage, 'Show the item’s SRS stage on review cards')}
          ${UI.switchHTML('s-srstoast', settings.srsToast, 'Show the new SRS stage after each answer')}
        </section>
      </div>

      <div class="row end" style="margin-top:18px"><button class="btn" data-close type="button">Done</button></div>`);

    const tabs = [...dlg.querySelectorAll('[role=tab]')];
    const show = (name, focus) => {
      UI.closeSelect();
      tabs.forEach((t) => {
        const on = t.dataset.tab === name;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        $('#panel-' + t.dataset.tab).hidden = !on;
        if (on && focus) t.focus();
      });
    };
    tabs.forEach((t) => {
      t.onclick = () => show(t.dataset.tab);
      t.onkeydown = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const i = tabs.indexOf(t);
        show(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].dataset.tab, true);
      };
    });
    $('[role=tab][aria-selected=true]').focus();

    bindSel('s-theme', (v) => { localStorage.setItem('kl_theme', v); applyTheme(); });
    bindSel('s-batch', (v) => localStorage.setItem('kl_lesson_batch', String(v)));
    bindSel('s-first', (v) => localStorage.setItem('kl_first', v));
    bindSel('s-delay', (v) => localStorage.setItem('kl_wrong_delay', String(v)));
    UI.bindStepper($('#s-size').closest('[data-stepper]'), setSessionSize);
    $('#s-b2b').onchange = (e) => localStorage.setItem('kl_b2b', e.target.checked ? '1' : '0');
    $('#s-autoplay').onchange = (e) => { localStorage.setItem('kl_autoplay', e.target.checked ? '1' : '0'); if (!e.target.checked && window.Sound) Sound.stop(); };
    $('#s-level').onchange = (e) => localStorage.setItem('kl_show_level', e.target.checked ? '1' : '0');
    $('#s-stage').onchange = (e) => localStorage.setItem('kl_show_stage', e.target.checked ? '1' : '0');
    $('#s-srstoast').onchange = (e) => localStorage.setItem('kl_srs_toast', e.target.checked ? '1' : '0');
    const nStatus = () => { $('#s-notify-status').textContent = Notify.statusText(); };
    $('#s-notify').onchange = async (e) => {
      if (!e.target.checked) { Notify.disable(); nStatus(); return; }
      const p = await Notify.enable();
      if (p !== 'granted') e.target.checked = false;
      nStatus();
    };
    UI.bindStepper($('#s-notify-min').closest('[data-stepper]'), (v) => Notify.setMin(v));
    $('#s-notify-test').onclick = async () => {
      if (Notify.permission() !== 'granted') { const p = await Notify.enable(); $('#s-notify').checked = Notify.enabled(); nStatus(); if (p !== 'granted') return; }
      if (!(await Notify.test())) toast('The browser wouldn’t show the notification.');
    };
    renderSyncCard();
    $('#s-bk-save').onclick = () => Backup.save($('#s-bk-token').checked);
    $('#s-bk-load').onclick = () => $('#s-bk-file').click();
    $('#s-bk-file').onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) Backup.restore(f); };
    Keep.status().then((t) => { const el = $('#s-bk-status'); if (el) el.textContent = t; });
    $('#s-logout').onclick = async () => {
      const left = api.pending().length + api.pendingStarts().length;
      const ok = await UI.confirm({
        title: 'Log out?',
        message: left ? `You have ${left} finished review(s) or lesson(s) that haven’t been sent to WaniKani yet. Logging out will discard them.` : 'This removes your token and the saved copy of your data from this browser.',
        ok: 'Log out', danger: true,
      });
      if (!ok) return;
      Notify.stop(); await Local.wipe(); api.reset(); Stats.reset(); Session.clear(); userCache = null; dlg.close(); go('#/');
    };
  }
  $('#open-settings').addEventListener('click', () => openSettings());

  // After the dialog closes in the middle of a quiz, put the cursor back where it was.
  dlg.addEventListener('close', () => {
    const f = $('.quiz #q-input:not([readonly])') || $('.quiz #q-go');
    if (f) f.focus();
  });

  // ---------- routing ----------
  let routeSeq = 0;
  let cleanup = null;
  let userCache = null;
  let userRefresh = null;
  let onUserChange = null; // set by the dashboard so a level-up shows without a reload

  function readUser() {
    try { const x = JSON.parse(localStorage.getItem('kl_user')); return x && x.u && x.u.id ? x : null; } catch (e) { return null; }
  }
  function fetchUser(background) {
    return api.request('/user', { background }).then((r) => {
      userCache = { t: Date.now(), u: r.data };
      try { localStorage.setItem('kl_user', JSON.stringify(userCache)); } catch (e) { /* ignore */ }
      return r.data;
    });
  }
  const userKnown = () => !!(userCache || readUser());

  /**
   * Who you are and your level. Answered from the saved copy straight away; if that copy is more than a few
   * minutes old it is refreshed quietly in the background. Only the very first call waits for the network.
   */
  async function getUser(force) {
    if (!userCache) userCache = readUser();
    if (force || !userCache) return fetchUser(false);
    if (Date.now() - userCache.t > 5 * 60000 && !userRefresh) {
      const before = userCache.u.level;
      userRefresh = fetchUser(true)
        .then((u) => { if (u.level !== before && onUserChange) onUserChange(); })
        .catch(syncFailed)
        .finally(() => { userRefresh = null; });
    }
    return userCache.u;
  }

  // A background sync that finds the token revoked sends you to the login screen; any other failure is ignored
  // (the saved data keeps working and the next sync tries again).
  function syncFailed(err) {
    if (err && err.status === 401 && api.token) {
      api.token = ''; userCache = null;
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
    Notify.start({ summary: () => Local.summary(), sync: () => Local.refresh({ minAge: 60000 }), subscribe: Local.subscribe });
    return user;
  }

  function route() {
    const my = ++routeSeq;
    if (cleanup) { cleanup(); cleanup = null; }
    UI.closeSelect();
    if (dlg.open) dlg.close();
    window.scrollTo(0, 0);
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const name = parts[0] || 'home';
    $('#nav').hidden = !api.token;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', (a.dataset.nav || 'home') === name));
    if (!api.token) return loginView();
    const views = { home: homeView, reviews: reviewsView, lessons: lessonsView, levels: levelsView, stats: statsView, search: searchView, plan: planView };
    (views[name] || homeView)(my, parts[1]).catch((err) => fail(err, my));
  }
  window.addEventListener('hashchange', route);

  function fail(err, my) {
    if (my !== routeSeq) return;
    if (err && err.status === 401) { api.token = ''; userCache = null; try { localStorage.removeItem('kl_user'); } catch (e) { /* ignore */ } return loginView(err.message); }
    app.innerHTML = `<div class="wrap center"><h1>Something went wrong</h1><p class="error">${esc(err && err.message ? err.message : err)}</p>
      <div class="row" style="justify-content:center"><button class="btn" id="retry">Try again</button><a class="btn ghost" href="#/">Home</a></div></div>`;
    $('#retry').onclick = route;
  }

  // ---------- login ----------
  function loginView(msg) {
    $('#nav').hidden = true;
    app.innerHTML = `<div class="wrap login">
      <h1>鰐 KanjiLite</h1>
      <p>A small, unofficial client for your WaniKani account: lessons, reviews and a level browser.</p>
      <form id="login-form">
        <label for="tok">WaniKani API token</label>
        <input id="tok" type="password" autocomplete="off" spellcheck="false" required>
        <button class="btn" style="margin-top:14px" type="submit">Connect</button>
        <div class="error" id="login-err">${esc(msg || '')}</div>
      </form>
      ${Sync.configured && Sync.status().tokenAllowed ? '<div class="login-alt"><p class="fine">Already use KanjiLite on another device?</p><button class="btn ghost" id="login-google" type="button">Sign in to restore</button></div>' : ''}
      <p class="fine">Create a token under <a href="https://www.wanikani.com/settings/personal_access_tokens" target="_blank" rel="noopener">Settings, Personal Access Tokens</a> on WaniKani. Tick <b>assignments:start</b> and <b>reviews:create</b> so your lessons and reviews are saved. The token stays in this browser and is only sent to api.wanikani.com.</p>
    </div>`;
    const lg = $('#login-google');
    if (lg) {
      Sync.preload();
      lg.onclick = () => openSyncDialog({
        title: 'Restore from your account',
        intro: 'Sign in with the Google or email account you use for sync. Your API token comes back with it if you chose to sync it.',
        withToken: true,
        onDone: async () => {
          await Sync.syncNow();
          if (api.token) { go('#/'); return; }
          const le = $('#login-err');
          if (le) le.textContent = 'Signed in, but no API token was saved with your account. Paste it above; turn on “Also sync my API token” in Settings to save it.';
        },
      });
    }
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      api.token = $('#tok').value.trim();
      try {
        await getUser(true);
        Keep.request();
        go('#/');
      } catch (err) {
        api.token = '';
        $('#login-err').textContent = err.message;
        btn.disabled = false;
      }
    });
  }

  // ---------- home ----------
  // Everything on this screen is worked out from the saved copy of your data, so it opens instantly, costs no
  // requests, and keeps itself current (counts change as reviews become due, uploads finish, syncs arrive).
  async function homeView(my) {
    const stale = () => my !== routeSeq;
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
    Stats.bind(user.id);
    // What the widgets below the progress bars are built from. Filled from the saved copies first, refreshed in the background.
    const X = { lp: null, hist: null, rs: null, rsSummary: null, subs: new Map(), progress: null };

    function draw(force) {
      if (stale()) return;
      const u = userCache ? userCache.u : user;
      const sd = Local.summary();
      const pendR = api.pending().length;
      const pendS = api.pendingStarts().length;
      const snap = Session.load();
      const sig = JSON.stringify([u.level, sd, pendR, pendS, snap && snap.items.length]);
      if (!force && sig === shown) return;
      // Don't rebuild the screen under someone who is typing in the session-length box.
      if (!force && app.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      shown = sig;

      const maxUp = Math.max(1, ...sd.upcoming.map((x) => x.count));
      const syncSt = Sync.status();
      const syncHint = Sync.configured && !syncSt.user && !syncSt.remembered && localStorage.getItem('kl_sync_hint') !== '0';
      const waiting = [pendR ? `<b>${pendR} finished review${pendR > 1 ? 's' : ''}</b>` : '', pendS ? `<b>${pendS} started lesson${pendS > 1 ? 's' : ''}</b>` : ''].filter(Boolean).join(' and ');
      app.innerHTML = `<div class="wrap">
        <div class="greet"><h1>Hello, ${esc(u.username)}</h1><p class="muted">Level ${u.level}</p></div>
        ${waiting ? `<div class="banner">${waiting} still waiting to be sent to WaniKani. <button class="link" id="retry-sync" type="button">Send now</button></div>` : ''}
        ${syncHint ? '<div class="banner info">Keep your plan and settings the same on all your devices. <button class="link" id="sync-hint-in" type="button">Sign in</button> <button class="link" id="sync-hint-x" type="button">Not now</button></div>' : ''}
        ${snap ? `<div class="banner info">You have an unfinished review session with <b>${snap.items.length} item${snap.items.length > 1 ? 's' : ''}</b> left. Open Reviews to pick it up. <button class="link" id="discard-session" type="button">Discard it</button></div>` : ''}
        <div id="dash-plan">${planHtml}</div>
        <div id="dash-today">${todayHtml}</div>
        <div class="todo">
          <a class="reviews${sd.reviews ? '' : ' off'}" href="#/reviews"><span class="what">Reviews</span><span class="count">${sd.reviews}</span></a>
          <a class="lessons${sd.lessons ? '' : ' off'}" href="#/lessons"><span class="what">Lessons</span><span class="count">${sd.lessons}</span></a>
        </div>
        <div id="lvl-progress">${progressHtml}</div>
        <div id="dash-numbers">${numbersHtml}</div>
        <div id="dash-critical">${critHtml}</div>
        <div class="panel session-panel">
          <label for="h-size"><b>Reviews per session</b></label>
          ${UI.stepperHTML('h-size', settings.sessionSize, { min: 0, max: 5000, step: 5, label: 'Reviews per session' })}
          <span class="muted">0 means everything that’s due. <button class="link inline" id="h-more" type="button">More review options</button></span>
        </div>
        <div class="panel">
          <h2>Coming up</h2>
          ${sd.upcoming.length ? `<div class="forecast">${sd.upcoming.map((x) => `<div><span>${esc(hourLabel(x.available_at))}</span><span><span class="bar" style="display:block;width:${Math.max(4, Math.round(x.count / maxUp * 100))}%"></span></span><span class="n">${x.count}</span></div>`).join('')}</div>`
            : `<p class="muted">${sd.nextReviewsAt ? 'Next reviews: ' + esc(new Date(sd.nextReviewsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })) : 'Nothing scheduled in the next 24 hours.'}</p>`}
        </div>
      </div>`;

      bindPlan();
      UI.bindStepper($('#h-size').closest('[data-stepper]'), (v) => { setSessionSize(v); toast('Session length saved.'); });
      $('#h-more').onclick = () => openSettings('reviews');
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

    function bindPlan() {
      const d = $('#plan-dismiss');
      if (d) d.onclick = () => { Plan.dismiss(); planHtml = ''; const b = $('#dash-plan'); if (b) b.innerHTML = ''; };
    }

    // Level progress, split into radicals, kanji and vocabulary and coloured by SRS stage.
    // 90% of the level's kanji at Guru or above unlocks the next level.
    async function drawProgress() {
      try {
        const lvl = (userCache ? userCache.u : user).level;
        const subs = await Local.levelSubjects(lvl, { background: true });
        if (stale()) return;
        progressHtml = Dash.levelProgress(lvl, subs, Local.assignmentFor);
        const kanji = subs.filter((x) => x.object === 'kanji' && !x.data.hidden_at);
        const need = Math.ceil(kanji.length * 0.9);
        const done = kanji.filter((x) => { const a = Local.assignmentFor(x.id); return a && a.data.srs_stage >= 5; }).length;
        X.progress = need ? { fraction: Math.min(1, done / need) } : null;
        const box = $('#lvl-progress');
        if (box) box.innerHTML = progressHtml;
      } catch (e) { /* progress is a nice-to-have */ }
      paintExtras();
    }

    // "Your numbers" and "Critical condition".
    function paintExtras() {
      if (stale()) return;
      const u = userCache ? userCache.u : user;
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

      // Off-track warning against the saved plan (needs the level progress, so it waits for that).
      const plan = Plan.load(user.id);
      planHtml = plan && X.progress && !Plan.dismissedToday() ? PlanView.banner(plan, Plan.evaluate(plan, lvl + X.progress.fraction, now)) : '';
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
          // Reviews a day from new lessons at your accuracy now (the saved figure is from when you made the plan).
          rpd: plan.lpd ? Plan.reviewsPerDay(plan.lpd, Math.max(1, (plan.end - plan.start) / 86400000), acc != null ? acc : planAcc) : 0,
        });
      } else todayHtml = '';
      const tb = $('#dash-today'); if (tb) tb.innerHTML = todayHtml;

      if (!X.rs) { critHtml = Dash.critical(null, 0, 75, tile); }
      else {
        const live = (id) => { const a = Local.assignmentFor(id); return !!a && !a.data.hidden && a.data.srs_stage >= 1 && a.data.srs_stage < 9; };
        const cr = Stats.criticalItems(X.rs.rows, live, { below: 75, limit: 8 });
        const missing = cr.items.map((x) => x.id).filter((id) => !X.subs.has(id));
        if (missing.length) {
          api.getSubjects(missing, { background: true }).then((m) => { m.forEach((v, k) => X.subs.set(k, v)); paintExtras(); }).catch(() => {});
        }
        const items = cr.items.filter((x) => X.subs.has(x.id)).map((x) => Object.assign({ subject: X.subs.get(x.id) }, x));
        critHtml = Dash.critical(missing.length && !items.length ? null : items, cr.count, 75, tile);
      }
      const cb = $('#dash-critical'); if (cb) cb.innerHTML = critHtml;
    }

    async function loadExtras() {
      try {
        const [lp, hist, rs] = await Promise.all([Stats.savedProgressions(), Stats.savedHistory(), Stats.savedReviewStats()]);
        if (stale()) return;
        X.lp = lp ? lp.rows : null; X.hist = hist; X.rs = rs; X.rsSummary = null;
        paintExtras();
        if (!lp || Date.now() - lp.at > 5 * 60000) {
          Stats.fetchProgressions({ background: true }).then((rows) => { X.lp = rows; paintExtras(); }).catch(() => {});
        }
        if (!rs || Date.now() - rs.at > 30 * 60000) {
          Stats.syncReviewStats({}).then((r) => { X.rs = r; X.rsSummary = null; paintExtras(); }).catch(() => {});
        }
      } catch (e) { /* these widgets are a nice-to-have */ }
    }

    const redraw = () => { draw(); drawProgress(); };
    draw(true);
    drawProgress();
    loadExtras();
    // Once the quiet sync from opening the app has finished, redraw so today's review total is worked out from fresh data.
    Promise.resolve(Local._refreshing).catch(() => {}).then(() => { if (!stale()) paintExtras(); });

    // Keep it current: when data changes, once a half-minute (reviews fall due with time), and a quiet sync every few minutes.
    onUserChange = () => { draw(true); drawProgress(); };
    // The review length can also be changed in Settings, so keep the box on this screen in step with it.
    const onSettings = () => { const st = $('#h-size'); if (st) UI.setStepper(st.closest('[data-stepper]'), settings.sessionSize); };
    window.addEventListener('kl-settings', onSettings);
    const unsub = Local.subscribe(redraw);
    const tick = setInterval(() => { if (document.visibilityState === 'visible') draw(); }, 30000);
    const sync = setInterval(() => { if (document.visibilityState === 'visible') Local.refresh({ minAge: 4 * 60000 }).catch(syncFailed); }, 60000);
    cleanup = () => { clearInterval(tick); clearInterval(sync); unsub(); onUserChange = null; window.removeEventListener('kl-settings', onSettings); };

    // Send anything waiting, in the background.
    if (api.pending().length || api.pendingStarts().length) flushBg().then(() => draw());
  }

  // ---------- search ----------
  async function searchView(my, arg) {
    loading('Loading…');
    await ensureLocal();
    if (my !== routeSeq) return;
    let query = '';
    try { query = decodeURIComponent(arg || ''); } catch (e) { query = arg || ''; }
    SearchView.mount({ el: app, query, tile, toast, syncFailed, setCleanup: (fn) => { cleanup = fn; } });
  }

  // ---------- stats ----------
  async function statsView(my) {
    loading('Loading stats…');
    const user = await ensureLocal();
    if (my !== routeSeq) return;
    StatsView.mount({
      el: app,
      user,
      currentUser: () => (userCache ? userCache.u : user),
      tile,
      syncFailed,
      setCleanup: (fn) => { cleanup = fn; },
    });
  }

  // ---------- plan ----------
  async function planView(my) {
    loading('Loading plan…');
    const user = await ensureLocal();
    if (my !== routeSeq) return;
    PlanView.mount({
      el: app, user, toast, syncFailed,
      currentUser: () => (userCache ? userCache.u : user),
      setCleanup: (fn) => { cleanup = fn; },
    });
  }

  // ---------- levels ----------
  async function levelsView(my, arg) {
    const stale = () => my !== routeSeq;
    loading('Loading level…');
    const user = await ensureLocal();
    const max = user.subscription && user.subscription.max_level_granted ? user.subscription.max_level_granted : 60;
    const lvl = Math.min(60, Math.max(1, Number(arg) || user.level));
    const subs = await Local.levelSubjects(lvl); // saved copy, or fetched once and kept
    if (stale()) return;
    const amap = { get: (id) => Local.assignmentFor(id) };
    const visible = subs.filter((s) => !s.data.hidden_at);
    const group = (types) => visible.filter((s) => types.includes(s.object)).sort((a, b) => a.data.lesson_position - b.data.lesson_position);
    const section = (title, list, opts) => (list.length ? `<div class="group"><h2>${title}</h2><div class="tiles">${list.map((s) => tile(s, amap.get(s.id) || null, opts)).join('')}</div></div>` : '');
    const kanjiList = group(['kanji']);
    const kDone = kanjiList.filter((s) => { const a = amap.get(s.id); return a && a.data.srs_stage >= 5; }).length;
    const kNeed = Math.ceil(kanjiList.length * 0.9);
    const kSummary = kanjiList.length ? `<p class="muted kanji-sum"><b>${kDone} of ${kanjiList.length}</b> kanji have reached Guru I or beyond. ${kNeed} are needed to pass this level.</p>` : '';

    app.innerHTML = `<div class="wrap">
      <div class="lvlbar"><h1 style="margin:0">Level</h1>
        ${UI.selectHTML('lvl-select', Array.from({ length: 60 }, (_, i) => i + 1).map((n) => ({ value: n, label: `${n}${n > max ? ' (locked by plan)' : ''}` })), lvl, 'Level')}</div>
      <div class="legend"><span><i style="background:#ffd23f"></i>Apprentice</span><span><i style="background:#5ce08f"></i>Guru</span><span><i style="background:#3dc5ff"></i>Master</span><span><i style="background:#fff;border:1px solid var(--line)"></i>Enlightened</span><span><i style="background:#111"></i>Burned</span><span>Faded means locked</span><span><i class="lg-prog"></i>Bar on a kanji: progress to Guru I</span></div>
      ${kSummary}
      ${section('Radicals', group(['radical']))}${section('Kanji', kanjiList, { guru: true })}${section('Vocabulary', group(['vocabulary', 'kana_vocabulary']))}
    </div>`;
    UI.bindSelect($('#lvl-select').closest('[data-select]'), (v) => go('#/levels/' + v));
  }

  // ---------- quiz engine (reviews and the lesson quiz) ----------
  /** Your synonyms for an item right now, so ones added in the details during a session count immediately. */
  const liveSynonyms = (item) => Local.synonyms([item.subject.id]).get(item.subject.id) || item.synonyms || [];

  function makeItem(assignment, subject, synonyms) {
    const meaningOnly = subject.object === 'radical' || subject.object === 'kana_vocabulary';
    return { assignment, subject, synonyms: synonyms || [], pending: meaningOnly ? ['meaning'] : ['meaning', 'reading'], incorrect: { meaning: 0, reading: 0 } };
  }

  function runQuiz(opts) {
    const practice = !!opts.practice;
    const prog = opts.progress || {};
    const st = {
      queue: opts.items.slice(), pool: [], done: [], doneBase: prog.done || 0,
      total: prog.total || opts.items.length, answered: prog.answered || 0, correct: prog.correct || 0,
      cur: null, phase: 'ask', lastCorrect: false, undo: null, uncommitted: null, lockUntil: 0,
      refused0: api.refused,
    };
    const BATCH = 10;
    const doneN = () => st.doneBase + st.done.length;

    // A finished item is sent to WaniKani as soon as you move on to the next card
    // (until then "Undo answer" can still take it back).
    function commit() {
      const item = st.uncommitted;
      if (!item) return;
      st.uncommitted = null;
      if (practice) return;
      api.queueReview({
        assignment_id: item.assignment.id,
        incorrect_meaning_answers: item.incorrect.meaning,
        incorrect_reading_answers: item.incorrect.reading,
        created_at: new Date(api.now() - 1000).toISOString(),
      });
      // Counted for the streak, the "reviews today" figure and the review graphs.
      const from = item.assignment.data.srs_stage || 0;
      Stats.noteReview(undefined, { im: item.incorrect.meaning, ir: item.incorrect.reading, from, to: nextStage(from, item.incorrect.meaning + item.incorrect.reading) });
      flushBg(); // stays queued if it fails, retried later
    }

    // Progress on unfinished items (including half-answered ones) is saved after every answer.
    function save() {
      if (!opts.persist) return;
      const left = st.pool.concat(st.queue);
      if (!left.length) { Session.clear(); return; }
      Session.save({
        v: 1, savedAt: Date.now(), total: st.total, done: doneN(), answered: st.answered, correct: st.correct,
        items: left.map((i) => ({ a: i.assignment.id, p: i.pending, i: [i.incorrect.meaning, i.incorrect.reading] })),
      });
    }

    function pickKind(item) {
      const first = settings.firstQ;
      if (first !== 'random' && item.pending.includes(first)) return first;
      return rand(item.pending);
    }

    function next() {
      hideSrsToast();
      commit();
      while (st.pool.length < BATCH && st.queue.length) st.pool.push(st.queue.shift());
      if (!st.pool.length) {
        st.phase = 'done';
        if (opts.persist) Session.clear();
        opts.onFinish(st);
        return;
      }
      save();
      const prev = st.cur;
      let item;
      if (settings.backToBack && prev && st.lastCorrect && prev.item.pending.length && st.pool.includes(prev.item)) {
        item = prev.item; // keep going with the same item
      } else {
        let candidates = st.pool;
        if (candidates.length > 1 && prev) candidates = candidates.filter((i) => i !== prev.item);
        item = rand(candidates);
      }
      st.cur = { item, kind: pickKind(item) };
      st.undo = null;
      st.phase = 'ask';
      draw();
    }

    function updateTop() {
      const pct = st.total ? Math.round(doneN() / st.total * 100) : 0;
      const bar = $('#q-bar'); if (bar) bar.style.width = Math.min(100, pct) + '%';
      const stats = $('#q-stats');
      if (stats) stats.textContent = `${Math.max(0, st.total - doneN())} left` + (st.answered ? `, ${Math.round(st.correct / st.answered * 100)}% correct` : '');
    }

    function draw() {
      st.lockUntil = 0;
      const { item, kind } = st.cur;
      const s = item.subject;
      const label = `${TYPE_LABEL[s.object]} ${kind === 'reading' ? 'reading' : (s.object === 'radical' ? 'name' : 'meaning')}`;
      const stage = item.assignment.data.srs_stage || 0;
      const showLevel = settings.showLevel;
      const showStage = settings.showStage && !practice && stage > 0;
      const cardHTML = `<div class="qcard t-${typeClass(s.object)}">
            ${showLevel || showStage ? `<div class="qmeta">
              ${showLevel ? `<span class="qpill qlevel">Level ${s.data.level}</span>` : ''}
              ${showStage ? `<span class="qpill qstage" title="Current SRS stage">${esc(STAGES[stage])}</span>` : ''}
            </div>` : ''}
            <div class="qglyph ${glyphClass(s)}">${glyph(s)}</div>
            <div class="qlabel">${esc(label)}</div>
          </div>`;
      const isReading = kind === 'reading';
      let input = $('#q-input');
      const rebuild = !(input && $('#q-form') && $('#q-box') && app.firstElementChild && app.firstElementChild.classList.contains('quiz'));
      if (rebuild) {
        app.innerHTML = `<div class="quiz">
        <div class="qtop">
          <button class="link" id="q-quit" type="button">Quit</button>
          <span class="qstats" id="q-stats"></span>
          ${practice ? '<span></span>' : '<button class="link" id="q-wrap" type="button">Wrap up</button>'}
        </div>
        <div class="progress"><i id="q-bar"></i></div>
        <div class="qbox" id="q-box">
          ${cardHTML}
          <form id="q-form" class="answer" autocomplete="off">
            <input id="q-input" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done">
            <button id="q-go" type="submit">Check</button>
          </form>
        </div>
        <div class="qmsg" id="q-msg"></div>
        <div id="q-feedback"></div>
      </div>`;
        input = $('#q-input');
      } else {
        // Same input element, same focus: the on-screen keyboard stays open between questions.
        const box = $('#q-box');
        box.className = 'qbox';
        box.querySelector('.qcard').outerHTML = cardHTML;
        const form = $('#q-form');
        form.className = 'answer';
        const go = $('#q-go');
        go.textContent = 'Check';
        go.className = '';
        go.removeAttribute('aria-disabled');
        go.style.removeProperty('--lock');
        $('#q-feedback').innerHTML = '';
        input.classList.remove('shake');
        input.removeAttribute('aria-readonly');
        input.value = '';
        $('#q-msg').textContent = '';
        $('#q-msg').classList.remove('warn');
      }
      input.lang = isReading ? 'ja' : 'en';
      input.placeholder = isReading ? 'こたえ' : 'Your answer';
      input.setAttribute('aria-label', label);
      updateTop();
      // preventScroll: the page must not jump (and push the card off screen) when the keyboard comes up.
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      if (window.scrollY) window.scrollTo(0, 0);

      if (rebuild) {
        input.addEventListener('input', (e) => {
          if (st.phase !== 'ask') {
            // After an answer the box shows the verdict and must not change, but it stays focused so the keyboard stays up.
            if (input.value !== st.shown) input.value = st.shown || '';
            return;
          }
          if (e.isComposing || !st.cur || st.cur.kind !== 'reading') return;
          const v = Kana.toKana(input.value);
          if (v !== input.value) input.value = v;
        });
        input.addEventListener('beforeinput', (e) => { if (st.phase !== 'ask' && e.cancelable) e.preventDefault(); });
        // Tapping Check/Next must not pull focus off the answer box, or the keyboard closes.
        $('#q-go').addEventListener('mousedown', (e) => { if (coarsePointer()) e.preventDefault(); });
        $('#q-form').addEventListener('submit', (e) => {
          e.preventDefault();
          if (st.phase === 'ask') submit();
          else if (st.phase === 'feedback') {
            if (Date.now() < st.lockUntil) nudge(); // still locked after a wrong answer
            else next();
          }
        });
      }
      $('#q-quit').onclick = async () => {
        const ok = await UI.confirm({ title: 'Quit this session?', message: opts.quitMessage || 'Your progress will not be kept.', ok: 'Quit', cancel: 'Keep going', danger: true });
        if (ok) go('#/');
      };
      const wrap = $('#q-wrap');
      if (wrap) wrap.onclick = () => {
        st.queue = [];
        st.total = doneN() + st.pool.length;
        wrap.disabled = true;
        updateTop();
        save();
        toast('Wrapping up: finish the items already in progress.');
      };
    }

    function msg(text, warn) {
      const m = $('#q-msg');
      m.textContent = text || '';
      m.classList.toggle('warn', !!warn);
    }

    function submit() {
      const input = $('#q-input');
      const { item, kind } = st.cur;
      const res = kind === 'meaning' ? Check.meaning(item.subject, liveSynonyms(item), input.value) : Check.reading(item.subject, input.value);
      if (res.invalid) {
        msg(res.invalid, true);
        input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
        return;
      }
      // A reading is shown the way it was judged: romaji and a trailing n become kana, stray symbols are gone.
      if (kind === 'reading' && res.kana) input.value = res.kana;
      st.undo = {
        item, kind, value: input.value, pending: item.pending.slice(), incorrect: Object.assign({}, item.incorrect),
        answered: st.answered, correct: st.correct, lastCorrect: st.lastCorrect,
      };
      st.answered++;
      if (res.correct) { st.correct++; item.pending = item.pending.filter((k) => k !== kind); } else { item.incorrect[kind]++; }
      st.lastCorrect = !!res.correct;
      st.phase = 'feedback';
      if (res.correct && !item.pending.length) {
        st.pool = st.pool.filter((i) => i !== item);
        st.done.push(item);
        st.uncommitted = item;
      }
      // The SRS stage only changes once both questions are answered, but after a wrong answer we already
      // show where the item is heading (it can only go lower from here).
      let srs = null;
      if (!practice && settings.srsToast && (!res.correct || !item.pending.length)) {
        const from = item.assignment.data.srs_stage || 0;
        srs = { from, to: nextStage(from, item.incorrect.meaning + item.incorrect.reading) };
      }
      showFeedback(res);
      showSrsToast(srs);
      // Reviews only (not the lesson quiz), and only when switched on in Settings.
      if (res.correct && !practice && settings.autoplay && window.Sound) {
        Sound.autoplay(item.subject, () => st.cur && st.cur.item === item && st.phase === 'feedback');
      }
      updateTop();
      save();
    }

    function undo() {
      const u = st.undo;
      if (!u || st.phase !== 'feedback') return;
      const item = u.item;
      item.pending = u.pending;
      item.incorrect = u.incorrect;
      st.answered = u.answered;
      st.correct = u.correct;
      st.lastCorrect = u.lastCorrect;
      if (st.uncommitted === item) {
        st.uncommitted = null;
        st.done = st.done.filter((i) => i !== item);
        if (!st.pool.includes(item)) st.pool.unshift(item);
      }
      st.undo = null;
      st.cur = { item, kind: u.kind };
      st.phase = 'ask';
      hideSrsToast();
      if (window.Sound) Sound.stop();
      draw();
      const input = $('#q-input');
      input.value = u.value;
      input.select();
      save();
    }

    const ICON_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const ICON_BAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
    // Small pill at the top of the screen: where the item just moved to.
    let srsTimer = 0;
    function srsToastEl() {
      let el = $('#srs-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'srs-toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
      }
      return el;
    }
    function hideSrsToast() {
      clearTimeout(srsTimer);
      const el = $('#srs-toast');
      if (el) el.className = '';
    }
    function showSrsToast(srs) {
      if (!srs) return;
      const el = srsToastEl();
      const dir = srs.to > srs.from ? 'up' : srs.to < srs.from ? 'down' : 'same';
      const arrow = dir === 'up' ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10V2M2.5 5.5L6 2l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : dir === 'down' ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8M2.5 6.5L6 10l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
      el.innerHTML = `${arrow}<span>${esc(STAGES[srs.to])}</span>`;
      el.className = '';
      void el.offsetWidth; // restart the animation when answers come quickly
      el.className = 'show ' + dir;
      clearTimeout(srsTimer);
      srsTimer = setTimeout(hideSrsToast, 1900);
    }

    const coarsePointer = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // A brief wash of green or red over the whole screen.
    function flash(ok) {
      if (reduceMotion()) return;
      const f = document.createElement('div');
      f.className = 'flash ' + (ok ? 'ok' : 'bad');
      f.setAttribute('aria-hidden', 'true');
      f.addEventListener('animationend', () => f.remove());
      document.body.appendChild(f);
    }

    function nudge() {
      const b = $('#q-go');
      if (!b) return;
      b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge');
    }

    function showFeedback(res) {
      const { item, kind } = st.cur;
      const d = item.subject.data;
      const input = $('#q-input');
      const btn = $('#q-go');
      st.shown = input.value;
      input.setAttribute('aria-readonly', 'true');
      $('#q-form').classList.add(res.correct ? 'ok' : 'bad');
      btn.textContent = 'Next';
      msg('');

      // Right and wrong look and move differently: ring, badge, label bar, banner, flash, shake or pop.
      const box = $('#q-box');
      const card = $('.qcard');
      box.classList.add(res.correct ? 'res-ok' : 'res-bad');
      card.insertAdjacentHTML('beforeend', `<span class="qbadge ${res.correct ? 'ok' : 'bad'}" aria-hidden="true">${res.correct ? ICON_OK : ICON_BAD}</span>`);
      flash(res.correct);

      // After a wrong answer "Next" stays locked for a moment so a quick extra Enter can't skip the correction.
      const delay = res.correct ? 0 : settings.wrongDelay;
      st.lockUntil = delay > 0 ? Date.now() + delay : 0;
      if (delay > 0) {
        btn.classList.add('locking');
        btn.setAttribute('aria-disabled', 'true');
        btn.style.setProperty('--lock', delay + 'ms');
        setTimeout(() => { btn.classList.remove('locking'); btn.removeAttribute('aria-disabled'); }, delay);
      }

      let accepted;
      if (kind === 'meaning') {
        accepted = d.meanings.filter((m) => m.accepted_answer).map((m) => m.meaning).concat(liveSynonyms(item));
      } else {
        accepted = (d.readings || []).filter((r) => r.accepted_answer).map((r) => r.reading);
      }
      $('#q-feedback').innerHTML = `
        <div class="verdict ${res.correct ? 'ok' : 'bad'}" role="status"><span class="v-icon">${res.correct ? ICON_OK : ICON_BAD}</span><span>${res.correct ? (res.fuzzy ? 'Correct, counted as a close match' : 'Correct') : 'Incorrect'}</span></div>
        <p class="answers"><span class="muted">Accepted:</span> ${esc(accepted.join(', '))}</p>
        <div class="undo-row"><button type="button" class="btn ghost small" id="q-undo">Undo answer</button><span class="muted">or Ctrl/Cmd+Z</span></div>
        <details class="info"${res.correct ? '' : ' open'}><summary>Details</summary><div class="info-body">${renderInfo(item.subject, null)}</div></details>`;
      $('#q-undo').onclick = undo;
      // Touch screens: keep the cursor in the answer box so the keyboard stays open and Enter goes to the next card.
      // Keyboard users still land on the button, as before.
      if (coarsePointer()) { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } } else btn.focus();
    }

    // Keyboard undo, and make sure a finished card is saved when you leave the page.
    const onKey = (e) => {
      if (UI.anyDialogOpen() || st.phase !== 'feedback') return;
      // Holding Enter must not repeat through the feedback card.
      if (e.key === 'Enter' && e.repeat) { e.preventDefault(); return; }
      // Typing in a synonym or note box in the details must not trigger the answer undo.
      if (e.target && e.target.closest && e.target.closest('.mat-box')) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    };
    const onHide = () => { if (document.visibilityState === 'hidden') commit(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', commit);
    document.body.classList.add('in-quiz');
    cleanup = () => {
      document.body.classList.remove('in-quiz');
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', commit);
      hideSrsToast();
      commit();
    };

    next();
  }

  // ---------- reviews ----------
  async function reviewsView(my) {
    const stale = () => my !== routeSeq;
    loading('Loading reviews…');
    flushBg(); // sent in the background, paced to the rate limit
    await ensureLocal();
    if (stale()) return;
    // Worked out locally. Items you already answered that are still waiting to be sent are left out.
    const all = Local.reviewsDue();
    if (!all.length) { Session.clear(); return empty('No reviews right now', 'Come back when your next reviews are due.'); }

    // Pick up an unfinished session if there is one.
    let chosen, progress;
    const saved = new Map();
    const snap = Session.load();
    if (snap) {
      const byId = new Map(all.map((a) => [a.id, a]));
      const keep = snap.items.filter((x) => byId.has(x.a));
      if (keep.length) {
        chosen = keep.map((x) => byId.get(x.a));
        keep.forEach((x) => saved.set(x.a, x));
        const done = snap.done || 0;
        progress = { done, total: done + keep.length, answered: snap.answered || 0, correct: snap.correct || 0 };
      } else {
        Session.clear();
      }
    }
    if (!chosen) {
      all.sort((a, b) => new Date(a.data.available_at) - new Date(b.data.available_at));
      const cap = settings.sessionSize;
      chosen = cap ? all.slice(0, cap) : all;
    }

    const ids = chosen.map((a) => a.data.subject_id);
    const subs = await api.getSubjects(ids); // saved copy; only anything missing is fetched
    const synonyms = Local.synonyms(ids);
    if (stale()) return;

    const items = chosen.filter((a) => subs.has(a.data.subject_id)).map((a) => {
      const item = makeItem(a, subs.get(a.data.subject_id), synonyms.get(a.data.subject_id));
      const x = saved.get(a.id);
      if (x) {
        const p = (x.p || []).filter((k) => item.pending.includes(k));
        if (p.length) item.pending = p;
        item.incorrect = { meaning: (x.i || [])[0] || 0, reading: (x.i || [])[1] || 0 };
      }
      return item;
    });
    if (!progress) shuffle(items);
    else toast('Picked up your unfinished session.');

    runQuiz({
      items,
      persist: true,
      progress,
      quitMessage: 'Quit for now? Your progress is saved and you can pick up right where you left off.',
      onFinish: (st) => reviewSummary(st, all.length - chosen.length),
    });
  }

  function reviewSummary(st, leftOver) {
    const total = st.doneBase + st.done.length;
    const accuracy = st.answered ? Math.round(st.correct / st.answered * 100) : 100;
    const missed = st.done.filter((i) => i.incorrect.meaning + i.incorrect.reading > 0);
    app.innerHTML = `<div class="wrap">
      <div class="center"><h1>Session complete</h1>
      <p>${total} item${total === 1 ? '' : 's'} reviewed, ${accuracy}% of answers correct.</p>
      <p class="muted" id="sync">Sending results to WaniKani…</p></div>
      ${missed.length ? `<div class="panel"><h2>Items you missed</h2><div class="tiles">${missed.map((i) => tile(i.subject)).join('')}</div></div>` : ''}
      <div class="row" style="justify-content:center">
        ${leftOver > 0 ? '<a class="btn" href="#/reviews" id="more">Keep going</a>' : ''}
        <a class="btn ghost" href="#/">Back home</a>
      </div></div>`;
    const more = $('#more');
    if (more) more.addEventListener('click', (e) => { e.preventDefault(); route(); });
    api.flushPending().then((n) => {
      const el = $('#sync');
      if (!el) return;
      const lost = api.refused - (st.refused0 || 0);
      const saved = n ? `${n} result${n > 1 ? 's are' : ' is'} still waiting to send. They will retry automatically.` : 'Results saved to WaniKani.';
      el.textContent = lost > 0 ? `WaniKani did not accept ${lost} result${lost > 1 ? 's' : ''} (already reviewed elsewhere, or no longer due). ${n ? saved : 'The rest were saved.'}` : saved;
      if (lost > 0) el.classList.add('error');
    }).catch((e) => { const el = $('#sync'); if (el) el.textContent = e.message + ' Your results are kept and will retry.'; });
  }

  // ---------- lessons ----------
  async function lessonsView(my) {
    const stale = () => my !== routeSeq;
    loading('Loading lessons…');
    await ensureLocal();
    if (stale()) return;
    const all = Local.lessonsAvailable();
    if (!all.length) return empty('No lessons right now', 'New lessons unlock as you pass items in your reviews.');

    const subs = await api.getSubjects(all.slice(0, LESSON_CAP).map((a) => a.data.subject_id));
    if (stale()) return;
    const items = all.filter((a) => subs.has(a.data.subject_id)).map((a) => makeItem(a, subs.get(a.data.subject_id)));
    items.sort((a, b) => a.subject.data.level - b.subject.data.level
      || TYPE_ORDER[a.subject.object] - TYPE_ORDER[b.subject.object]
      || (a.subject.data.lesson_position || 0) - (b.subject.data.lesson_position || 0));
    lessonBatch(items, my);
  }

  async function lessonBatch(remaining, my) {
    const stale = () => my !== routeSeq;
    const size = settings.lessonBatch;
    const batch = remaining.slice(0, size);
    const rest = remaining.slice(size);

    loading();
    const relIds = batch.flatMap((i) => i.subject.data.component_subject_ids || []);
    const related = await api.getSubjects(relIds).catch(() => new Map());
    if (stale()) return;

    let idx = 0;
    const seen = new Set([0]);
    const onKey = (e) => {
      if (dlg.open || /input|select|textarea/i.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    if (cleanup) cleanup();
    document.addEventListener('keydown', onKey);
    cleanup = () => document.removeEventListener('keydown', onKey);

    function step(d) {
      const n = idx + d;
      if (n < 0 || n >= batch.length) return;
      idx = n; seen.add(n); draw();
    }

    function draw() {
      const cur = batch[idx].subject;
      const last = idx === batch.length - 1;
      const allSeen = seen.size === batch.length;
      app.innerHTML = `<div class="wrap">
        <div class="row between" style="margin-bottom:10px"><span class="muted">Lesson ${idx + 1} of ${batch.length}${rest.length ? `, ${rest.length} more after this batch` : ''}</span><a class="link" href="#/">Leave</a></div>
        <div class="ltabs">${batch.map((b, i) => `<button type="button" class="ltab t-${typeClass(b.subject.object)}${i === idx ? ' on' : seen.has(i) ? ' seen' : ''}" data-tab="${i}" aria-label="Item ${i + 1}">${glyph(b.subject)}</button>`).join('')}</div>
        ${hero(cur)}
        <div class="info-body">${renderInfo(cur, related, { usedIn: false })}</div>
        <div class="lnav">
          <button class="btn ghost" id="l-prev" type="button"${idx === 0 ? ' disabled' : ''}>Back</button>
          ${last ? `<button class="btn" id="l-quiz" type="button"${allSeen ? '' : ' disabled'}>${allSeen ? 'Start quiz' : 'View every item first'}</button>`
            : '<button class="btn" id="l-next" type="button">Next</button>'}
        </div></div>`;
      window.scrollTo(0, 0);
      document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { idx = Number(b.dataset.tab); seen.add(idx); draw(); }; });
      $('#l-prev').onclick = () => step(-1);
      const nx = $('#l-next'); if (nx) nx.onclick = () => step(1);
      const q = $('#l-quiz'); if (q) q.onclick = startQuiz;
    }

    function startQuiz() {
      cleanup(); cleanup = null;
      const quizItems = shuffle(batch.map((i) => makeItem(i.assignment, i.subject)));
      runQuiz({
        items: quizItems,
        practice: true,
        quitMessage: 'Quit the quiz? These lessons will not be started.',
        onFinish: () => {
          // The items show as started straight away; telling WaniKani happens in the background.
          batch.forEach((i) => Local.markStarted(i.assignment.id, api.queueStart(i.assignment.id).started_at));
          if (stale()) { flushBg(); return; }
          app.innerHTML = `<div class="wrap center"><h1>Batch complete</h1>
            <p>${batch.length} item${batch.length === 1 ? '' : 's'} started. The first review comes in about four hours.</p>
            <p class="muted" id="sync">Saving to WaniKani…</p>
            <div class="row" style="justify-content:center">
              ${rest.length ? `<button class="btn" id="nb" type="button">Next batch (${rest.length} left)</button>` : ''}
              <a class="btn ghost" href="#/">Back home</a></div></div>`;
          const nb = $('#nb'); if (nb) nb.onclick = () => lessonBatch(rest, my);
          api.flushPending().then((n) => {
            const el = $('#sync');
            if (el) el.textContent = n ? 'Still waiting to send. It will retry automatically.' : 'Saved to WaniKani.';
          }).catch((e) => { const el = $('#sync'); if (el) { el.textContent = e.message + ' Your lessons are kept and will retry.'; el.classList.add('error'); } });
        },
      });
    }

    draw();
  }

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
})();
