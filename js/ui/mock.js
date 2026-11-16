/* Sample content for the dashboard's customize mode and the "how much to show" preview.
   Every widget is drawn from the same made-up data (nothing from the account, nothing that changes with the time of day
   except the clock times in Coming up), so a widget always has something to show, a layout can be judged without
   waiting for a warning to appear, and the numbers on screen are never someone's real ones.
   Uses the real widget renderers, so a preview looks exactly like the widget will. Ids and `for` attributes are dropped
   from the result (the real widget keeps its own), and the caller makes the result inert. */
(function (root) {
  'use strict';

  const HOUR = 3600 * 1000;

  // [character, meaning, reading, kind, percent right]. Worst first, as Critical condition lists them.
  const CRITICAL = [
    ['夕', 'Evening', 'ゆう', 'kanji', 38], ['未', 'Not Yet', 'み', 'kanji', 41], ['末', 'End', 'まつ', 'kanji', 44], ['係', 'Person In Charge', 'かかり', 'kanji', 46],
    ['辞書', 'Dictionary', 'じしょ', 'vocabulary', 48], ['予定', 'Plans', 'よてい', 'vocabulary', 52], ['届', 'Deliver', 'とど', 'kanji', 54], ['祝', 'Celebrate', 'いわ', 'kanji', 56],
    ['返事', 'Reply', 'へんじ', 'vocabulary', 58], ['横', 'Side', 'よこ', 'kanji', 60], ['鳥', 'Bird', 'とり', 'kanji', 61], ['集める', 'To Gather', 'あつめる', 'vocabulary', 63],
    ['昨日', 'Yesterday', 'きのう', 'vocabulary', 64], ['薬', 'Medicine', 'くすり', 'kanji', 65], ['族', 'Family', 'ぞく', 'kanji', 66], ['短い', 'Short', 'みじかい', 'vocabulary', 67],
    ['歌', 'Song', 'うた', 'kanji', 68], ['止める', 'To Stop', 'とめる', 'vocabulary', 69], ['屋', 'Shop', 'や', 'kanji', 70], ['急ぐ', 'To Hurry', 'いそぐ', 'vocabulary', 71],
    ['馬', 'Horse', 'うま', 'kanji', 72], ['体', 'Body', 'からだ', 'kanji', 73], ['公園', 'Park', 'こうえん', 'vocabulary', 73], ['去年', 'Last Year', 'きょねん', 'vocabulary', 74],
  ];
  const CRITICAL_TOTAL = 31;

  const subject = (row, i) => ({
    id: -1 - i, object: row[3], data: {
      characters: row[0], slug: row[0], level: 12,
      meanings: [{ meaning: row[1], primary: true }], readings: row[2] ? [{ reading: row[2], primary: true }] : [],
    },
  });

  // A made-up level of 100 items for Level progress: stage for item n of each kind (0 means not started).
  function levelSubjects() {
    const spec = { radical: [9, 0, 1, 1, 2, 0, 1, 1, 1, 1], kanji: [4, 4, 3, 6, 5, 4, 2, 1, 3, 1], vocabulary: [2, 4, 5, 8, 12, 9, 6, 4, 6, 4] };
    // count of items per stage 1..9 then not started
    const subs = [], stage = new Map();
    let id = 100000;
    Object.keys(spec).forEach((kind) => {
      spec[kind].forEach((n, st) => {
        for (let k = 0; k < n; k++) {
          const sid = id++;
          subs.push({ id: sid, object: kind, data: { level: 12 } });
          if (st < 9) stage.set(sid, { data: { unlocked_at: 'x', srs_stage: st + 1 } });
        }
      });
    });
    return { subs, assignmentFor: (sid) => stage.get(sid) || null };
  }

  function guardResult() {
    const warnings = [
      { id: 'backlog', sev: 2, title: 'Your reviews are piling up', text: 'There are 148 reviews waiting, about three days of your usual pace, and 61 more come due over the next day.', action: { label: 'Start a session', href: '#/reviews' } },
      { id: 'load', sev: 1, title: 'This week looks heavy', text: 'Tomorrow is forecast at about 210 reviews, more than you usually manage in a day.', action: null },
      { id: 'skipped', sev: 1, title: 'It has been two days since your last review', text: 'A short session today keeps the pile from growing.', action: { label: 'Review now', href: '#/reviews' } },
      { id: 'ahead', sev: 1, title: 'Lessons are coming faster than you can review', text: 'At this week’s lesson pace you would add about 40 reviews a day more than you manage.', action: null },
      { id: 'plan', sev: 1, title: 'The busiest weeks of your plan are heavy', text: 'Weeks 5 and 6 of the plan are over your limit. A later date would even them out.', action: { label: 'Open plan', href: '#/plan' } },
    ];
    return {
      level: 'high', warnings, cap: { auto: true, known: true, value: 120 },
      allowance: { left: 3, goal: 10, hasPlan: true },
      recovery: { due: 148, soon: 61, pile: true, days: 3, lessonsPaused: false, lessonsEased: true, planText: 'This costs your plan about two days of schedule.', sessionTip: 50, peak: null },
    };
  }

  /** The inside of one widget (a `.dw-body` element) with sample content, at a level of detail.
      env: { tile, hourLabel } (the app's helpers for an item tile and a clock label). */
  function body(id, v, env) {
    const wrap = (html) => `<div class="dw-body">${html}</div>`;
    let html = '';
    switch (id) {
      case 'guard': html = wrap(GuardView.panel(guardResult(), 50, v, { all: true })); break;
      case 'plan': {
        const now = Date.now();
        html = wrap(PlanView.banner(
          { target: 30, end: now + 300 * 24 * HOUR },
          { state: 'behind', gap: -1.4, expected: 13.8, pos: 12.4, neededPerLevel: 6.1, plannedPerLevel: 7.5, impossible: false, earliest: now + 200 * 24 * HOUR },
          null));
        break;
      }
      case 'today':
        html = wrap(PlanView.today({ lpd: 8, rpd: 90, acc: 0.85 },
          { lessonsDone: 5, lessonsQueue: 23, reviewsDone: 64, reviewsDue: 18, reviewsTotal: 120, acc: 0.85, guard: { on: false }, rpd: 90 }));
        break;
      case 'todo':
        html = `<div class="dw-body todo">
          <a class="reviews" href="#/reviews"><span class="what">Reviews</span><span class="count">42</span></a>
          <a class="lessons" href="#/lessons"><span class="what">Lessons</span><span class="count">12</span></a></div>`;
        break;
      case 'session':
        html = wrap(`<div class="panel session-panel"><label for="h-size"><b>Reviews per session</b></label>
          ${UI.stepperHTML('h-size', 50, { min: 0, max: 5000, step: 5, label: 'Reviews per session' })}
          <span class="muted" data-min="2">0 means everything that’s due. <button class="link inline" type="button">More study options</button></span></div>`);
        break;
      case 'practice': {
        const counts = { recent: 25, mistakes: 14, critical: 9, apprentice: 38, level: 42, readings: 17, burned: 120 };
        const kinds = Practice.KINDS.map((k) => ({ key: k.key, title: k.title, desc: k.desc, count: counts[k.key] }));
        html = wrap(Dash.practice(kinds, UI.stepperHTML('p-size', 25, { min: 5, max: 200, step: 5, label: 'Items per practice' }),
          UI.selectHTML('p-order', Practice.ORDERS, 'default', 'Practice order'), UI.selectHTML('p-mode', Practice.MODES, 'normal', 'Practice style'), false));
        break;
      }
      case 'spread':
        html = wrap(Dash.spread({ apprentice: [4, 18, 41], guru: [9, 36, 88], master: [6, 22, 64], enlightened: [10, 41, 120], burned: [12, 38, 77] }));
        break;
      case 'progress': {
        const lv = levelSubjects();
        html = wrap(Dash.levelProgress(12, lv.subs, lv.assignmentFor, 12));
        break;
      }
      case 'numbers':
        html = wrap(Dash.numbers({
          user: { started_at: new Date(Date.now() - 410 * 24 * HOUR).toISOString() }, level: 12,
          streak: { current: 9, best: 21, doneToday: true }, haveHistory: true,
          ls: { since: 1, elapsedDays: 6.4 }, pace: { n: 11, mean: 8.2 },
          est: { already: false, date: Date.now() + 5 * 24 * HOUR, days: 5 },
          reviewsToday: 64, bestDay: 212, burned: 160, started: 640, accuracy: 87.3, answers: 14820,
        }));
        break;
      case 'critical': {
        const shown = CRITICAL.slice(0, v >= 3 ? 24 : 8).map((r, i) => ({ subject: subject(r, i), pct: r[4], wrong: 10 }));
        html = wrap(Dash.critical(shown, CRITICAL_TOTAL, 75, env.tile));
        break;
      }
      case 'upcoming': {
        // Whole hours from now on, with a made-up number of reviews at each.
        const first = Math.ceil(Date.now() / HOUR) * HOUR;
        const counts = [18, 9, 6, 0, 4, 11, 7, 3, 0, 5, 14, 8, 2, 0, 6, 9, 4, 3, 0, 7, 12, 5, 2, 8];
        const rows = [];
        counts.forEach((n, i) => { if (n) rows.push({ available_at: new Date(first + i * HOUR).toISOString(), count: n }); });
        html = wrap(`<div class="panel"><h2>Coming up</h2>${Dash.comingUp(rows, v, env.hourLabel)}</div>`);
        break;
      }
      default: return '';
    }
    return html.replace(/\s(id|for)="[^"]*"/g, '');
  }

  root.Mock = { body };
})(window);
