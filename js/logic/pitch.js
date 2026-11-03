/* Pitch accent: turn a reading and an accent number into a diagram, and look accent numbers up.

   Pitch.moras('きょう')            -> ['きょ', 'う']
   Pitch.pattern(3, 2)              -> { heights: [0, 1, 0], particle: 0 }  (1 = high, 0 = low)
   Pitch.kind(moraCount, accent)    -> 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka'
   Pitch.svg(reading, accent)       -> an <svg> string (uses currentColor, so it follows the theme)
   Pitch.load()                     -> Promise: makes sure the dictionary is ready (downloaded once, then kept in the browser)
   Pitch.find(word, reading)        -> [accent numbers] (empty if unknown)

   The accent number is the mora after which the pitch falls: 0 never falls (heiban), 1 falls after the first mora,
   and a number equal to the mora count falls on the particle that follows (odaka).

   WaniKani's API carries no pitch information, so the numbers come from the Kanjium project's accent list,
   downloaded the first time a diagram is needed and then stored in IndexedDB so it works offline afterwards.
   Needs Kana (logic/kana.js); api.js is used for storage when present. */
(function (root) {
  'use strict';

  const SOURCE = 'https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt';
  const META_KEY = 'pitch_accents_v1';
  const SMALL = 'ゃゅょぁぃぅぇぉゎ';

  const hira = (s) => (root.Kana && root.Kana.kataToHira ? root.Kana.kataToHira(String(s || '')) : String(s || ''));
  const clean = (s) => hira(s).replace(/[.\-\s・]/g, '');

  /** Split kana into moras: small ゃゅょ and vowels join the kana before them; っ, ん and ー count on their own. */
  function moras(kana) {
    const out = [];
    for (const ch of clean(kana)) {
      if (SMALL.includes(ch) && out.length) out[out.length - 1] += ch;
      else out.push(ch);
    }
    return out;
  }

  /** Height of every mora (1 high, 0 low) and of the particle that follows. */
  function pattern(n, accent) {
    const heights = [];
    for (let i = 1; i <= n; i++) {
      let h;
      if (accent === 0) h = i === 1 ? 0 : 1;
      else if (accent === 1) h = i === 1 ? 1 : 0;
      else h = i === 1 ? 0 : i <= accent ? 1 : 0;
      heights.push(h);
    }
    if (n === 1 && accent === 0) heights[0] = 0;
    return { heights, particle: accent === 0 ? 1 : 0 };
  }

  function kind(n, accent) {
    if (accent === 0) return 'heiban';
    if (accent === 1) return 'atamadaka';
    return accent >= n ? 'odaka' : 'nakadaka';
  }

  const LABEL = { heiban: 'heiban (flat)', atamadaka: 'atamadaka (head-high)', nakadaka: 'nakadaka (drops in the middle)', odaka: 'odaka (drops after the word)' };

  function svg(reading, accent) {
    const ms = moras(reading);
    const n = ms.length;
    if (!n || !Number.isFinite(accent) || accent < 0 || accent > n) return '';
    const { heights, particle } = pattern(n, accent);
    const all = heights.concat([particle]);
    const step = 30, padX = 16, hiY = 10, loY = 30, w = padX * 2 + step * n, h = 58;
    const x = (i) => padX + i * step;
    const y = (v) => (v ? hiY : loY);
    let lines = '';
    for (let i = 0; i < n; i++) lines += `<line x1="${x(i)}" y1="${y(all[i])}" x2="${x(i + 1)}" y2="${y(all[i + 1])}"/>`;
    let dots = '';
    for (let i = 0; i < n; i++) dots += `<circle cx="${x(i)}" cy="${y(all[i])}" r="4"/>`;
    dots += `<circle class="particle" cx="${x(n)}" cy="${y(all[n])}" r="4"/>`;
    const text = ms.map((m, i) => `<text x="${x(i)}" y="52" text-anchor="middle">${m}</text>`).join('');
    const k = kind(n, accent);
    return `<svg class="pitch-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${ms.join(' ')}: ${LABEL[k]}, accent ${accent}"><g class="pl">${lines}</g><g class="pd">${dots}</g><g class="pt">${text}</g></svg>`;
  }

  // ---- dictionary ----
  let index = null;      // Map: "word\treading" -> [accents], "word" -> [accents]
  let loading = null;
  let failedAt = 0;

  function parse(text) {
    const map = new Map();
    const add = (k, list) => {
      const cur = map.get(k);
      if (!cur) map.set(k, list.slice());
      else list.forEach((a) => { if (!cur.includes(a)) cur.push(a); });
    };
    text.split('\n').forEach((line) => {
      const c = line.replace(/\r$/, '').split('\t');
      if (c.length < 2) return;
      const word = c[0].trim();
      const kana = c.length >= 3 ? clean(c[1]) : clean(word);
      const accents = (c.length >= 3 ? c[2] : c[1]).split(',').map((x) => parseInt(x.replace(/[^\d]/g, ''), 10)).filter((x) => Number.isFinite(x));
      if (!word || !accents.length) return;
      add(word + '\t' + kana, accents);
      add(word, accents);
    });
    return map;
  }

  async function load() {
    if (index) return index;
    if (loading) return loading;
    if (Date.now() - failedAt < 60000) throw new Error('Pitch accent data is not available right now.');
    loading = (async () => {
      let text = '';
      try {
        const rows = root.api && api.db ? await api.db.getMany('meta', [META_KEY]) : [];
        if (rows.length && rows[0].value) text = rows[0].value;
      } catch (e) { /* no cache */ }
      if (!text) {
        const res = await fetch(SOURCE);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        text = await res.text();
        try { if (root.api && api.db) await api.db.put('meta', [{ key: META_KEY, value: text }]); } catch (e) { /* too big or blocked: fine */ }
      }
      index = parse(text);
      return index;
    })();
    try { return await loading; } catch (e) { failedAt = Date.now(); throw e; } finally { loading = null; }
  }

  function find(word, reading) {
    if (!index) return [];
    const r = clean(reading);
    return index.get(word + '\t' + r) || (word === r ? index.get(word) : null) || [];
  }

  root.Pitch = { moras, pattern, kind, svg, load, find, label: (n, a) => LABEL[kind(n, a)] };
})(window);
