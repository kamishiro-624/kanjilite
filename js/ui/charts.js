/* Small interactive charts drawn as SVG, no libraries.

   Charts.create(host, spec) puts a titled chart card into `host` and returns { update(), destroy(), state }.

   spec = {
     id, title, note,                       // id must be unique on the page
     controls: [{ key, label, options: [{ value, label }], value }],   // drop-downs; the choice lands in state[key]
     data(state) -> {                       // called on every draw
       xType: 'number' | 'date',
       series: [{ name, kind: 'bar' | 'line' | 'step', color, dashed, barW, extend, points: [{ x, y, tip, dim, color }] }],
       markers: [{ x, label }],             // vertical guide lines (for example "today")
       xTicks: [{ x, label }],              // fixed tick labels (for categories); otherwise ticks are chosen for you
       xInteger, yZero (default true), xFmt, yFmt, xLabel, yLabel,
       empty: { text, action: { label, name } }   // shown instead of the chart when there is nothing to draw
     },
     onAction(name)                         // a button inside the empty message was pressed
   }

   Axes are editable: type a range into the boxes under the chart (blank or Reset goes back to automatic), or drag
   across the chart with a mouse to zoom in on that part; double-click resets. Hovering or touching shows the values. */
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const DAY = 24 * 3600 * 1000;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const isoDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDate = (t) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const longDate = (t) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

  function num(v) {
    if (!Number.isFinite(v)) return '';
    const a = Math.abs(v);
    if (a >= 10000) return (v / 1000).toFixed(a >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(Math.round(v * 100) / 100);
  }

  // ---------------------------------------------------------------- ticks

  function niceStep(span, target) {
    const raw = span / Math.max(1, target);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function numberTicks(min, max, target, integer) {
    let step = niceStep(max - min, target);
    if (integer) step = Math.max(1, Math.round(step));
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step * 1e6) / 1e6 * step);
    return { ticks: out, step };
  }

  const DATE_STEPS = [
    { unit: 'day', n: 1 }, { unit: 'day', n: 2 }, { unit: 'week', n: 1 }, { unit: 'week', n: 2 },
    { unit: 'month', n: 1 }, { unit: 'month', n: 2 }, { unit: 'month', n: 3 }, { unit: 'month', n: 6 },
    { unit: 'year', n: 1 }, { unit: 'year', n: 2 }, { unit: 'year', n: 5 },
  ];
  const stepDays = (s) => (s.unit === 'day' ? s.n : s.unit === 'week' ? 7 * s.n : s.unit === 'month' ? 30.44 * s.n : 365.25 * s.n);

  function dateTicks(min, max, target) {
    const span = (max - min) / DAY;
    const s = DATE_STEPS.find((x) => span / stepDays(x) <= target) || DATE_STEPS[DATE_STEPS.length - 1];
    const out = [];
    const start = new Date(min);
    let d;
    if (s.unit === 'day') d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    else if (s.unit === 'week') d = new Date(start.getFullYear(), start.getMonth(), start.getDate() - ((start.getDay() + 6) % 7));
    else if (s.unit === 'month') d = new Date(start.getFullYear(), start.getMonth() - (start.getMonth() % s.n), 1);
    else d = new Date(start.getFullYear() - (start.getFullYear() % s.n), 0, 1);
    const advance = (x) => (s.unit === 'day' ? new Date(x.getFullYear(), x.getMonth(), x.getDate() + s.n)
      : s.unit === 'week' ? new Date(x.getFullYear(), x.getMonth(), x.getDate() + 7 * s.n)
        : s.unit === 'month' ? new Date(x.getFullYear(), x.getMonth() + s.n, 1)
          : new Date(x.getFullYear() + s.n, 0, 1));
    for (let guard = 0; d.getTime() <= max && guard < 400; d = advance(d), guard++) {
      if (d.getTime() < min) continue;
      let label;
      if (s.unit === 'year') label = String(d.getFullYear());
      else if (s.unit === 'month') label = MONTHS[d.getMonth()] + (d.getMonth() === 0 || !out.length ? ' ' + d.getFullYear() : '');
      else label = shortDate(d.getTime());
      out.push({ x: d.getTime(), label });
    }
    return out;
  }

  // ---------------------------------------------------------------- the chart

  let counter = 0;

  function create(host, spec) {
    const id = spec.id || 'chart' + (++counter);
    const state = {};
    (spec.controls || []).forEach((c) => { state[c.key] = c.value; });
    let ov = { xmin: null, xmax: null, ymin: null, ymax: null }; // the person's own axis ranges
    let data = null;
    let view = null;       // axes as drawn: { xmin, xmax, ymin, ymax, ... }
    let drawn = [];        // hover targets
    let width = 0;
    let raf = 0;
    let destroyed = false;
    let drag = null;

    host.innerHTML = `<section class="panel chart" aria-label="${esc(spec.title)}">
      <div class="chart-head"><h2>${esc(spec.title)}</h2>
        <div class="chart-ctl">${(spec.controls || []).map((c) => `<label class="ctl"><span>${esc(c.label)}</span>${UI.selectHTML(id + '-' + c.key, c.options, c.value, c.label)}</label>`).join('')}</div>
      </div>
      ${spec.note ? `<p class="muted chart-note">${spec.note}</p>` : ''}
      <div class="chart-body"><svg role="img" aria-label="${esc(spec.title)}"></svg><div class="chart-tip" hidden></div><div class="chart-empty" hidden></div></div>
      <div class="axes">
        <div class="axis"><span class="axis-name">X axis</span><input data-ax="xmin" aria-label="X axis from" autocomplete="off" spellcheck="false"><span>to</span><input data-ax="xmax" aria-label="X axis to" autocomplete="off" spellcheck="false"></div>
        <div class="axis"><span class="axis-name">Y axis</span><input data-ax="ymin" aria-label="Y axis from" autocomplete="off" spellcheck="false"><span>to</span><input data-ax="ymax" aria-label="Y axis to" autocomplete="off" spellcheck="false"></div>
        <button type="button" class="link" data-reset>Reset axes</button>
      </div>
      <p class="fine chart-hint">Type your own range, or drag across the chart to zoom. Double-click to reset.</p>
    </section>`;

    const body = host.querySelector('.chart-body');
    const svg = host.querySelector('.chart-body svg');
    const tip = host.querySelector('.chart-tip');
    const emptyEl = host.querySelector('.chart-empty');
    const inputs = {};
    host.querySelectorAll('[data-ax]').forEach((i) => { inputs[i.dataset.ax] = i; });
    const resetBtn = host.querySelector('[data-reset]');

    (spec.controls || []).forEach((c) => {
      UI.bindSelect(host.querySelector('#' + id + '-' + c.key).closest('[data-select]'), (v) => {
        state[c.key] = v;
        ov.ymin = ov.ymax = null; // a different measure has a different scale
        draw();
      });
    });

    // ---- axes ----
    const isDate = () => data && data.xType === 'date';
    const show = (axis, v) => (axis[0] === 'x' && isDate() ? isoDay(v) : num(v));
    function parse(axis, text) {
      const t = text.trim();
      if (!t) return null;
      if (axis[0] === 'x' && isDate()) {
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
        if (!m) return undefined;
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return Number.isFinite(d.getTime()) ? d.getTime() : undefined;
      }
      const v = Number(t.replace(',', '.'));
      return Number.isFinite(v) ? v : undefined;
    }
    Object.keys(inputs).forEach((axis) => {
      const el = inputs[axis];
      el.addEventListener('change', () => {
        const v = parse(axis, el.value);
        if (v !== undefined) ov[axis] = v;
        draw();
      });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
      el.addEventListener('focus', () => el.select());
    });
    function syncInputs() {
      Object.keys(inputs).forEach((axis) => {
        const el = inputs[axis];
        el.classList.toggle('custom', ov[axis] !== null);
        el.placeholder = isDate() && axis[0] === 'x' ? 'YYYY-MM-DD' : '';
        if (document.activeElement !== el && view) el.value = show(axis, view[axis]);
      });
      resetBtn.disabled = !Object.keys(ov).some((k) => ov[k] !== null);
    }
    const resetAxes = () => { ov = { xmin: null, xmax: null, ymin: null, ymax: null }; draw(); };
    resetBtn.addEventListener('click', resetAxes);

    // ---- layout ----
    function layout() {
      const pts = [];
      data.series.forEach((s) => s.points.forEach((p) => { if (Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push({ p, s }); }));
      const bars = data.series.some((s) => s.kind === 'bar');
      const barW = Math.max.apply(null, [0].concat(data.series.filter((s) => s.kind === 'bar').map((s) => s.barW || 0)));
      let x0 = Infinity, x1 = -Infinity;
      pts.forEach(({ p }) => { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; });
      (data.markers || []).forEach((m) => { if (m.x < x0) x0 = m.x; if (m.x > x1) x1 = m.x; });
      const unit = isDate() ? DAY : 1;
      if (bars) { const half = (barW || unit) / 2; x0 -= half; x1 += half; }
      else { const padX = Math.max((x1 - x0) * 0.03, unit * 0.5); x0 -= padX; x1 += padX; }
      let xmin = ov.xmin !== null ? ov.xmin : x0;
      let xmax = ov.xmax !== null ? ov.xmax : x1;
      if (xmax <= xmin) xmax = xmin + unit;

      const seen = pts.filter(({ p }) => p.x >= xmin && p.x <= xmax);
      const ys = (seen.length ? seen : pts).map(({ p }) => p.y);
      let lo = ys.length ? Math.min.apply(null, ys) : 0;
      let hi = ys.length ? Math.max.apply(null, ys) : 1;
      const zero = data.yZero !== false;
      if (zero && lo > 0) lo = 0;
      if (hi <= lo) hi = lo + 1;
      const span = hi - lo;
      hi += span * 0.06;
      if (!zero) lo = Math.min(...ys.concat([lo])) >= 0 ? Math.max(0, lo - span * 0.06) : lo - span * 0.06; // never invent negative values
      const yT = numberTicks(lo, hi, 5, false);
      let ymin = ov.ymin !== null ? ov.ymin : (zero && lo === 0 ? 0 : Math.floor(lo / yT.step) * yT.step);
      let ymax = ov.ymax !== null ? ov.ymax : Math.ceil(hi / yT.step) * yT.step;
      if (ymax <= ymin) ymax = ymin + 1;

      const xTarget = Math.max(3, Math.floor(width / 85));
      let xTicks;
      if (data.xTicks) xTicks = data.xTicks.filter((t) => t.x >= xmin && t.x <= xmax);
      else if (isDate()) xTicks = dateTicks(xmin, xmax, xTarget);
      else xTicks = numberTicks(xmin, xmax, xTarget, data.xInteger).ticks.map((v) => ({ x: v, label: (data.xFmt || num)(v) }));
      const yTicks = numberTicks(ymin, ymax, 5, false).ticks;
      return { xmin, xmax, ymin, ymax, xTicks, yTicks };
    }

    // ---- drawing ----
    function draw() {
      if (destroyed) return;
      data = spec.data(state);
      const hasPoints = data.series.some((s) => s.points.some((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
      if (!hasPoints) {
        svg.setAttribute('hidden', '');
        tip.hidden = true;
        emptyEl.hidden = false;
        const e = data.empty || { text: 'Nothing to show yet.' };
        emptyEl.innerHTML = `<p class="muted">${esc(e.text)}</p>${e.action ? `<button type="button" class="btn small" data-action="${esc(e.action.name)}">${esc(e.action.label)}</button>` : ''}`;
        view = null; drawn = [];
        syncInputs();
        return;
      }
      emptyEl.hidden = true;
      svg.removeAttribute('hidden');
      width = Math.max(280, Math.floor(body.clientWidth || 640));
      const height = Math.round(Math.min(340, Math.max(230, width * 0.5)));
      view = layout();
      const yLabels = view.yTicks.map((v) => (data.yFmt || num)(v));
      const ml = Math.max(36, 14 + Math.max.apply(null, yLabels.map((l) => l.length)) * 6.6);
      const M = { l: ml, r: 14, t: data.yLabel ? 24 : 12, b: data.xLabel ? 42 : 28 };
      const pw = width - M.l - M.r, ph = height - M.t - M.b;
      const sx = (x) => M.l + (x - view.xmin) / (view.xmax - view.xmin) * pw;
      const sy = (y) => M.t + ph - (y - view.ymin) / (view.ymax - view.ymin) * ph;
      view.M = M; view.pw = pw; view.ph = ph; view.sx = sx; view.sy = sy; view.height = height;

      let g = '';
      // grid and ticks
      view.yTicks.forEach((v, i) => {
        const y = sy(v);
        g += `<line class="grid" x1="${M.l}" x2="${M.l + pw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="tick" x="${M.l - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(yLabels[i])}</text>`;
      });
      view.xTicks.forEach((t) => {
        const x = sx(t.x);
        g += `<line class="grid v" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${M.t}" y2="${M.t + ph}"/><text class="tick" x="${x.toFixed(1)}" y="${M.t + ph + 16}" text-anchor="middle">${esc(t.label)}</text>`;
      });
      g += `<line class="axis-line" x1="${M.l}" x2="${M.l + pw}" y1="${M.t + ph}" y2="${M.t + ph}"/><line class="axis-line" x1="${M.l}" x2="${M.l}" y1="${M.t}" y2="${M.t + ph}"/>`;
      if (data.yLabel) g += `<text class="axis-title" x="${M.l}" y="12">${esc(data.yLabel)}</text>`;
      if (data.xLabel) g += `<text class="axis-title" x="${M.l + pw / 2}" y="${height - 6}" text-anchor="middle">${esc(data.xLabel)}</text>`;

      const clipId = id + '-clip';
      g += `<defs><clipPath id="${clipId}"><rect x="${M.l}" y="${M.t - 2}" width="${pw}" height="${ph + 4}"/></clipPath></defs><g clip-path="url(#${clipId})">`;
      drawn = [];
      const base = Math.min(view.ymax, Math.max(view.ymin, 0));
      data.series.forEach((s, si) => {
        const color = s.color || 'var(--accent)';
        const pts = s.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (s.kind === 'bar') {
          const bw = s.barW || (isDate() ? DAY : 1);
          pts.forEach((p) => {
            const x0 = sx(p.x - bw / 2), x1 = sx(p.x + bw / 2);
            const w = Math.max(1, (x1 - x0) * 0.84);
            const top = sy(p.y), bot = sy(base);
            const y = Math.min(top, bot), h = Math.max(p.y === 0 ? 0 : 1, Math.abs(bot - top));
            g += `<rect class="bar${p.dim ? ' dim' : ''}" x="${(x0 + (x1 - x0 - w) / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, w / 3).toFixed(1)}" style="--c:${p.color || color}"/>`;
            drawn.push({ x: sx(p.x), y: top, p, s, bar: true });
          });
        } else {
          let d = '';
          let prev = null;
          pts.forEach((p) => {
            const x = sx(p.x), y = sy(p.y);
            if (!prev) d += `M${x.toFixed(1)} ${y.toFixed(1)}`;
            else if (s.kind === 'step') d += `H${x.toFixed(1)}V${y.toFixed(1)}`;
            else d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
            prev = p;
            drawn.push({ x, y, p, s });
          });
          if (s.kind === 'step' && s.extend && prev) d += `H${(M.l + pw).toFixed(1)}`;
          g += `<path class="line${s.dashed ? ' dashed' : ''}" d="${d}" style="--c:${color}"/>`;
          if (pts.length <= 80) pts.forEach((p) => { g += `<circle class="dot${p.dim ? ' dim' : ''}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3" style="--c:${color}"/>`; });
        }
        void si;
      });
      (data.markers || []).forEach((m) => {
        const x = sx(m.x);
        if (x < M.l || x > M.l + pw) return;
        g += `<line class="marker" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${M.t}" y2="${M.t + ph}"/><text class="marker-label" x="${(x + 4).toFixed(1)}" y="${M.t + 11}">${esc(m.label)}</text>`;
      });
      g += '</g><line class="cross" hidden/><rect class="zoom" hidden/><circle class="hot" r="5" hidden/>';
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('width', width);
      svg.setAttribute('height', height);
      svg.innerHTML = g;
      syncInputs();
    }

    // ---- pointer: hover values, drag to zoom ----
    const local = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) * (width / r.width), y: (e.clientY - r.top) * (view.height / r.height), r }; };
    const inPlot = (pt) => view && pt.x >= view.M.l && pt.x <= view.M.l + view.pw && pt.y >= view.M.t && pt.y <= view.M.t + view.ph;
    const xAt = (px) => view.xmin + (px - view.M.l) / view.pw * (view.xmax - view.xmin);

    function hover(pt) {
      let best = null, bd = Infinity;
      drawn.forEach((h) => { const d = Math.abs(h.x - pt.x) + Math.abs(h.y - pt.y) * 0.05; if (d < bd) { bd = d; best = h; } });
      const hot = svg.querySelector('.hot'), cross = svg.querySelector('.cross');
      if (!best || bd > 60) { tip.hidden = true; hot.setAttribute('hidden', ''); cross.setAttribute('hidden', ''); return; }
      const xf = data.xFmt || (isDate() ? longDate : num);
      const yf = data.yFmt || num;
      const text = best.p.tip || `${xf(best.p.x)}: ${yf(best.p.y)}`;
      const name = data.series.length > 1 && best.s.name ? `<b>${esc(best.s.name)}</b> ` : '';
      tip.innerHTML = name + esc(text);
      tip.hidden = false;
      const r = svg.getBoundingClientRect();
      const k = r.width / width;
      let left = best.x * k - tip.offsetWidth / 2;
      left = Math.max(0, Math.min(r.width - tip.offsetWidth, left));
      let top = best.y * k - tip.offsetHeight - 10;
      if (top < 0) top = best.y * k + 14;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      const hy = Math.max(view.M.t, Math.min(view.M.t + view.ph, best.y));
      hot.setAttribute('cx', best.x.toFixed(1)); hot.setAttribute('cy', hy.toFixed(1)); hot.removeAttribute('hidden');
      cross.setAttribute('x1', best.x.toFixed(1)); cross.setAttribute('x2', best.x.toFixed(1));
      cross.setAttribute('y1', view.M.t); cross.setAttribute('y2', view.M.t + view.ph); cross.removeAttribute('hidden');
    }
    const clearHover = () => {
      tip.hidden = true;
      ['.hot', '.cross'].forEach((q) => { const el = svg.querySelector(q); if (el) el.setAttribute('hidden', ''); });
    };

    svg.addEventListener('pointerdown', (e) => {
      if (!view) return;
      const pt = local(e);
      if (!inPlot(pt)) return;
      if (e.pointerType === 'touch') { hover(pt); return; }
      if (e.button !== 0) return;
      drag = { x0: pt.x, moved: false };
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!view) return;
      const pt = local(e);
      if (drag) {
        const a = Math.max(view.M.l, Math.min(view.M.l + view.pw, drag.x0));
        const b = Math.max(view.M.l, Math.min(view.M.l + view.pw, pt.x));
        if (Math.abs(b - a) > 6) drag.moved = true;
        const z = svg.querySelector('.zoom');
        if (drag.moved && z) {
          z.setAttribute('x', Math.min(a, b)); z.setAttribute('width', Math.abs(b - a));
          z.setAttribute('y', view.M.t); z.setAttribute('height', view.ph); z.removeAttribute('hidden');
          clearHover();
        }
        return;
      }
      if (inPlot(pt)) hover(pt); else clearHover();
    });
    const finish = (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      const z = svg.querySelector('.zoom'); if (z) z.setAttribute('hidden', '');
      if (!d.moved || !view) return;
      const pt = local(e);
      const a = xAt(Math.max(view.M.l, Math.min(view.M.l + view.pw, d.x0)));
      const b = xAt(Math.max(view.M.l, Math.min(view.M.l + view.pw, pt.x)));
      ov.xmin = Math.min(a, b); ov.xmax = Math.max(a, b);
      if (isDate()) { ov.xmin = Math.floor(ov.xmin / DAY) * DAY; ov.xmax = Math.max(ov.xmin + DAY, Math.ceil(ov.xmax / DAY) * DAY); }
      else if (data.xInteger) { ov.xmin = Math.round(ov.xmin * 2) / 2; ov.xmax = Math.max(ov.xmin + 1, Math.round(ov.xmax * 2) / 2); }
      ov.ymin = ov.ymax = null; // let the height fit what is now visible
      draw();
    };
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', () => { drag = null; const z = svg.querySelector('.zoom'); if (z) z.setAttribute('hidden', ''); });
    svg.addEventListener('pointerleave', (e) => { if (!drag && e.pointerType !== 'touch') clearHover(); });
    svg.addEventListener('dblclick', resetAxes);

    emptyEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (b && spec.onAction) spec.onAction(b.dataset.action, b);
    });

    // Redraw when the card changes width (rotating a phone, resizing the window).
    let ro = null;
    if (root.ResizeObserver) {
      ro = new ResizeObserver(() => {
        if (destroyed || !data) return;
        const w = Math.floor(body.clientWidth || 0);
        if (w && Math.abs(w - width) > 2) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
      });
      ro.observe(body);
    }

    draw();
    return {
      state,
      update: draw,
      resetAxes,
      destroy() { destroyed = true; cancelAnimationFrame(raf); if (ro) ro.disconnect(); },
    };
  }

  root.Charts = { create, fmt: { num, shortDate, longDate } };
})(window);
