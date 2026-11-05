/* The dashboard's "Workload check" panel. Turns what Guard worked out into HTML; app.js binds the buttons.
   Each warning can be dismissed for the day ("Not today"); one that gets worse comes back. */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const RECOVERY_FOR = ['backlog', 'skipped', 'apprentice'];

  /** The steps back to a manageable pile, as a short list. */
  function recovery(res, sessionSize) {
    const r = res.recovery;
    if (!r) return '';
    const steps = [];
    steps.push(`Aim for about <b>${r.daily.toLocaleString()}</b> reviews a day, split into a few sessions. That clears the pile in about <b>${plural(r.days, 'day')}</b>, even with new reviews arriving.`);
    if (r.lessonsPaused) steps.push(`Pause new lessons until then. ${res.allowance.hasPlan ? 'Your plan’s lessons pick up again once the pile is small.' : 'They will be waiting for you.'}`);
    else if (r.lessonsEased) steps.push(`Go easy on lessons: about ${res.allowance.allowed} today instead of ${res.allowance.goal}.`);
    if (r.planText) steps.push(esc(r.planText));
    const tip = r.sessionTip && sessionSize !== r.sessionTip
      ? `<button class="btn ghost small" type="button" data-guard-session="${r.sessionTip}">Use sessions of ${r.sessionTip}</button>` : '';
    return `<div class="guard-rec"><h3>A safe way back</h3><ul>${steps.map((s) => `<li>${s}</li>`).join('')}</ul>
      <div class="row" style="gap:8px;flex-wrap:wrap"><a class="btn small" href="#/reviews">Start a session</a>${tip}</div></div>`;
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
      <p class="fine">This compares your lessons and reviews with what you have actually been doing${res.cap.auto ? (res.cap.known ? ` (about ${res.cap.value} reviews a day is comfortable for you right now)` : '') : ` (you set ${res.cap.value} reviews a day as your limit)`}. Change it in Settings, Alerts.</p></div>`;
  }

  root.GuardView = { panel };
})(window);
