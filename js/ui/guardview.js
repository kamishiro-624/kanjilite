/* The dashboard's "Workload check" panel. Turns what Guard worked out into HTML; app.js binds the buttons.
   Each warning can be dismissed for the day ("Not today"); one that gets worse comes back. */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const RECOVERY_FOR = ['backlog', 'skipped', 'load', 'ahead'];

  /** What to do about it, as a short list. Reviews can only be done once they are due, so no number of reviews is asked
      for: it says what is ready now, what is coming, and what to hold back. */
  function recovery(res, sessionSize) {
    const r = res.recovery;
    if (!r) return '';
    const steps = [];
    const num = (n) => Math.round(n).toLocaleString();
    if (r.due) {
      steps.push(`<b>${num(r.due)}</b> reviews are ready now${r.soon ? `, and about ${num(r.soon)} more come due over the next day` : ''}. Do as many as you manage in a few short sessions. The rest simply wait, and there is no number to hit.`);
      if (r.pile && r.days > 1) steps.push(`At your usual pace the pile is gone in about <b>${plural(r.days, 'day')}</b>, since new reviews keep coming due.`);
    } else if (r.peak && r.peak.n) {
      steps.push(`Nothing is due yet, and reviews can’t be done early, so there is nothing to do ahead of time. The busiest day is ${esc(r.peak.label)}, with about <b>${num(r.peak.n)}</b> reviews; the load eases in about <b>${plural(r.days, 'day')}</b>.`);
    }
    if (r.lessonsPaused) steps.push(`Pause new lessons until then. ${res.allowance.hasPlan ? 'Your plan’s lessons pick up again once the load is lighter.' : 'They will be waiting for you.'}`);
    else if (r.lessonsEased) steps.push(res.allowance.left
      ? `Keep lessons light: about ${res.allowance.left} more fit today (the plan asks for ${res.allowance.goal}).`
      : `That is enough lessons for today (the plan asks for ${res.allowance.goal}).`);
    if (r.planText) steps.push(esc(r.planText));
    const tip = r.sessionTip && sessionSize !== r.sessionTip
      ? `<button class="btn ghost small" type="button" data-guard-session="${r.sessionTip}">Use sessions of ${r.sessionTip}</button>` : '';
    return `<div class="guard-rec"><h3>What helps</h3><ul>${steps.map((s) => `<li>${s}</li>`).join('')}</ul>
      <div class="row" style="gap:8px;flex-wrap:wrap">${r.due ? '<a class="btn small" href="#/reviews">Start a session</a>' : ''}${tip}</div></div>`;
  }

  /** res: Guard.evaluate result. Returns '' when there is nothing (left) to show. */
  function panel(res, sessionSize) {
    const list = Guard.visible(res);
    if (!list.length) return '';
    const shown = list.slice(0, 3);
    const items = shown.map((w) => `<div class="guard-item ${w.sev === 2 ? 'high' : 'watch'}">
        <div class="guard-body"><b>${esc(w.title)}</b><p>${esc(w.text)}</p>
          ${w.action ? `<a class="btn ghost small" href="${esc(w.action.href)}">${esc(w.action.label)}</a>` : ''}</div>
        <button class="link guard-x" type="button" data-guard-snooze="${esc(w.id)}">Not today</button></div>`).join('');
    const more = list.length > shown.length ? `<p class="fine">${plural(list.length - shown.length, 'more warning')} hidden. Fix the ones above first.</p>` : '';
    const rec = shown.some((w) => RECOVERY_FOR.includes(w.id)) ? recovery(res, sessionSize) : '';
    return `<div class="panel guard ${res.level}"><div class="row between"><h2>Workload check</h2><span class="guard-tag ${res.level}">${res.level === 'high' ? 'Needs attention' : 'Heads up'}</span></div>
      ${items}${more}${rec}
      <p class="fine">This looks at every review already scheduled, not just Apprentice, and compares it with what you have actually been doing${res.cap.auto ? (res.cap.known ? ` (you usually manage about ${res.cap.value} reviews a day)` : '') : ` (you set ${res.cap.value} reviews a day as your limit)`}. Change it in Settings, Alerts.</p></div>`;
  }

  root.GuardView = { panel };
})(window);
