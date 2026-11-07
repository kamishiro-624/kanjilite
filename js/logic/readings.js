/* Which vocabulary words are read differently from their kanji. Plain functions, no DOM and no network.

   A word's reading is compared with the readings of the kanji it is written with. The ones WaniKani teaches in the kanji
   lessons are the "taught" readings (the ones its kanji quiz accepts); the kanji's other on'yomi and kun'yomi are only
   met in vocabulary. Names (nanori) are ignored.
     regular    built only from taught readings (a trailing つ/く/ち/き/ふ may become っ, as in 学校 がっこう)
     new        built from the kanji's readings, but at least one is not taught in its lessons: 選ぶ (えら), 食べる (た),
                人 (ひと), 三人 (さんにん, にん)
     dakuten    built from them, but a kanji's first sound is voiced or half-voiced (手紙 てがみ, from かみ; 一本 いっぽん,
                from ほん; 大丈夫 だいじょうぶ, from ふ)
     different  can't be built from the kanji's readings at all (大人 おとな, 今日 きょう, 明日 あした, 一人 ひとり)
   Words with no kanji, or with a kanji that isn't known here, have no class. */
(function (root) {
  'use strict';

  const VERSION = 4; // bump when the rules change, so saved results are worked out again

  const hira = (s) => String(s || '').replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  // Marks that are part of how WaniKani writes a word but are never read aloud: the ～ of a prefix or suffix (～放題), ・, spaces.
  const isMark = (c) => /[\p{P}\p{S}\p{Z}]/u.test(c) && c !== '\u30fc'; // ー is a sound, not a mark
  // Only these can be part of a word's reading: kana (and ー), kanji, 々, and Latin letters or digits. Anything else
  // (marks, invisible characters, variation selectors) is not read aloud, so it is left out of the comparison.
  const isReadable = (c) => !isMark(c) && /[\u3041-\u3096\u309d\u309e\u30a1-\u30fa\u30fc-\u30ff\u3005\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffA-Za-z0-9\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/.test(c);
  const isKanji = (c) => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(c);

  // First sound of a reading after a voicing change: か->が, は->ば or ぱ. ち and つ also show up as じ and ず.
  const VOICED = {
    か: ['が'], き: ['ぎ'], く: ['ぐ'], け: ['げ'], こ: ['ご'],
    さ: ['ざ'], し: ['じ'], す: ['ず'], せ: ['ぜ'], そ: ['ぞ'],
    た: ['だ'], ち: ['ぢ', 'じ'], つ: ['づ', 'ず'], て: ['で'], と: ['ど'],
    は: ['ば', 'ぱ'], ひ: ['び', 'ぴ'], ふ: ['ぶ', 'ぷ'], へ: ['べ', 'ぺ'], ほ: ['ぼ', 'ぽ'],
  };
  const voiced = (r) => (VOICED[r[0]] || []).map((v) => v + r.slice(1));
  const geminated = (r) => (r.length >= 2 && 'つくちきふ'.includes(r[r.length - 1]) ? [r.slice(0, -1) + 'っ'] : []);

  /** The readings a kanji subject offers inside words: on'yomi and kun'yomi, with and without the okurigana part.
      taughtOnly: just the readings its lessons teach (the ones its quiz accepts; the primary one if none is marked). */
  function kanjiReadings(kanji, taughtOnly) {
    const list = ((kanji && kanji.data && kanji.data.readings) || []).filter((r) => r.type !== 'nanori');
    const taught = list.some((r) => r.accepted_answer) ? list.filter((r) => r.accepted_answer) : list.filter((r) => r.primary);
    const out = new Set();
    (taughtOnly ? taught : list).forEach((r) => {
      const full = hira(r.reading).replace(/-/g, '');
      const stem = full.split('.')[0];
      if (stem) out.add(stem);
      const joined = full.replace(/\./g, '');
      if (joined) out.add(joined);
    });
    return [...out];
  }

  /** Can `reading` be built from the tokens? tokens: [{ kana } | { opts, taught }]. `voice` allows voicing changes; `taughtOnly` limits kanji to their taught readings. */
  function builds(tokens, reading, voice, taughtOnly) {
    const go = (ti, pos) => {
      if (ti === tokens.length) return pos === reading.length;
      const t = tokens[ti];
      if (t.kana != null) return reading.startsWith(t.kana, pos) && go(ti + 1, pos + t.kana.length);
      const last = ti === tokens.length - 1;
      for (const base of (taughtOnly ? t.taught : t.opts)) {
        const forms = [base];
        if (!last) geminated(base).forEach((g) => forms.push(g));
        if (voice && pos > 0) forms.slice().forEach((f) => voiced(f).forEach((v) => forms.push(v)));
        for (const f of forms) if (reading.startsWith(f, pos) && go(ti + 1, pos + f.length)) return true;
      }
      return false;
    };
    return go(0, 0);
  }

  /**
   * vocab: a vocabulary subject; kanjiByChar: { '人': kanji subject, ... } for the kanji it uses.
   * Returns 'regular', 'new', 'dakuten', 'different', 'none' (no kanji in the word) or 'unknown' (a kanji is missing from
   * kanjiByChar, or the word has no readings). When a word has several readings the most irregular one decides.
   */
  function classify(vocab, kanjiByChar) {
    const d = vocab && vocab.data;
    if (!d || !d.characters) return 'unknown';
    const chars = Array.from(d.characters).filter(isReadable);
    if (!chars.some(isKanji) && !chars.includes('々')) return 'none';
    const readings = (d.readings || []).map((r) => hira(r.reading)).filter(Boolean);
    if (!readings.length) return 'unknown';
    const tokens = [];
    let prev = null;
    for (const c of chars) {
      if (isKanji(c)) {
        const k = kanjiByChar[c];
        if (!k) return 'unknown';
        prev = { opts: kanjiReadings(k), taught: kanjiReadings(k, true) };
        tokens.push(prev);
      } else if (c === '々') {
        if (!prev) return 'unknown';
        tokens.push({ opts: prev.opts, taught: prev.taught });
      } else {
        const last = tokens[tokens.length - 1];
        const h = hira(c);
        if (last && last.kana != null) last.kana += h; else tokens.push({ kana: h });
        prev = null;
      }
    }
    const rank = { regular: 0, new: 1, dakuten: 2, different: 3 };
    let worst = 'regular';
    readings.forEach((r) => {
      const c = builds(tokens, r, false, true) ? 'regular' : builds(tokens, r, false, false) ? 'new'
        : builds(tokens, r, true, false) ? 'dakuten' : 'different';
      if (rank[c] > rank[worst]) worst = c;
    });
    return worst;
  }

  root.Readings = { VERSION, classify, kanjiReadings };
})(window);
