/* Tiny romaji -> hiragana converter (IME-style) and helpers. */
(function (root) {
  'use strict';

  const RAW = `
a あ i い u う e え o お
ka か ki き ku く ke け ko こ
sa さ shi し si し su す se せ so そ
ta た chi ち ti ち tsu つ tu つ te て to と
na な ni に nu ぬ ne ね no の
ha は hi ひ fu ふ hu ふ he へ ho ほ
ma ま mi み mu む me め mo も
ya や yu ゆ yo よ
ra ら ri り ru る re れ ro ろ
wa わ wo を wi うぃ we うぇ
ga が gi ぎ gu ぐ ge げ go ご
za ざ zi じ ji じ zu ず ze ぜ zo ぞ
da だ di ぢ du づ de で do ど
ba ば bi び bu ぶ be べ bo ぼ
pa ぱ pi ぴ pu ぷ pe ぺ po ぽ
kya きゃ kyu きゅ kyo きょ
sha しゃ shu しゅ sho しょ she しぇ sya しゃ syu しゅ syo しょ
cha ちゃ chu ちゅ cho ちょ che ちぇ tya ちゃ tyu ちゅ tyo ちょ cya ちゃ cyu ちゅ cyo ちょ
nya にゃ nyu にゅ nyo にょ
hya ひゃ hyu ひゅ hyo ひょ
mya みゃ myu みゅ myo みょ
rya りゃ ryu りゅ ryo りょ
gya ぎゃ gyu ぎゅ gyo ぎょ
ja じゃ ju じゅ jo じょ je じぇ jya じゃ jyu じゅ jyo じょ zya じゃ zyu じゅ zyo じょ
bya びゃ byu びゅ byo びょ
pya ぴゃ pyu ぴゅ pyo ぴょ
dya ぢゃ dyu ぢゅ dyo ぢょ
fa ふぁ fi ふぃ fe ふぇ fo ふぉ
xa ぁ xi ぃ xu ぅ xe ぇ xo ぉ la ぁ li ぃ lu ぅ le ぇ lo ぉ
xya ゃ xyu ゅ xyo ょ lya ゃ lyu ゅ lyo ょ
xtu っ ltu っ xtsu っ ltsu っ
`;

  const TABLE = {};
  const tokens = RAW.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 2) TABLE[tokens[i]] = tokens[i + 1];

  const VOWELS = 'aiueo';

  /**
   * Convert romaji to hiragana. Text that is already kana passes through untouched,
   * and an incomplete romaji tail (e.g. "k", "sh") is left as-is while typing.
   * With final=true a trailing "n" becomes ん.
   */
  function toKana(input, final) {
    const s = String(input).toLowerCase();
    let out = '';
    let i = 0;
    while (i < s.length) {
      let hit = false;
      for (let len = 4; len >= 1; len--) {
        const k = s.substr(i, len);
        if (k.length === len && TABLE[k]) {
          out += TABLE[k];
          i += len;
          hit = true;
          break;
        }
      }
      if (hit) continue;

      const c = s[i];
      const n = s[i + 1];

      if (c === 'n') {
        if (n === "'") { out += 'ん'; i += 2; continue; }
        if (n === 'n') {
          const after = s[i + 2];
          if (after === undefined || (!VOWELS.includes(after) && after !== 'y')) {
            out += 'ん'; i += 2; continue;
          }
        }
        if (n !== undefined && /[a-z]/.test(n) && !VOWELS.includes(n) && n !== 'y') {
          out += 'ん'; i += 1; continue;
        }
        if (n === undefined && final) { out += 'ん'; i += 1; continue; }
      }

      // small tsu for doubled consonants: "kk" -> っk
      if (n !== undefined && c === n && /[bcdfghjklmpqrstvwxyz]/.test(c)) {
        out += 'っ'; i += 1; continue;
      }

      if (c === '-') { out += 'ー'; i += 1; continue; }

      out += c;
      i += 1;
    }
    return out;
  }

  /** Katakana -> hiragana (leaves ー and everything else alone). */
  function kataToHira(str) {
    return String(str).replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }

  root.Kana = { toKana, kataToHira };
})(typeof window !== 'undefined' ? window : globalThis);
