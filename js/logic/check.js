/* Answer checking for meaning and reading questions. */
(function (root) {
  'use strict';

  const JAPANESE = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/;
  const TYPE_LABEL = { onyomi: 'on’yomi', kunyomi: 'kun’yomi', nanori: 'nanori' };

  function norm(s) {
    return String(s)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[-–—_/]+/g, ' ')
      .replace(/[^a-z0-9 ]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  /** Returns {invalid:msg} (no penalty), or {correct:bool, fuzzy?:bool}. */
  function meaning(subject, synonyms, raw) {
    const text = String(raw || '');
    if (JAPANESE.test(text)) return { invalid: 'Type the meaning in English.' };
    const ans = norm(text);
    if (!ans) return { invalid: 'Type an answer first.' };

    const d = subject.data;
    const aux = d.auxiliary_meanings || [];
    const blacklist = aux.filter((m) => m.type === 'blacklist').map((m) => norm(m.meaning));
    if (blacklist.includes(ans)) return { correct: false };

    const accepted = []
      .concat(d.meanings.filter((m) => m.accepted_answer).map((m) => norm(m.meaning)))
      .concat(aux.filter((m) => m.type === 'whitelist').map((m) => norm(m.meaning)))
      .concat((synonyms || []).map(norm))
      .filter(Boolean);

    if (accepted.includes(ans)) return { correct: true };

    const tolerance = ans.length <= 4 ? 0 : ans.length <= 7 ? 1 : 2;
    if (tolerance && accepted.some((a) => levenshtein(a, ans) <= tolerance)) {
      return { correct: true, fuzzy: true };
    }
    return { correct: false };
  }

  // Only kana (and the long-vowel mark) can be part of a reading. Latin letters survive this step so that
  // romaji which could not be converted is reported instead of being silently dropped.
  const NOT_KANA = /[^\u3041-\u3096\u309d\u309e\u30a1-\u30fa\u30fc\u30fd\u30fea-z]/g;

  /**
   * What the person meant by a reading answer: romaji becomes kana (a trailing "n" becomes ん), katakana becomes
   * hiragana, and everything that is not kana (symbols, digits, spaces, kanji, stray punctuation) is trimmed away.
   */
  function cleanReading(raw) {
    const K = root.Kana;
    const text = String(raw || '').normalize('NFKC').toLowerCase()
      .replace(/[^a-z'\-\u3041-\u3096\u309d\u309e\u30a1-\u30fa\u30fc\u30fd\u30fe]/g, ''); // drop symbols before converting, so they cannot split romaji
    return K.kataToHira(K.toKana(text, true)).replace(NOT_KANA, '');
  }

  /** Returns {invalid:msg, kana?} (no penalty), or {correct:bool, kana}. `kana` is the cleaned-up answer. */
  function reading(subject, raw) {
    const kana = cleanReading(raw);
    if (!String(raw || '').trim()) return { invalid: 'Type an answer first.' };
    if (!kana) return { invalid: 'No kana found in that answer. Type the reading in kana (romaji converts as you type).' };
    if (/[a-z]/.test(kana)) return { invalid: 'Type the reading in kana. Romaji converts as you type.', kana };

    const readings = subject.data.readings || [];
    const hit = readings.find((r) => r.reading === kana);
    if (hit && hit.accepted_answer) return { correct: true, kana };
    if (hit && subject.object === 'kanji') {
      const wanted = readings.find((r) => r.accepted_answer && r.primary) || readings.find((r) => r.accepted_answer);
      if (wanted && wanted.type && hit.type) {
        return { invalid: 'This kanji wants its ' + TYPE_LABEL[wanted.type] + ' reading, not ' + TYPE_LABEL[hit.type] + '.', kana };
      }
    }
    return { correct: false, kana };
  }

  root.Check = { norm, levenshtein, meaning, reading, cleanReading };
})(typeof window !== 'undefined' ? window : globalThis);
