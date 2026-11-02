/* Small UI kit: CSS-styled replacements for the browser's native <select>, number input and confirm(). */
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = (s, r) => (r || document).querySelector(s);

  const CHEVRON = '<svg class="select-chev" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---------- select ----------
  let closeOpen = null; // closes whichever popup is open
  let closedAt = 0;
  const closeSelect = () => { if (closeOpen) closeOpen(); };

  /** options: [{ value, label }]. Read the choice via onChange in bindSelect(). */
  function selectHTML(id, options, value, ariaLabel) {
    const cur = options.find((o) => String(o.value) === String(value)) || options[0];
    return `<div class="select" data-select data-value="${esc(cur.value)}" data-options="${esc(JSON.stringify(options))}">
      <button type="button" class="select-btn" id="${esc(id)}" aria-haspopup="listbox" aria-expanded="false"${ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ''}>
        <span class="select-label">${esc(cur.label)}</span>${CHEVRON}
      </button></div>`;
  }

  function bindSelect(el, onChange) {
    if (!el) return;
    const btn = qs('.select-btn', el);
    const labelEl = qs('.select-label', el);
    const options = JSON.parse(el.dataset.options);
    let pop = null, active = 0, typed = '', typedTimer = 0;

    const curIndex = () => Math.max(0, options.findIndex((o) => String(o.value) === el.dataset.value));
    const closer = () => close(false);

    function place() {
      const r = btn.getBoundingClientRect();
      const vh = window.innerHeight, vw = window.innerWidth;
      pop.style.minWidth = r.width + 'px';
      pop.style.maxHeight = '';
      const natural = Math.min(pop.scrollHeight, 288);
      const below = vh - r.bottom - 12, above = r.top - 12;
      let top, maxH;
      if (below >= natural || below >= above) { top = r.bottom + 4; maxH = Math.min(288, below); }
      else { maxH = Math.min(288, above); top = r.top - 4 - Math.min(natural, maxH); }
      pop.style.top = Math.max(8, top) + 'px';
      pop.style.maxHeight = maxH + 'px';
      pop.style.left = r.left + 'px';
      const w = pop.offsetWidth;
      if (r.left + w > vw - 8) pop.style.left = Math.max(8, vw - 8 - w) + 'px';
    }

    function mark(how) {
      [...pop.children].forEach((c, i) => c.classList.toggle('active', i === active));
      const o = pop.children[active];
      btn.setAttribute('aria-activedescendant', o.id);
      if (how === 'center') pop.scrollTop = Math.max(0, o.offsetTop - (pop.clientHeight - o.offsetHeight) / 2);
      else if (how === 'nearest') {
        if (o.offsetTop < pop.scrollTop) pop.scrollTop = o.offsetTop;
        else if (o.offsetTop + o.offsetHeight > pop.scrollTop + pop.clientHeight) pop.scrollTop = o.offsetTop + o.offsetHeight - pop.clientHeight;
      }
    }

    const onDoc = (e) => { if (pop && !pop.contains(e.target) && !el.contains(e.target)) close(false); };
    const onScroll = (e) => { if (pop && !pop.contains(e.target)) close(false); };

    function open() {
      closeSelect();
      pop = document.createElement('div');
      pop.className = 'select-pop';
      pop.id = btn.id + '-list';
      pop.setAttribute('role', 'listbox');
      pop.innerHTML = options.map((o, i) => `<div class="select-opt" role="option" id="${esc(btn.id)}-o${i}" data-i="${i}" aria-selected="${i === curIndex()}">${esc(o.label)}</div>`).join('');
      // Inside a modal <dialog> the popup has to live in the dialog, or it would render underneath it.
      (el.closest('dialog') || document.body).appendChild(pop);
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-controls', pop.id);
      active = curIndex();
      place();
      mark('center');
      pop.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on the button
      pop.addEventListener('click', (e) => { const o = e.target.closest('.select-opt'); if (o) choose(Number(o.dataset.i)); });
      pop.addEventListener('mousemove', (e) => {
        const o = e.target.closest('.select-opt');
        if (o && Number(o.dataset.i) !== active) { active = Number(o.dataset.i); mark(); }
      });
      document.addEventListener('pointerdown', onDoc, true);
      window.addEventListener('resize', closer);
      window.addEventListener('scroll', onScroll, true);
      closeOpen = closer;
    }

    function close(focus) {
      if (!pop) return;
      pop.remove();
      pop = null;
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
      btn.removeAttribute('aria-controls');
      document.removeEventListener('pointerdown', onDoc, true);
      window.removeEventListener('resize', closer);
      window.removeEventListener('scroll', onScroll, true);
      if (closeOpen === closer) closeOpen = null;
      closedAt = Date.now();
      if (focus) btn.focus();
    }

    function choose(i) {
      const o = options[i];
      if (!o) return;
      const changed = String(o.value) !== el.dataset.value;
      el.dataset.value = String(o.value);
      labelEl.textContent = o.label;
      close(true);
      if (changed && onChange) onChange(o.value);
    }

    function move(d) { active = Math.max(0, Math.min(options.length - 1, active + d)); mark('nearest'); }

    function typeahead(ch) {
      typed += ch.toLowerCase();
      clearTimeout(typedTimer);
      typedTimer = setTimeout(() => { typed = ''; }, 700);
      const i = options.findIndex((o) => String(o.label).toLowerCase().startsWith(typed));
      if (i >= 0) { active = i; mark('nearest'); }
    }

    btn.addEventListener('click', () => (pop ? close(true) : open()));
    btn.addEventListener('keydown', (e) => {
      if (!pop) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
        return;
      }
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); move(1); break;
        case 'ArrowUp': e.preventDefault(); move(-1); break;
        case 'PageDown': e.preventDefault(); move(8); break;
        case 'PageUp': e.preventDefault(); move(-8); break;
        case 'Home': e.preventDefault(); active = 0; mark('nearest'); break;
        case 'End': e.preventDefault(); active = options.length - 1; mark('nearest'); break;
        case 'Enter': case ' ': e.preventDefault(); choose(active); break;
        case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); break;
        case 'Tab': close(false); break;
        default: if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeahead(e.key);
      }
    });
  }

  // ---------- number stepper ----------
  function stepperHTML(id, value, o) {
    const { min = 0, max = 100, step = 1, label } = o || {};
    return `<div class="stepper" data-stepper data-min="${min}" data-max="${max}" data-step="${step}">
      <button type="button" class="step-btn" data-d="-1" aria-label="Decrease" tabindex="-1">&minus;</button>
      <input id="${esc(id)}" class="step-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"${label ? ` aria-label="${esc(label)}"` : ''} value="${esc(value)}">
      <button type="button" class="step-btn" data-d="1" aria-label="Increase" tabindex="-1">+</button>
    </div>`;
  }

  function bindStepper(el, onCommit) {
    if (!el) return;
    const input = qs('.step-input', el);
    const [dec, inc] = el.querySelectorAll('.step-btn');
    const min = Number(el.dataset.min), max = Number(el.dataset.max), step = Number(el.dataset.step) || 1;
    let cur = Number(input.value) || 0;

    const refresh = () => { dec.disabled = cur <= min; inc.disabled = cur >= max; };
    const commit = (v) => {
      v = Math.max(min, Math.min(max, Math.round(v)));
      const changed = v !== cur;
      cur = v;
      input.value = String(v);
      refresh();
      if (changed && onCommit) onCommit(v);
    };
    const bump = (d) => commit(cur + d * step);

    input.addEventListener('input', () => { const c = input.value.replace(/\D/g, ''); if (c !== input.value) input.value = c; });
    input.addEventListener('change', () => { if (input.value === '') input.value = String(cur); else commit(Number(input.value)); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
    el.addEventListener('click', (e) => { const b = e.target.closest('.step-btn'); if (b && !b.disabled) bump(Number(b.dataset.d)); });
    // Lets other code move the number (a setting changed elsewhere) without it counting as a change made here.
    el._setStepper = (v) => { cur = Math.max(min, Math.min(max, Math.round(Number(v) || 0))); if (document.activeElement !== input) input.value = String(cur); refresh(); };
    refresh();
  }

  /** Show a new value in a stepper that was set up with bindStepper. */
  function setStepper(el, value) { if (el && el._setStepper) el._setStepper(value); }

  // ---------- switch (a checkbox drawn with CSS) ----------
  function switchHTML(id, checked, text, hint) {
    return `<label class="switch-row" for="${esc(id)}"><span class="switch-text">${esc(text)}${hint ? `<small>${esc(hint)}</small>` : ''}</span>
      <input type="checkbox" class="switch" role="switch" id="${esc(id)}"${checked ? ' checked' : ''}></label>`;
  }

  // ---------- confirm dialog (replaces window.confirm) ----------
  /** Resolves true if the person confirms. Cancel is the default focus. */
  function confirmDialog(o) {
    const d = document.getElementById('confirm');
    const { title = 'Are you sure?', message = '', ok = 'OK', cancel = 'Cancel', danger = false } = o || {};
    return new Promise((resolve) => {
      qs('#confirm-title').textContent = title;
      qs('#confirm-msg').textContent = message;
      const okBtn = qs('#confirm-ok'), noBtn = qs('#confirm-cancel');
      okBtn.textContent = ok;
      noBtn.textContent = cancel;
      okBtn.classList.toggle('danger', !!danger);
      let result = false;
      const onClose = () => { d.removeEventListener('close', onClose); resolve(result); };
      d.addEventListener('close', onClose);
      okBtn.onclick = () => { result = true; d.close(); };
      noBtn.onclick = () => d.close();
      d.showModal();
      noBtn.focus();
    });
  }
  const confirmEl = document.getElementById('confirm');
  if (confirmEl) confirmEl.addEventListener('click', (e) => { if (e.target === confirmEl) confirmEl.close(); });

  // The main dialog must not close on the Escape press that only dismissed a dropdown.
  const main = document.getElementById('modal');
  if (main) {
    main.addEventListener('cancel', (e) => { if (closeOpen || Date.now() - closedAt < 150) e.preventDefault(); });
    main.addEventListener('close', closeSelect);
  }

  root.UI = {
    selectHTML, bindSelect, closeSelect,
    stepperHTML, bindStepper, setStepper,
    switchHTML,
    confirm: confirmDialog,
    anyDialogOpen: () => !!document.querySelector('dialog[open]'),
  };
})(window);
