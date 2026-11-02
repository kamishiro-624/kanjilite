/* A calendar heatmap (one square per day, weeks as columns), drawn as SVG.

   Heatmap.create(host, spec) -> { update(), destroy() }
   spec = { id, title, note,
            counts() -> { 'YYYY-MM-DD': n } | null   (null: nothing to show yet)
            empty: { text, action: { label, name } } or a function returning one, onAction(name),
            unit: 'review' }
   The picker offers the last 12 months and every calendar year that has data. */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const longDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

  /** 0 for no activity, then 1 to 4 by quartile of the days that had some. */
  function levelFn(counts) {
    const vals = Object.keys(counts).map((k) => counts[k]).filter((n) => n > 0).sort((a, b) => a - b);
    if (!vals.length) return () => 0;
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75);
    return (n) => (n <= 0 ? 0 : n <= t1 ? 1 : n <= t2 ? 2 : n <= t3 ? 3 : 4);
  }

  function create(host, spec) {
    const id = spec.id || 'heat';
    const unit = spec.unit || 'review';
    let range = 'last';
    let destroyed = false;
    let counts = null;
    let width = 0;
    let raf = 0;
    let scrolledToEnd = false;

    host.innerHTML = `<section class="panel heat" aria-label="${esc(spec.title)}">
      <div class="chart-head"><h2>${esc(spec.title)}</h2><div class="chart-ctl"><label class="ctl"><span>Period</span><div id="${id}-slot"></div></label></div></div>
      ${spec.note ? `<p class="muted chart-note">${spec.note}</p>` : ''}
      <p class="heat-sum muted" aria-live="polite"></p>
      <div class="chart-body heat-body"><div class="heat-scroll"><svg role="img" aria-label="${esc(spec.title)}"></svg></div><div class="chart-tip" hidden></div><div class="chart-empty" hidden></div></div>
      <div class="heat-legend" aria-hidden="true"><span>Less</span><i class="hm hm0"></i><i class="hm hm1"></i><i class="hm hm2"></i><i class="hm hm3"></i><i class="hm hm4"></i><span>More</span></div>
    </section>`;
    const body = host.querySelector('.heat-body');
    const scroller = host.querySelector('.heat-scroll');
    const svg = host.querySelector('svg');
    const tip = host.querySelector('.chart-tip');
    const emptyEl = host.querySelector('.chart-empty');
    const sum = host.querySelector('.heat-sum');
    const slot = host.querySelector('#' + id + '-slot');

    function periods() {
      const years = new Set();
      Object.keys(counts || {}).forEach((k) => { if (counts[k] > 0) years.add(Number(k.slice(0, 4))); });
      const opts = [{ value: 'last', label: 'Last 12 months' }];
      [...years].sort((a, b) => b - a).forEach((y) => opts.push({ value: String(y), label: String(y) }));
      return opts;
    }
    let pickerSig = '';
    function drawPicker() {
      const opts = periods();
      const sig = JSON.stringify(opts) + range;
      if (sig === pickerSig) return;
      pickerSig = sig;
      if (!opts.some((o) => o.value === range)) range = 'last';
      slot.innerHTML = UI.selectHTML(id + '-range', opts, range, 'Period');
      UI.bindSelect(slot.querySelector('[data-select]'), (v) => { range = v; scrolledToEnd = false; draw(); });
    }

    function draw() {
      if (destroyed) return;
      counts = spec.counts();
      if (!counts || !Object.keys(counts).some((k) => counts[k] > 0)) {
        scroller.hidden = true; host.querySelector('.heat-legend').hidden = true; sum.textContent = '';
        emptyEl.hidden = false;
        const e = (typeof spec.empty === 'function' ? spec.empty() : spec.empty) || { text: 'Nothing to show yet.' };
        emptyEl.innerHTML = `<p class="muted">${esc(e.text)}</p>${e.action ? `<button type="button" class="btn small" data-action="${esc(e.action.name)}">${esc(e.action.label)}</button>` : ''}`;
        slot.innerHTML = ''; pickerSig = '';
        return;
      }
      emptyEl.hidden = true; scroller.hidden = false; host.querySelector('.heat-legend').hidden = false;
      drawPicker();

      const today = new Date(); today.setHours(0, 0, 0, 0);
      let start, end;
      if (range === 'last') { end = today; start = mondayOf(addDays(today, -364)); }
      else { const y = Number(range); start = mondayOf(new Date(y, 0, 1)); end = new Date(y, 11, 31); if (end > today) end = today; }
      const weeks = Math.round((mondayOf(end).getTime() - start.getTime()) / (7 * DAY)) + 1;
      const level = levelFn(counts);

      width = Math.max(260, Math.floor(body.clientWidth || 640));
      const left = 30, top = 18, gap = 3;
      const cell = Math.max(11, Math.min(18, Math.floor((width - left) / weeks) - gap));
      const w = left + weeks * (cell + gap), h = top + 7 * (cell + gap);
      let g = '';
      WEEKDAYS.forEach((l, r) => { if (l) g += `<text class="tick" x="${left - 6}" y="${top + r * (cell + gap) + cell - 2}" text-anchor="end">${l}</text>`; });
      let total = 0, active = 0, best = null;
      const labels = []; // month names go above the first column that contains the 1st of a month
      for (let wk = 0; wk < weeks; wk++) {
        const monday = addDays(start, wk * 7);
        let starts = null;
        for (let r = 0; r < 7; r++) {
          const d = addDays(monday, r);
          if (d < start || d > end) continue;
          if (range !== 'last' && d.getFullYear() !== Number(range)) continue;
          if (d.getDate() === 1) starts = d.getMonth();
          const n = counts[key(d)] || 0;
          total += n; if (n) active++;
          if (n && (!best || n > best.n)) best = { n, d };
          g += `<rect class="hm hm${level(n)}" x="${left + wk * (cell + gap)}" y="${top + r * (cell + gap)}" width="${cell}" height="${cell}" rx="2.5" data-d="${key(d)}" data-n="${n}"/>`;
        }
        if (starts !== null) labels.push({ wk, mo: starts });
        else if (wk === 0) labels.push({ wk, mo: monday.getMonth() });
      }
      if (labels.length > 1 && labels[1].wk - labels[0].wk < 3) labels.shift(); // would overlap the next name
      labels.forEach((l) => { g += `<text class="tick" x="${left + l.wk * (cell + gap)}" y="${top - 6}">${MONTHS[l.mo]}</text>`; });
      svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.innerHTML = g;
      sum.textContent = `${plural(total, unit)} on ${plural(active, 'day')}${best ? `. Busiest day: ${plural(best.n, unit)} on ${longDate(best.d)}.` : '.'}`;
      if (!scrolledToEnd) { scroller.scrollLeft = scroller.scrollWidth; scrolledToEnd = true; }
    }

    function showTip(e) {
      const r = e.target.closest && e.target.closest('rect.hm');
      if (!r) { tip.hidden = true; return; }
      const n = Number(r.dataset.n);
      const p = r.dataset.d.split('-');
      tip.innerHTML = esc(`${longDate(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])))}: ${n ? plural(n, unit) : 'no ' + unit + 's'}`);
      tip.hidden = false;
      const b = body.getBoundingClientRect(), c = r.getBoundingClientRect();
      let x = c.left - b.left + c.width / 2 - tip.offsetWidth / 2;
      x = Math.max(0, Math.min(b.width - tip.offsetWidth, x));
      tip.style.left = x + 'px';
      tip.style.top = Math.max(0, c.top - b.top - tip.offsetHeight - 6) + 'px';
    }
    svg.addEventListener('pointermove', showTip);
    svg.addEventListener('pointerdown', showTip);
    svg.addEventListener('pointerleave', () => { tip.hidden = true; });
    emptyEl.addEventListener('click', (e) => { const b = e.target.closest('[data-action]'); if (b && spec.onAction) spec.onAction(b.dataset.action); });

    let ro = null;
    if (root.ResizeObserver) {
      ro = new ResizeObserver(() => {
        if (destroyed) return;
        const w = Math.floor(body.clientWidth || 0);
        if (w && Math.abs(w - width) > 2) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
      });
      ro.observe(body);
    }
    draw();
    return { update: draw, destroy() { destroyed = true; cancelAnimationFrame(raf); if (ro) ro.disconnect(); } };
  }

  root.Heatmap = { create };
})(window);
