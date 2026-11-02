/* Finding subjects (radicals, kanji, vocabulary) by meaning, reading or the characters themselves.

   Search.build(subjects, synonymsOf?)  -> an index (do this once per set of subjects)
   Search.run(index, query, { field, type }) -> [{ s, score, how, hit }] best match first

   What a query means:
     - Japanese text (水, みず, ミズ, 日本語)  matches the characters, and the readings when it is all kana.
     - Latin letters (water, mizu)           match meanings, and are also read as romaji for the readings.
   field:  'all' (default) | 'meaning' | 'reading' | 'character'
   type:   'all' (default) | 'radical' | 'kanji' | 'vocabulary'
   Needs Kana (logic/kana.js) for romaji. */
(function (root) {
  'use strict';

  const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const hira = (s) => root.Kana.kataToHira(s);
  const JAPANESE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\u3005\u30fc]/;
  const ALL_KANA = /^[\u3040-\u30ff\u30fc\s]+$/;
  const kindOf = (object) => (object === 'kana_vocabulary' ? 'vocabulary' : object);

  function build(subjects, synonymsOf) {
    return subjects.filter((s) => s.data && !s.data.hidden_at).map((s) => {
      const d = s.data;
      const meanings = [];
      (d.meanings || []).forEach((m) => meanings.push({ t: norm(m.meaning), raw: m.meaning, primary: !!m.primary }));
      (d.auxiliary_meanings || []).forEach((m) => { if (m.type !== 'blacklist') meanings.push({ t: norm(m.meaning), raw: m.meaning, primary: false }); });
      (synonymsOf ? synonymsOf(s.id) || [] : []).forEach((x) => meanings.push({ t: norm(x), raw: x, primary: false }));
      const seen = new Set();
      const readings = [];
      (d.readings || []).forEach((r) => {
        const t = hira(r.reading).replace(/[.\-\s]/g, ''); // kun'yomi are written あ.げる: match without the dot
        if (!t || seen.has(t)) return;
        seen.add(t);
        readings.push({ t, raw: r.reading, primary: !!r.primary });
      });
      return { s, kind: kindOf(s.object), chars: d.characters || '', meanings, readings };
    });
  }

  /** Romaji to hiragana, or null if some of it is not romaji (so "water" is not read as kana). */
  function romajiToKana(q) {
    const k = root.Kana.toKana(q.replace(/[\s'’]/g, ''), true);
    return k && !/[a-z0-9]/i.test(k) ? k : null;
  }

  function run(index, query, options) {
    const o = Object.assign({ field: 'all', type: 'all' }, options || {});
    const raw = String(query == null ? '' : query).trim();
    if (!raw) return [];
    const q = norm(raw);
    const japanese = JAPANESE.test(raw);
    const latin = /^[\x20-\x7e]+$/.test(raw);
    const compact = raw.replace(/\s+/g, '');
    const readQuery = japanese ? (ALL_KANA.test(raw) ? hira(compact) : null) : (latin ? romajiToKana(q) : null);
    const charQuery = japanese ? compact : null;
    const useChars = (o.field === 'all' || o.field === 'character') && charQuery;
    const useReading = (o.field === 'all' || o.field === 'reading') && readQuery;
    const useMeaning = (o.field === 'all' || o.field === 'meaning') && latin;

    const out = [];
    index.forEach((e) => {
      if (o.type !== 'all' && e.kind !== o.type) return;
      let best = 0, how = '', hit = '';
      const take = (score, h, text) => { if (score > best) { best = score; how = h; hit = text; } };

      if (useChars && e.chars) {
        if (e.chars === charQuery) take(100, 'character', e.chars);
        else if (e.chars.startsWith(charQuery)) take(72, 'character', e.chars);
        else if (e.chars.includes(charQuery)) take(58, 'character', e.chars);
        else if (charQuery.length > 1 && e.chars.length === 1 && charQuery.includes(e.chars)) take(30, 'character', e.chars); // a kanji inside the word you typed
      }
      if (useReading) {
        e.readings.forEach((r) => {
          const bonus = r.primary ? 3 : 0;
          if (r.t === readQuery) take(90 + bonus, 'reading', r.raw);
          else if (r.t.startsWith(readQuery)) take(66 + bonus, 'reading', r.raw);
          else if (readQuery.length > 1 && r.t.includes(readQuery)) take(40 + bonus, 'reading', r.raw);
        });
      }
      if (useMeaning) {
        e.meanings.forEach((m) => {
          const bonus = m.primary ? 5 : 0;
          if (m.t === q) take(100 + bonus, 'meaning', m.raw);
          else if (m.t.startsWith(q)) take(78 + bonus, 'meaning', m.raw);
          else if ((' ' + m.t).includes(' ' + q)) take(66 + bonus, 'meaning', m.raw);
          else if (q.length > 1 && m.t.includes(q)) take(45 + bonus, 'meaning', m.raw);
        });
      }
      if (best) out.push({ s: e.s, score: best, how, hit });
    });
    out.sort((a, b) => b.score - a.score || a.s.data.level - b.s.data.level || a.s.id - b.s.id);
    return out;
  }

  /** Group results by kind, in the order radicals, kanji, vocabulary. */
  function group(results) {
    const groups = [{ key: 'radical', label: 'Radicals', items: [] }, { key: 'kanji', label: 'Kanji', items: [] }, { key: 'vocabulary', label: 'Vocabulary', items: [] }];
    results.forEach((r) => { const g = groups.find((x) => x.key === kindOf(r.s.object)); if (g) g.items.push(r); });
    return groups.filter((g) => g.items.length);
  }

  /** Links to the same item on WaniKani and on Jisho (null where there is nothing sensible to link to). */
  function links(s) {
    const d = s.data;
    const wkType = { radical: 'radicals', kanji: 'kanji', vocabulary: 'vocabulary', kana_vocabulary: 'vocabulary' }[s.object];
    const slug = d.slug || d.characters;
    const wanikani = d.document_url || (wkType && slug ? `https://www.wanikani.com/${wkType}/${encodeURIComponent(slug)}` : null);
    let jisho = null;
    if (d.characters) jisho = 'https://jisho.org/search/' + encodeURIComponent(d.characters) + (s.object === 'kanji' ? '%20%23kanji' : '');
    return { wanikani, jisho };
  }

  root.Search = { build, run, group, links, norm };
})(typeof window !== 'undefined' ? window : globalThis);
