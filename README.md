# KanjiLite

A small, unofficial client for [WaniKani](https://www.wanikani.com). It is a static site (plain HTML, CSS and JavaScript, no build step) that talks directly to the WaniKani API v2, so it can be hosted for free on GitHub Pages.

## Features

- **Dashboard**: available lessons and reviews, a 24-hour review forecast, and level progress split into radicals, kanji and vocabulary, each bar split into one shade per SRS stage, from Burned on the left to Not started on the right (hover or tap a segment for its stage and count; the dark mark on the kanji bar is the 90% needed to level up). Also:
  - **Critical condition**: the items you answer correctly less than 75% of the time (at least four answers, not burned), worst first. Tap one to open it.
  - **Your numbers**: review streak, time on the current level compared with your average, the date you can expect the next level, reviews today, burned items, answer accuracy and time on WaniKani. The streak counts reviews done in this app and, once you have downloaded your review history on the Stats page, everything before too.
- **Reviews**: meaning and reading questions, romaji typed as you go turns into hiragana, close-match typo tolerance, your own synonyms, blacklist and whitelist answers, on'yomi/kun'yomi hints, mnemonics after every answer, and "Wrap up".
  - **Undo answer** (button or Ctrl/Cmd+Z) takes back the answer you just submitted, right or wrong, until you press Next.
  - **Reading and meaning back to back**: after a correct answer, the same item's other question comes next. Optionally always ask meaning first or reading first.
  - **Item level** shown on every review card (can be switched off).
  - **SRS stage** (Apprentice IV, Guru II, …) shown on the review card, and a small toast after each answer with the stage the item moved to (arrow up or down). It appears after a wrong answer right away and, for a correct one, once both of the item's questions are done. Both can be switched off in Settings, Reviews, Display.
  - **Custom session length**: any number, set on the dashboard or in Settings (0 means everything due).
  - **Saves as you go**: each finished item is sent to WaniKani as soon as you move to the next card, and half-finished items and your place in the session are saved after every answer. Close the tab, come back, and Reviews resumes where you stopped.
- **Lessons**: batches (3 to 10 items) with meanings, readings, mnemonics, example sentences and components, followed by a quiz. Items are started on WaniKani when the quiz is finished.
- **Level browser**: every radical, kanji and vocabulary item of any level, colored by SRS stage, with a detail view for each. Each kanji shows its progress toward Guru I (0/5 to 4/5), then a check mark once it has passed it.
- **Pitch accent diagrams** in the detail view: a vocabulary item shows one diagram per reading, and a kanji shows the diagrams of a few words that use it (high and low dots, with a hollow dot for the particle that follows, and the name of the pattern). WaniKani's API has no pitch data, so the accent numbers come from the [Kanjium](https://github.com/mifunetoshiro/kanjium) list, which is downloaded the first time a diagram is needed and then kept in the browser.
- **Search**: find items by meaning, by reading (kana or romaji) or by the kanji or word itself, optionally limited to one of those or to radicals, kanji or vocabulary. Results are grouped and open the usual detail view, which has buttons for the item's page on WaniKani and on Jisho. It searches the levels saved on this device and can download the rest on request. The query stays in the address bar (`#/search/水`).
- **Stats**: an estimate of when you will reach a level you choose, based on how long your finished levels took (all of them, the last 10 or 5, a figure of your own, or the fastest possible), with a quicker-to-slower range and a date for each level on the way. Also summary numbers, answer accuracy by meaning, reading and item type, the items you miss most, and interactive graphs: time per level, level over time, reviews/accuracy/mistakes/lessons by day, week or month, reviews by hour, and items by SRS stage. A calendar heatmap shows the reviews done on each day of the last 12 months or of any year with data. Every graph has editable axes: type a range, pick the measure, or drag to zoom (double-click resets). The review graphs need your review history, which is downloaded only when you ask for it, counted into daily totals and kept in the browser.
- **Offline-tolerant**: finished reviews and started lessons are queued in the browser and retried until WaniKani accepts them. Once your data has been downloaded, the dashboard, reviews, lessons and level browser all open without a connection.
- **Settings** in two tabs: *General* (theme, a Lessons section, account) and *Reviews* (session length, question order, wrong-answer lock, display).
- **Wrong-answer lock**: after a wrong answer "Next" stays locked briefly (1 second by default, configurable) so an extra Enter press can't skip the correction. Right and wrong answers differ in color, icon, motion and a text banner.
- **Rate-limit friendly, with no waiting**: WaniKani allows 60 requests per minute, so KanjiLite keeps a local copy of your data instead of asking for it every time a screen opens.
  - Assignments, study materials and subjects are downloaded once and saved in the browser. After that only what changed is fetched (`updated_after`), usually one or two requests when the app opens or the tab regains focus.
  - Review and lesson counts, the 24-hour forecast, the review and lesson queues, level progress and the level browser are computed from that copy, so they open instantly and cost no requests.
  - Lessons are marked started immediately and finished reviews are queued; both are sent in the background. WaniKani's reply to each upload updates the local copy, so nothing is re-fetched afterwards.
  - Uploads and syncs run at a lower priority than anything a screen is waiting for, share one request budget across tabs, back off when WaniKani's rate-limit headers say the budget is nearly used, and wait out a 429 instead of failing.
  - Subjects for your levels are downloaded quietly in the background after your first visit.
- Light, dark (matte black) or follow-your-device themes. All dropdowns, steppers, switches and confirmations are drawn with CSS rather than native browser controls.

## Deploy on GitHub Pages

1. Create a new repository on GitHub (for example `kanjilite`).
2. Unzip this archive and upload the files to the root of the repository (or `git init`, commit, and push).
3. In the repository go to **Settings, Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/<repository>/`.

To try it locally, run `python3 -m http.server` in this folder and open http://localhost:8000.

## Using it

1. On WaniKani open **Settings, Personal Access Tokens** and generate a token.
2. Tick **assignments:start** and **reviews:create**. Without them you can browse but lessons and reviews cannot be saved.
3. Paste the token into KanjiLite. It is stored in your browser's local storage and only ever sent to `api.wanikani.com`.

Treat the token like a password. Anyone who uses KanjiLite on a shared computer should log out (Settings, Log out).

## Files

```
index.html            App shell
css/
  style.css           Styles, light and dark
js/
  app.js              Routing, dashboard, lessons, reviews, level browser, settings
  data/
    api.js            WaniKani API wrapper: request pacing, 429 handling, pagination, IndexedDB access, upload queues
    store.js          Local copy of your data: first download, incremental sync, and the queries that replace API calls
    stats.js          Level history, review statistics, resumable review-history download, pace and estimate maths
  logic/
    check.js          Answer checking (meanings with typo tolerance, readings)
    pitch.js          Pitch accent: mora splitting, diagram drawing, accent lookup (Kanjium)
    search.js         Matching subjects by meaning, reading or characters; WaniKani and Jisho links
    kana.js           Romaji to hiragana conversion
  ui/
    ui.js             CSS-styled select, number stepper, switch and confirm dialog
    charts.js         SVG charts with hover values, drag-to-zoom and editable axes
    heatmap.js        Calendar heatmap of reviews per day
    dashboard.js      Dashboard widgets: level progress by type, critical condition, your numbers
    statsview.js      The Stats screen
    searchview.js     The Search screen
    pitchview.js      Fills pitch accent diagrams into the detail view
```

Scripts load in this order (see `index.html`): `kana`, `check`, `search`, `pitch`, `api`, `store`, `stats`, `ui`, `charts`, `heatmap`, `dashboard`, `statsview`, `searchview`, `pitchview`, `app`.

## Notes and limits

- Reviews load in sessions (100 items by default, adjustable).
- The first visit on a device downloads your assignments (a few requests, a few seconds). Changes made elsewhere (the WaniKani website, another app) show up the next time the app syncs: on opening, when the tab regains focus, and every few minutes on the dashboard.
- Logging out clears the saved copy of your data from the browser.
- WaniKani only accepts a review once an item's meaning and reading are both answered, so an item is sent when it is finished. Anything unfinished is kept in your browser and resumed instead.
- Audio, the radical/kanji "wrap-up" extras, undo, burned-item resurrection and the Anki-style statistics of the official site are not included.
- WaniKani is a trademark of Tofugu. This project is not affiliated with or endorsed by WaniKani or Tofugu.

MIT licensed.
