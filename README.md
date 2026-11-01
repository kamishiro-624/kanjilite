# KanjiLite

A small, unofficial client for [WaniKani](https://www.wanikani.com). It is a static site (plain HTML, CSS and JavaScript, no build step) that talks directly to the WaniKani API v2, so it can be hosted for free on GitHub Pages.

## Features

- **Dashboard**: available lessons and reviews, a 24-hour review forecast, and progress toward leveling up (90% of the level's kanji at Guru or above).
- **Reviews**: meaning and reading questions, romaji typed as you go turns into hiragana, close-match typo tolerance, your own synonyms, blacklist and whitelist answers, on'yomi/kun'yomi hints, mnemonics after every answer, and "Wrap up".
  - **Undo answer** (button or Ctrl/Cmd+Z) takes back the answer you just submitted, right or wrong, until you press Next.
  - **Reading and meaning back to back**: after a correct answer, the same item's other question comes next. Optionally always ask meaning first or reading first.
  - **Item level** shown on every review card (can be switched off).
  - **Custom session length**: any number, set on the dashboard or in Settings (0 means everything due).
  - **Saves as you go**: each finished item is sent to WaniKani as soon as you move to the next card, and half-finished items and your place in the session are saved after every answer. Close the tab, come back, and Reviews resumes where you stopped.
- **Lessons**: batches (3 to 10 items) with meanings, readings, mnemonics, example sentences and components, followed by a quiz. Items are started on WaniKani when the quiz is finished.
- **Level browser**: every radical, kanji and vocabulary item of any level, colored by SRS stage, with a detail view for each.
- **Offline-tolerant**: finished reviews are queued in the browser and retried until WaniKani accepts them.
- Light and dark themes (follows your system setting).

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

| File | Purpose |
| --- | --- |
| `index.html` | App shell |
| `style.css` | Styles, light and dark |
| `app.js` | Routing, dashboard, lessons, reviews, level browser, settings |
| `api.js` | WaniKani API wrapper: pagination, caching, rate-limit retry, review queue |
| `check.js` | Answer checking (meanings with typo tolerance, readings) |
| `kana.js` | Romaji to hiragana conversion |

## Notes and limits

- Reviews load in sessions (100 items by default, adjustable) to keep loading fast.
- WaniKani only accepts a review once an item's meaning and reading are both answered, so an item is sent when it is finished. Anything unfinished is kept in your browser and resumed instead.
- Audio, the radical/kanji "wrap-up" extras, undo, burned-item resurrection and the Anki-style statistics of the official site are not included.
- WaniKani is a trademark of Tofugu. This project is not affiliated with or endorsed by WaniKani or Tofugu.

MIT licensed.
