/* KanjiLite – Subject helpers: tiles, the detail view body, your own synonyms and notes.
   Part of the app: see js/app.js for the entry point. Shares what other files need through window.KL. */
(function (KL) {
  'use strict';
  const { $, esc } = KL;

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

  /** "Next review in 3 days", from an assignment's data. Empty when it has no review coming (not started, locked). */
  function nextReviewText(d) {
    if (d.srs_stage >= 9 || d.burned_at) return 'Burned: no more reviews';
    if (!(d.srs_stage >= 1) || !d.available_at) return '';
    const ms = Date.parse(d.available_at) - Date.now();
    if (!(ms > 60000)) return 'Review available now';
    const mins = Math.round(ms / 60000), hrs = Math.round(ms / 3600000), days = Math.round(ms / 86400000);
    if (mins < 60) return `Next review in ${mins} minute${mins === 1 ? '' : 's'}`;
    if (hrs < 24) return `Next review in ${hrs} hour${hrs === 1 ? '' : 's'}`;
    return `Next review in ${days} day${days === 1 ? '' : 's'}`;
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

    // When this item is next up for review (the WaniKani link lives in the buttons at the top of the details).
    if (!opts || opts.nextReview !== false) {
      const a = Local.assignmentFor(s.id);
      const txt = a && !a.data.hidden ? nextReviewText(a.data) : '';
      if (txt) h += `<p class="muted next-review">${esc(txt)}</p>`;
    }
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

  Object.assign(KL, { STAGES, TYPE_LABEL, TYPE_ORDER, externalLinks, glyph, glyphClass, hero, nextStage, renderInfo, tile, typeClass });
})(window.KL);
