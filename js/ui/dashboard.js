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

  // One entry per SRS stage, each its own shade of the group colour (yellow, green, blue, violet, grey).
  // Bars run from the most advanced stage on the left to "not started" on the right.
  const SHADES = ['#ffe58a', '#ffd23f', '#ffb81f', '#f59e0b', '#5ce08f', '#22b45a', '#3dc5ff', '#a78bfa', '#6b7280']; // stages 1 to 9
  const STAGE_NAMES = ['Apprentice I', 'Apprentice II', 'Apprentice III', 'Apprentice IV', 'Guru I', 'Guru II', 'Master', 'Enlightened', 'Burned'];
  const STAGES = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => ({ stage: n, label: STAGE_NAMES[n - 1], color: SHADES[n - 1] }))
    .concat([{ stage: 0, label: 'Not started', color: 'var(--line)' }]);
  const KINDS = [
    { key: 'radical', label: 'Radicals', cls: 'rad', one: 'radical', many: 'radicals' },
    { key: 'kanji', label: 'Kanji', cls: 'kan', one: 'kanji', many: 'kanji' },
    { key: 'vocabulary', label: 'Vocabulary', cls: 'voc', one: 'word', many: 'words' },
  ];

  /** The SRS stage an item is at (0 when locked or waiting for its lesson). */
  function stageOf(a) {
    if (!a || !a.data.unlocked_at || !(a.data.srs_stage >= 1)) return 0;
    return Math.min(9, a.data.srs_stage);
  }

  /** subs: every subject of the level; assignmentFor(subjectId) gives its assignment or null. */
  function levelProgress(level, subs, assignmentFor) {
    const rows = KINDS.map((k) => {
      const list = subs.filter((s) => !s.data.hidden_at && (k.key === 'vocabulary' ? (s.object === 'vocabulary' || s.object === 'kana_vocabulary') : s.object === k.key));
      const counts = new Array(10).fill(0);
      list.forEach((s) => { counts[stageOf(assignmentFor(s.id))]++; });
      let atGuru = 0;
      for (let n = 5; n <= 9; n++) atGuru += counts[n];
      return { kind: k, total: list.length, counts, atGuru };
    }).filter((r) => r.total);
    if (!rows.length) return '';

    // Hovering (or focusing) a segment shows its stage in a small popup, drawn with CSS from data-tip.
    const bar = (r) => {
      const segs = STAGES.filter((st) => r.counts[st.stage]).map((st) => {
        const n = r.counts[st.stage];
        const tip = `${st.label} · ${n} ${n === 1 ? r.kind.one : r.kind.many}`;
        return `<i tabindex="0" role="img" aria-label="${esc(tip)}" data-tip="${esc(tip)}" style="width:${n / r.total * 100}%;background:${st.color}"></i>`;
      }).join('');
      return `<div class="lp-bar">${r.kind.key === 'kanji' ? '<b class="lp-mark" aria-hidden="true"></b>' : ''}${segs}</div>`;
    };
    const kanji = rows.find((r) => r.kind.key === 'kanji');
    const need = kanji ? Math.ceil(kanji.total * 0.9) : 0;
    return `<div class="panel lp"><h2>Level ${level} progress</h2>
      ${rows.map((r) => `<div class="lp-row">
        <div class="lp-head"><span class="lp-type ${r.kind.cls}"><i></i>${esc(r.kind.label)}</span><span class="lp-count">${r.atGuru} of ${r.total} at Guru or above</span></div>
        ${bar(r)}</div>`).join('')}
      ${kanji ? `<p class="muted lp-note">You need ${need} kanji at Guru or above to level up: that is everything left of the dark mark. Hover over a segment to see its stage.</p>` : '<p class="muted lp-note">Hover over a segment to see its stage.</p>'}</div>`;
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
      card(span(d.ls.elapsedDays), `on level ${d.level}`, d.pace && d.pace.n ? `Your typical pace is ${round1(d.pace.mean)} days per level` : 'Time since you unlocked it');
    }
    if (d.est && !d.est.already) card('~' + shortDate(d.est.date), `level ${d.level + 1} around`, `In about ${span(d.est.days)}${d.pace && d.pace.n ? ', at your recent pace' : ''}`);

    card(String(d.reviewsToday || 0), 'reviews today', d.bestDay ? `Best day: ${d.bestDay}` : '');
    card(String(d.burned || 0), 'items burned', d.started ? `Of ${d.started} started` : '');
    if (d.accuracy != null) card(d.accuracy + '%', 'answers correct', d.answers ? `${d.answers.toLocaleString()} answers` : '');
    if (d.user && d.user.started_at) card(span((Date.now() - Date.parse(d.user.started_at)) / DAY), 'on WaniKani', `Since ${shortDate(Date.parse(d.user.started_at))} ${new Date(d.user.started_at).getFullYear()}`);

    const note = !d.haveHistory ? '<p class="fine">The streak counts reviews done in this app (WaniKani no longer shares your earlier review history).</p>' : '';
    return `<div class="panel nums"><h2>Your numbers</h2><div class="cards">${cards.join('')}</div>${note}</div>`;
  }

  // ---------------------------------------------------------------- extra practice

  /** kinds: [{ key, title, desc, count }] (count null while loading); sizeHTML: the "items per practice" stepper. */
  function practice(kinds, sizeHTML) {
    const card = (k) => {
      const none = k.count === 0;
      const n = k.count == null ? '…' : plural(k.count, 'item');
      const inner = `<span class="pk-title">${esc(k.title)}</span><span class="pk-desc">${esc(k.desc)}</span><span class="pk-n">${n}</span>`;
      return none
        ? `<span class="pk off" aria-disabled="true">${inner}</span>`
        : `<a class="pk" href="#/practice/${esc(k.key)}">${inner}</a>`;
    };
    return `<div class="panel practice"><div class="row between"><h2>Extra practice</h2>
      <label class="pk-size muted">Items per practice ${sizeHTML}</label></div>
      <p class="muted pk-note">Nothing here changes your WaniKani progress. Practise as much as you like.</p>
      <div class="pk-grid">${kinds.map(card).join('')}</div></div>`;
  }

  // ---------------------------------------------------------------- item spread

  const SPREAD_ROWS = [
    { key: 'apprentice', label: 'Apprentice', color: '#ffb81f' },
    { key: 'guru', label: 'Guru', color: '#22b45a' },
    { key: 'master', label: 'Master', color: '#3dc5ff' },
    { key: 'enlightened', label: 'Enlightened', color: '#a78bfa' },
    { key: 'burned', label: 'Burned', color: '#6b7280' },
  ];

  /** Which row of the table an SRS stage (1 to 9) belongs to. */
  function spreadGroup(stage) {
    return stage <= 4 ? 'apprentice' : stage <= 6 ? 'guru' : stage === 7 ? 'master' : stage === 8 ? 'enlightened' : 'burned';
  }

  /** counts: { apprentice: [radicals, kanji, vocabulary], guru: [...], ... }. A total row closes the table. */
  function spread(counts) {
    const cell = (cls, n) => `<td><span class="sp-pill ${cls}${n ? '' : ' zero'}">${n.toLocaleString()}</span></td>`;
    const sum = [0, 0, 0];
    const rows = SPREAD_ROWS.map((r) => {
      const c = counts[r.key] || [0, 0, 0];
      c.forEach((n, i) => { sum[i] += n; });
      return `<tr><th scope="row"><span class="sp-dot" style="background:${r.color}" aria-hidden="true"></span>${r.label}</th>
        ${cell('rad', c[0])}${cell('kan', c[1])}${cell('voc', c[2])}${cell('tot', c[0] + c[1] + c[2])}</tr>`;
    }).join('');
    const grand = sum[0] + sum[1] + sum[2];
    return `<div class="panel spread"><h2>Item spread</h2>
      <div class="table-wrap"><table class="sp-table">
        <thead><tr><th scope="col"><span class="sr-only">Stage</span></th>
          <th scope="col"><span class="sp-pill rad">Radicals</span></th>
          <th scope="col"><span class="sp-pill kan">Kanji</span></th>
          <th scope="col"><span class="sp-pill voc">Vocabulary</span></th>
          <th scope="col"><span class="sp-pill tot">Total</span></th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th scope="row">Total</th>${cell('rad', sum[0])}${cell('kan', sum[1])}${cell('voc', sum[2])}${cell('tot grand', grand)}</tr></tfoot>
      </table></div>
      <p class="fine muted">Items you have started, by SRS stage. Lessons you have not done yet are not counted.</p></div>`;
  }

  root.Dash = { levelProgress, critical, numbers, practice, spread, spreadGroup, STAGES, SHADES, STAGE_NAMES };
})(window);
