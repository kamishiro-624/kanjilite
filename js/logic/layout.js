/* Dashboard layout: which widgets the home screen shows, in what order, how wide, and how much they say.
   Pure logic plus one localStorage key (kl_dash). Kept on this device only, because a phone and a laptop want
   different layouts (it is still included in backup files). Only differences from the defaults are stored. */
(function (root) {
  'use strict';

  const KEY = 'kl_dash';
  // In the default order. `levels` lists the amounts of detail a widget offers (1 brief, 2 standard, 3 detailed);
  // an empty list means it has only one. `pinned` widgets can't be hidden.
  const WIDGETS = [
    { id: 'guard', name: 'Workload check', levels: [1, 2, 3] },
    { id: 'plan', name: 'Plan warning', levels: [] },
    { id: 'today', name: 'Today’s plan', levels: [1, 2] },
    { id: 'todo', name: 'Reviews and lessons', levels: [], pinned: true },
    { id: 'session', name: 'Session length', levels: [1, 2] },
    { id: 'practice', name: 'Extra practice', levels: [1, 2] },
    { id: 'spread', name: 'Item spread', levels: [1, 2] },
    { id: 'progress', name: 'Level progress', levels: [1, 2] },
    { id: 'numbers', name: 'Your numbers', levels: [1, 2] },
    { id: 'critical', name: 'Critical condition', levels: [1, 2, 3] },
    { id: 'upcoming', name: 'Coming up', levels: [1, 2, 3] },
  ];
  const SIZES = ['third', 'half', 'full'];
  const SIZE_NAMES = { third: 'Third', half: 'Half', full: 'Full' };
  const LEVEL_NAMES = { 1: 'Brief', 2: 'Standard', 3: 'Detailed' };
  const DEFAULT_SIZE = 'full';
  const DEFAULT_LEVEL = 2;
  const byId = (id) => WIDGETS.find((w) => w.id === id);
  const defaultOrder = () => WIDGETS.map((w) => w.id);

  function read() {
    try { const o = JSON.parse(localStorage.getItem(KEY)); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
  }

  /** The saved layout, always complete and valid: { order: [ids], cfg: { id: { size, v, on } } }.
      Unknown ids are dropped, and widgets added in a later version join at the end. */
  function get() {
    const raw = read();
    const seen = new Set();
    const order = (Array.isArray(raw.o) ? raw.o : []).filter((id) => byId(id) && !seen.has(id) && seen.add(id));
    defaultOrder().forEach((id) => { if (!seen.has(id)) order.push(id); });
    const w = raw.w && typeof raw.w === 'object' ? raw.w : {};
    const cfg = {};
    WIDGETS.forEach((def) => {
      const s = w[def.id] && typeof w[def.id] === 'object' ? w[def.id] : {};
      cfg[def.id] = {
        size: SIZES.includes(s.s) ? s.s : DEFAULT_SIZE,
        v: def.levels.includes(s.v) ? s.v : DEFAULT_LEVEL,
        on: def.pinned ? true : s.h !== 1,
      };
    });
    return { order, cfg };
  }

  function save(state) {
    const out = {};
    const base = defaultOrder();
    if (state.order.some((id, i) => id !== base[i])) out.o = state.order;
    const w = {};
    WIDGETS.forEach((def) => {
      const c = state.cfg[def.id];
      const e = {};
      if (c.size !== DEFAULT_SIZE) e.s = c.size;
      if (c.v !== DEFAULT_LEVEL) e.v = c.v;
      if (!c.on && !def.pinned) e.h = 1;
      if (Object.keys(e).length) w[def.id] = e;
    });
    if (Object.keys(w).length) out.w = w;
    localStorage.setItem(KEY, JSON.stringify(out));
  }

  /** Move a widget one place earlier (dir -1) or later (dir 1) among all widgets, hidden ones included. */
  function move(id, dir) {
    const st = get();
    const i = st.order.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= st.order.length) return st;
    st.order.splice(j, 0, st.order.splice(i, 1)[0]);
    save(st);
    return st;
  }

  /** Change one widget: patch is any of { size, v, on }. Values that don't fit the widget are ignored. */
  function set(id, patch) {
    const st = get();
    const def = byId(id), c = st.cfg[id];
    if (!def) return st;
    if (SIZES.includes(patch.size)) c.size = patch.size;
    if (def.levels.includes(patch.v)) c.v = patch.v;
    if (typeof patch.on === 'boolean' && !def.pinned) c.on = patch.on;
    save(st);
    return st;
  }

  function reset() { localStorage.setItem(KEY, '{}'); return get(); }
  function isDefault() { return !Object.keys(read()).length; }

  root.Layout = { WIDGETS, SIZES, SIZE_NAMES, LEVEL_NAMES, KEY, get, set, move, reset, isDefault, byId };
})(typeof window !== 'undefined' ? window : globalThis);
