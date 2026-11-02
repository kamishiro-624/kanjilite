/* Dashboard widgets. Each function turns data into HTML; app.js decides when to draw them and supplies the data. */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const round1 = (n) => Math.round(n * 10) / 10;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDate = (t) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

  function span(days) {
    if (days < 1) return 'under a day';
    if (days < 45) return plural(Math.round(days), 'day');
    const months = Math.floor(days / 30.44);
    if (months < 12) return plural(months, 'month');
    return plural(Math.floor(months / 12), 'year') + (months % 12 ? ' ' + plural(months % 12, 'month') : '');
  }

  // ---------------------------------------------------------------- level progress, split by kind of item

  // Most advanced first, so each bar fills from the left as items move up.
  const STAGES = [
    { key: 'burned', label: 'Burned', color: '#6b7280' },
    { key: 'enlightened', label: 'Enlightened', color: '#a78bfa' },
    { key: 'master', label: 'Master', color: '#3dc5ff' },
    { key: 'guru', label: 'Guru', color: '#5ce08f' },
    { key: 'apprentice', label: 'Apprentice', color: '#ffd23f' },
    { key: 'new', label: 'Not started', color: 'var(--line)' },
  ];
  const KINDS = [
    { key: 'radical', label: 'Radicals', cls: 'rad' },
    { key: 'kanji', label: 'Kanji', cls: 'kan' },
    { key: 'vocabulary', label: 'Vocabulary', cls: 'voc' },
  ];

  function stageKey(a) {
    if (!a || !a.data.unlocked_at || !(a.data.srs_stage >= 1)) return 'new';
    const s = a.data.srs_stage;
    return s <= 4 ? 'apprentice' : s <= 6 ? 'guru' : s === 7 ? 'master' : s === 8 ? 'enlightened' : 'burned';
  }

  /** subs: every subject of the level; assignmentFor(subjectId) gives its assignment or null. */
  function levelProgress(level, subs, assignmentFor) {
    const rows = KINDS.map((k) => {
      const list = subs.filter((s) => !s.data.hidden_at && (k.key === 'vocabulary' ? (s.object === 'vocabulary' || s.object === 'kana_vocabulary') : s.object === k.key));
      const counts = { burned: 0, enlightened: 0, master: 0, guru: 0, apprentice: 0, new: 0 };
      list.forEach((s) => { counts[stageKey(assignmentFor(s.id))]++; });
      return { kind: k, total: list.length, counts, atGuru: counts.guru + counts.master + counts.enlightened + counts.burned };
    }).filter((r) => r.total);
    if (!rows.length) return '';

    const bar = (r) => {
      const segs = STAGES.filter((s) => r.counts[s.key]).map((s) => `<i style="width:${r.counts[s.key] / r.total * 100}%;background:${s.color}" title="${esc(s.label)}: ${r.counts[s.key]}"></i>`).join('');
      const label = STAGES.filter((s) => r.counts[s.key]).map((s) => `${s.label} ${r.counts[s.key]}`).join(', ');
      return `<div class="lp-bar" role="img" aria-label="${esc(r.kind.label)}: ${esc(label)}">${segs}${r.kind.key === 'kanji' ? '<b class="lp-mark" style="left:90%" title="90% of kanji at Guru levels up"></b>' : ''}</div>`;
    };
    const kanji = rows.find((r) => r.kind.key === 'kanji');
    const need = kanji ? Math.ceil(kanji.total * 0.9) : 0;
    return `<div class="panel lp"><h2>Level ${level} progress</h2>
      ${rows.map((r) => `<div class="lp-row">
        <div class="lp-head"><span class="lp-type ${r.kind.cls}"><i></i>${esc(r.kind.label)}</span><span class="lp-count">${r.atGuru} of ${r.total} at Guru or above</span></div>
        ${bar(r)}</div>`).join('')}
      <div class="lp-legend">${STAGES.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>
      ${kanji ? `<p class="muted lp-note">You need ${need} kanji at Guru or above to level up (the dark mark). Radicals and vocabulary do not count toward it.</p>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- critical condition

  /** items: [{ subject, pct, wrong }] already sorted worst first; total is how many items are under the line. */
  function critical(items, total, below, tile) {
    const head = `<h2>Critical condition</h2>`;
    if (items === null) return `<div class="panel crit">${head}<p class="muted">Loading your review statistics…</p></div>`;
    if (!total) return `<div class="panel crit">${head}<p class="muted">No items are under ${below}% right now. Items show up here once you have answered them a few times.</p></div>`;
    return `<div class="panel crit">${head}
      <p class="muted crit-sub"><b>${total}</b> ${total === 1 ? 'item is' : 'items are'} under ${below}% correct. Tap one to see it, then give it extra attention in your reviews.</p>
      <div class="tiles crit-tiles">${items.map((x) => `<div class="hard-item">${tile(x.subject)}<small class="crit-pct${x.pct < 50 ? ' bad' : ''}">${Math.round(x.pct)}% right</small></div>`).join('')}</div>
      ${total > items.length ? `<p class="fine">Showing the ${items.length} lowest.</p>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- your numbers

  /**
   * d: { user, level, streak, haveHistory, ls (level stats), pace, est (to the next level), reviewsToday,
   *      bestDay, burned, started, accuracy }
   */
  function numbers(d) {
    const cards = [];
    const card = (value, label, sub, extra) => cards.push(`<div class="card${extra ? ' ' + extra : ''}"><b>${esc(value)}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`);

    const st = d.streak;
    if (st && (st.current || st.best)) {
      card(plural(st.current, 'day'), 'review streak', st.doneToday ? `Longest: ${st.best}` : (st.current ? `Review today to keep it. Longest: ${st.best}` : `Longest: ${st.best}`), st.current >= 3 ? 'hot' : '');
    } else card('0 days', 'review streak', 'Do a review to start one');

    if (d.ls && d.ls.since) {
      card(span(d.ls.elapsedDays), `on level ${d.level}`, d.pace && d.pace.n ? `Your average is ${round1(d.pace.mean)} days per level` : 'Time since you unlocked it');
    }
    if (d.est && !d.est.already) card('~' + shortDate(d.est.date), `level ${d.level + 1} around`, `In about ${span(d.est.days)}${d.pace && d.pace.n ? ', at your recent pace' : ''}`);

    card(String(d.reviewsToday || 0), 'reviews today', d.bestDay ? `Best day: ${d.bestDay}` : '');
    card(String(d.burned || 0), 'items burned', d.started ? `Of ${d.started} started` : '');
    if (d.accuracy != null) card(d.accuracy + '%', 'answers correct', d.answers ? `${d.answers.toLocaleString()} answers` : '');
    if (d.user && d.user.started_at) card(span((Date.now() - Date.parse(d.user.started_at)) / DAY), 'on WaniKani', `Since ${shortDate(Date.parse(d.user.started_at))} ${new Date(d.user.started_at).getFullYear()}`);

    const note = !d.haveHistory ? '<p class="fine">The streak counts reviews done in this app. <a href="#/stats">Download your review history</a> on the Stats page to include everything before.</p>' : '';
    return `<div class="panel nums"><h2>Your numbers</h2><div class="cards">${cards.join('')}</div>${note}</div>`;
  }

  root.Dash = { levelProgress, critical, numbers, STAGES };
})(window);
