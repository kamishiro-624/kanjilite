/* Audio. WaniKani publishes recordings by human voice actors (one woman, one man) for every vocabulary item,
   inside the subject's `pronunciation_audios`. It has no recordings of kanji on their own, so a kanji plays the
   recording of a word that uses it, preferring the one-kanji word (水 for 水) and words that use the reading
   you are learning. Nothing here is computer generated.

   renderInfo() calls Sound.sectionHTML(subject) while building the detail view, which is used by the Search
   dialog, the lessons and the review feedback card. Clicks on [data-play] buttons are handled here.
   Sound.autoplay() is called by the review screen when "play audio after a correct answer" is on (vocabulary only). */
(function (root) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
  const MAX_WORDS = 4;

  // ---- what this browser can play ----
  const probe = document.createElement('audio');
  const canPlay = (type) => !!type && !!probe.canPlayType && probe.canPlayType(type) !== '';

  // ---- readings: katakana to hiragana, without the dots and dashes some readings use ----
  const norm = (r) => String(r || '').replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[.\-]/g, '');
  const readingsOf = (s) => (s.data.readings || []).map((r) => r.reading);
  const primaryOf = (s) => {
    const rs = s.data.readings || [];
    return (rs.find((r) => r.primary) || rs[0] || {}).reading || (s.object === 'kana_vocabulary' ? s.data.characters : '') || '';
  };

  /** Recordings this browser can play, for one reading of a word (all readings when none is given). */
  function clips(s, reading) {
    const all = (s.data.pronunciation_audios || []).filter((a) => a && a.url && canPlay(a.content_type));
    const want = reading || primaryOf(s);
    const same = want ? all.filter((a) => a.metadata && norm(a.metadata.pronunciation) === norm(want)) : [];
    return same.length ? same : (reading ? [] : all);
  }
  const hasAudio = (s) => s && (s.object === 'vocabulary' || s.object === 'kana_vocabulary') && clips(s).length > 0;

  /** Readings of a word that have a playable recording, in WaniKani's order. */
  function playableReadings(s) {
    const seen = [];
    const list = s.object === 'kana_vocabulary' ? [primaryOf(s)] : readingsOf(s);
    list.forEach((r) => { if (r && !seen.includes(r) && clips(s, r).length) seen.push(r); });
    return seen;
  }

  // ---- the one audio element ----
  const el = new Audio();
  el.preload = 'auto';
  let current = null; // the button showing playback state
  function mark(btn, state) {
    if (current && current !== btn) current.classList.remove('playing', 'loading', 'failed');
    current = btn || null;
    if (!btn) return;
    btn.classList.remove('playing', 'loading', 'failed');
    if (state) btn.classList.add(state);
  }
  el.addEventListener('playing', () => mark(current, 'playing'));
  el.addEventListener('ended', () => mark(current, ''));
  el.addEventListener('pause', () => { if (current && current.classList.contains('playing')) mark(current, ''); });
  el.addEventListener('error', () => mark(current, 'failed'));

  const pickRandom = (a) => a[Math.floor(Math.random() * a.length)];

  /** Plays one recording of the word (a random voice each time, as the WaniKani site does). Resolves true if it started. */
  async function playWord(s, reading, btn) {
    const list = clips(s, reading);
    if (!list.length) { mark(btn, 'failed'); return false; }
    const c = pickRandom(list);
    mark(btn, 'loading');
    if (btn && c.metadata && c.metadata.voice_actor_name) btn.title = 'Voice: ' + c.metadata.voice_actor_name;
    el.pause();
    el.src = c.url;
    try {
      await el.play();
      return true;
    } catch (e) {
      // A newer play() interrupting this one is not a failure.
      if (e && e.name === 'AbortError') return false;
      mark(btn, 'failed');
      return false;
    }
  }

  function stop() { try { el.pause(); } catch (e) { /* ignore */ } mark(null); }

  // ---- kanji: find the words to play ----
  const wordJobs = new Map(); // kanji id -> promise of [{ v, reading }]

  function rank(kanji, words) {
    const ch = kanji.data.characters;
    const accepted = (kanji.data.readings || []).filter((r) => r.accepted_answer).map((r) => norm(r.reading)).filter(Boolean);
    return words.map((v) => {
      const reading = playableReadings(v)[0];
      const n = norm(reading);
      const score = v.data.characters === ch ? 0 : accepted.some((r) => n.includes(r)) ? 1 : 2;
      return { v, reading, score };
    }).sort((a, b) => a.score - b.score || a.v.data.level - b.v.data.level || a.v.id - b.v.id);
  }

  async function wordsFor(kanji) {
    if (wordJobs.has(kanji.id)) return wordJobs.get(kanji.id);
    const job = (async () => {
      const ids = (kanji.data.amalgamation_subject_ids || []).slice(0, 30);
      const usable = (map) => rank(kanji, ids.map((id) => map.get(id)).filter(hasAudio));
      // First from what is already saved on this device (no request), and only if that has nothing
      // good, from WaniKani.
      const local = new Map();
      const missing = [];
      ids.forEach((id) => { if (api.subjectCache.has(id)) local.set(id, api.subjectCache.get(id)); else missing.push(id); });
      if (missing.length && api.db) {
        (await api.db.getMany('subjects', missing)).forEach((r) => { api.subjectCache.set(r.s.id, r.s); local.set(r.s.id, r.s); });
      }
      let rows = usable(local);
      if ((!rows.length || rows[0].score > 1) && ids.some((id) => !local.has(id))) {
        try { rows = usable(await api.getSubjects(ids)); } catch (e) { if (!rows.length) throw e; }
      }
      return rows.slice(0, MAX_WORDS);
    })();
    wordJobs.set(kanji.id, job);
    job.catch(() => wordJobs.delete(kanji.id)); // try again next time
    return job;
  }

  // ---- markup ----
  const btnHTML = (v, reading, label, big) => `<button type="button" class="aplay${big ? ' aplay-big' : ''}" data-play="${v.id}" data-r="${esc(reading)}" aria-label="Play ${esc(v.data.characters)}, ${esc(reading)}">${PLAY}${label}</button>`;

  /** The "Audio" section for the detail view, or '' when the item has none. */
  function sectionHTML(s) {
    if (s.object === 'vocabulary' || s.object === 'kana_vocabulary') {
      const rs = playableReadings(s);
      if (!rs.length) return '';
      return `<section class="audio"><h3>Audio</h3><div class="audio-row">${rs.map((r) => btnHTML(s, r, `<span class="ar">${esc(r)}</span>`, true)).join('')}</div>
        <p class="muted audio-note">Recorded by native speakers, sourced from WaniKani.</p></section>`;
    }
    if (s.object === 'kanji' && (s.data.amalgamation_subject_ids || []).length) {
      return `<section class="audio"><h3>Audio</h3><div class="audio-row" data-kanji-audio="${s.id}"><span class="muted">Finding recordings…</span></div>
        <p class="muted audio-note">WaniKani has no recordings of kanji on their own. These are native-speaker recordings of words that use it.</p></section>`;
    }
    return '';
  }

  async function fillKanji(box) {
    const id = Number(box.dataset.kanjiAudio);
    delete box.dataset.kanjiAudio;
    const k = api.subjectCache.get(id);
    const drop = () => { const sec = box.closest('section'); if (sec) sec.remove(); };
    if (!k) return drop();
    try {
      const rows = await wordsFor(k);
      if (!box.isConnected) return;
      if (!rows.length) return drop();
      box.innerHTML = rows.map((x) => btnHTML(x.v, x.reading, `<span class="aw">${esc(x.v.data.characters)}</span><span class="ar">${esc(x.reading)}</span>`)).join('');
    } catch (e) {
      if (box.isConnected) box.innerHTML = '<span class="muted">Audio needs a connection the first time.</span>';
    }
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches && node.matches('[data-kanji-audio]')) fillKanji(node);
    node.querySelectorAll && node.querySelectorAll('[data-kanji-audio]').forEach(fillKanji);
  }
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-play]');
    if (!b) return;
    const s = api.subjectCache.get(Number(b.dataset.play));
    if (s) playWord(s, b.dataset.r, b);
  });

  /**
   * Play the audio for a vocabulary item you just answered correctly. Kanji and radicals stay silent here
   * (a kanji's audio is only played from its detail view). `stillWanted()` is checked before starting.
   */
  async function autoplay(s, stillWanted) {
    try {
      if ((s.object === 'vocabulary' || s.object === 'kana_vocabulary') && hasAudio(s) && (!stillWanted || stillWanted())) {
        await playWord(s, playableReadings(s)[0], null);
      }
    } catch (e) { /* no audio or blocked by the browser: stay quiet */ }
  }

  root.Sound = { sectionHTML, autoplay, stop, hasAudio };
})(window);
