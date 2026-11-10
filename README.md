# KanjiLite

A small, unofficial client for [WaniKani](https://www.wanikani.com).

## Features

- **Dashboard**: available lessons and reviews, a 24-hour review forecast (tap a time to list the items due then, with their meanings and readings hidden until you tap an item), and level progress split into radicals, kanji and vocabulary, each bar split into one shade per SRS stage, from Burned on the left to Not started on the right (hover or tap a segment for its stage and count; the dark mark on the kanji bar is the 90% needed to level up). Also:
  - **Critical condition**: the items you answer correctly less than 75% of the time (at least four answers, not burned), worst first. Tap one to open it.
  - **Your numbers**: review streak, time on the current level compared with your average, the date you can expect the next level, reviews today, burned items, answer accuracy and time on WaniKani. The streak counts reviews done in this app.
- **Workload guard**: burnout is the main reason people quit, and it usually follows a review backlog that built up while lessons kept coming. The dashboard's **Workload check** compares what you are piling up with what you actually manage (your own reviews a day over the last two weeks, plus some room for a heavy day, or a limit you set) and warns you early:
  - **What it watches**: reviews due now, and a forecast of the next week built from the real schedule: every item you have started is followed through its remaining reviews (4 hours, 8 hours, a day, two days, a week and so on), so reviews coming back from Guru and Master count as well as Apprentice ones. It also watches days since your last review, a lesson pace this week that would bring more reviews a day than you can do, and a saved plan whose busiest weeks are heavier than your usual.
  - **What helps**: reviews can only be done once they are due, so no number of reviews is set as a target. A warning says what is ready now, what is coming, roughly how long a pile takes at your usual pace, whether to pause or ease lessons meanwhile, and what that costs your plan (a few days of schedule, and the extra lessons a day needed to make it up, or how much your date would have to move). One tap sets the session length to 50 so a big pile is split into sessions you can finish.
  - **Toasts and notifications**: a toast the first time each day things get worse, a note after every lesson batch (the reviews it adds over the next few days, and whether more lessons still fit today), good news when a review session brings the pile back under control, and, if browser notifications are on, a background notification for a serious pile-up (at most once a day).
  - **Never blocks you**: a warning can be dismissed for the day (it comes back if it gets worse). If reviews are badly piled up, opening Lessons asks first, and so does starting another batch once the reviews already scheduled leave no room for more; *Start anyway* always works. Today's lesson allowance is the plan's daily goal, held lower only when the scheduled reviews leave less room, and never below what you have already done.
  - **Tied to your plan**: *Today's plan* shows the safe lesson amount (the plan's number, eased or paused while reviews are piled up). The Plan screen shows a one-line sustainability check of the busiest weeks against your limit, a **Use <date>** link when the plan is too heavy (the earliest date that keeps the busiest weeks under your limit, so the same goal with lighter days), and a prompt before saving a plan that is much heavier than you manage. The off-track banner no longer tells you to sprint while a backlog exists.
  - Switch it off, set your own limit or turn off the lesson prompt in Settings, Alerts.
- **Reviews**: meaning and reading questions, romaji typed as you go turns into hiragana, close-match typo tolerance, your own synonyms, blacklist and whitelist answers, on'yomi/kun'yomi hints, mnemonics after every answer, and "Wrap up".
  - **Undo answer** (button or Ctrl/Cmd+Z) takes back the answer you just submitted, right or wrong, until you press Next.
  - **Reading and meaning back to back**: after a correct answer, the same item's other question comes next. Optionally always ask meaning first or reading first.
  - **Item level** shown on every review card (can be switched off).
  - **SRS stage** (Apprentice IV, Guru II, …) shown on the review card, and a small toast after each answer with the stage the item moved to (arrow up or down). It appears after a wrong answer right away and, for a correct one, once both of the item's questions are done. Both can be switched off in Settings, Study, Review cards.
  - **Custom session length**: any number, set on the dashboard (right under the Reviews and Lessons tiles) or in Settings, Study (0 means everything due).
  - **Saves as you go**: each finished item is sent to WaniKani as soon as you move to the next card, and half-finished items and your place in the session are saved after every answer. Close the tab, come back, and Reviews resumes where you stopped.
- **Lessons**: batches (3 to 10 items) with meanings, readings, mnemonics, example sentences and components, followed by a quiz. Items are started on WaniKani when the quiz is finished.
- **Level browser**: every radical, kanji and vocabulary item of any level, colored by SRS stage, with a detail view for each. Each kanji shows its progress toward Guru I (0/5 to 4/5), then a check mark once it has passed it.
- **Pitch accent diagrams** in the detail view: a vocabulary item shows one diagram per reading, and a kanji shows the diagrams of a few words that use it (high and low dots, with a hollow dot for the particle that follows, and the name of the pattern). WaniKani's API has no pitch data, so the accent numbers come from the [Kanjium](https://github.com/mifunetoshiro/kanjium) list, which is downloaded the first time a diagram is needed and then kept in the browser.
- **Audio** in the detail view (search, lessons and the review feedback card): vocabulary plays WaniKani's recordings by native-speaker voice actors, one button per reading, with a random voice each time. WaniKani has no recordings of kanji on their own, so a kanji offers recordings of up to four words that use it, preferring the one-kanji word and words with the reading you are learning. Nothing is computer generated. Settings, Study, Review cards has **Play audio after a correct answer**, off by default; it plays vocabulary only (not kanji), in reviews only (not the lesson quiz).
- **Search**: find items by meaning, by reading (kana or romaji) or by the kanji or word itself, optionally limited to one of those or to radicals, kanji or vocabulary. Results are grouped and open the usual detail view, which has buttons for the item's page on WaniKani and on Jisho. It searches the levels saved on this device and can download the rest on request. The query stays in the address bar (`#/search/水`).
- **Stats**: an estimate of when you will reach a level you choose, based on how long your finished levels took (all of them, the last 10 or 5, a figure of your own, or the fastest possible), with a quicker-to-slower range. One unusually long level (a holiday, an illness) is pulled in towards the rest instead of dragging the average up, and with six or more finished levels a trend line lets later levels differ from earlier ones and a date for each level on the way. Also summary numbers, answer accuracy by meaning, reading and item type, the items you miss most, and interactive graphs: time per level, level over time, reviews/accuracy/mistakes/lessons by day, week or month, reviews by hour, and items by SRS stage. A calendar heatmap shows the reviews done on each day of the last 12 months or of any year with data. Every graph has editable axes: type a range, pick the measure, or drag to zoom (double-click resets). The review graphs (and the heatmap) are built from the reviews you finish in KanjiLite, counted into daily totals and kept in the browser. WaniKani no longer keeps individual reviews, so its API has no review history to download and anything done before, or elsewhere, is not included.
- **Offline-tolerant**: finished reviews and started lessons are queued in the browser and retried until WaniKani accepts them. Once your data has been downloaded, the dashboard, reviews, lessons and level browser all open without a connection.
- **Plan**: pick a level and a date and KanjiLite works out the days per level, the new lessons a day and roughly how many reviews they create (from WaniKani's standard intervals), with a date for every level on the way. Change the level or date and everything updates; the pace is worked out from the two, and a date that is quicker than WaniKani allows is flagged with the earliest possible one. Save it and the dashboard warns you when you fall behind the plan (and says what pace would catch you up); dismiss it for the day if you like. The plan is kept in this browser (and synced if you set up sync).
  - **Not a straight line**: the date you pick sets the total time, but the days are shared out over the levels using your own pace (most people slow down as levels grow) and, once the levels are downloaded, how many items each level has. The shape is saved with the plan, so the dashboard compares you with the same curve. Plans saved by an older version keep working with an even spread.
  - **Accuracy-aware**: the review estimate uses your answer accuracy from WaniKani's review statistics (85% until it is known): every wrong answer sends an item back for another review. The Plan screen notes the accuracy it used, and the dashboard and the saved-plan line tell you when your accuracy has moved 3 points or more from what the plan assumed, with the new reviews-a-day figure. It uses the lifetime figure WaniKani keeps, so it moves slowly.
  - **Today's plan on the dashboard** shows lessons done against the daily goal and reviews done against the day's total. The total is worked out once a day (reviews already done plus everything due before midnight) and kept, so the bar only moves forward as you review; reviews that appear later in the day carry it past 100%.
- **Review notifications** (Settings, Alerts): a browser notification when new reviews become available, with a minimum number of reviews, and the count in the tab title. There is no server, so it works while KanjiLite is open in a tab (a background tab is fine); a closed page can't send notifications. One notification per wave: you are notified again after your due count drops below your threshold. Needs https (GitHub Pages) or localhost. KanjiLite can also be installed as an app (Chrome's install button in the address bar, or Menu, Cast, save and share, Install page as app on ChromeOS); it then opens in its own window.
- **Extra practice**: quizzes on items you already know that change nothing on WaniKani. Sets: recently learned, recent mistakes, critical condition, Apprentice items, the current level, burned items and **Different readings**. That last one holds vocabulary whose reading is new or different. Each word is compared with the on'yomi and kun'yomi of the kanji it is written with, and the readings WaniKani teaches in the kanji lessons (the ones its quiz accepts) count as already known. Words that use another reading of a kanji (選ぶ えら, 食べる た, 人 ひと, 三人 さんにん) and words that can't be built from the kanji's readings at all (大人 おとな, 今日 きょう, 明日 あした) are always included. A setting, *Include dakuten-changed readings*, also adds words that only differ by a voiced or half-voiced sound (手紙 てがみ, 一本 いっぽん, 大丈夫 だいじょうぶ). A shortened final sound (学校 がっこう) doesn't count as a change. The first time, the words and their kanji are downloaded and the result is kept on this device. *Practice order* (in Settings, and on the practice panel) sorts a whole set before a session takes its items from the top: most or least recently learned, level low to high or high to low, accuracy low to high or high to low, and SRS stage low to high or high to low. The default keeps each set's own way: a random pick, or newest or worst first.
- **Settings** in three tabs, each setting in one place: *Study* (session length, question order, wrong-answer lock, review cards and audio, lessons per batch, items per practice, dakuten-changed readings in practice), *Alerts* (the workload guard and review notifications) and *General* (theme, visual effects, answer flash, sync, backup, account).
- **Wrong-answer lock**: after a wrong answer "Next" stays locked briefly (1 second by default, configurable) so an extra Enter press can't skip the correction. Right and wrong answers differ in color, icon, motion and a text banner.
- **Rate-limit friendly, with no waiting**: WaniKani allows 60 requests per minute, so KanjiLite keeps a local copy of your data instead of asking for it every time a screen opens.
  - Assignments, study materials and subjects are downloaded once and saved in the browser. After that only what changed is fetched (`updated_after`), usually one or two requests when the app opens or the tab regains focus.
  - Review and lesson counts, the 24-hour forecast, the review and lesson queues, level progress and the level browser are computed from that copy, so they open instantly and cost no requests.
  - Lessons are marked started immediately and finished reviews are queued; both are sent in the background. WaniKani's reply to each upload updates the local copy, so nothing is re-fetched afterwards.
  - Uploads and syncs run at a lower priority than anything a screen is waiting for, share one request budget across tabs, back off when WaniKani's rate-limit headers say the budget is nearly used, and wait out a 429 instead of failing.
  - Subjects for your levels are downloaded quietly in the background after your first visit.
- Light, dark (matte black), liquid glass (pure black with frosted panels and neon light) or follow-your-device themes. The green/red flash after an answer can be switched off or set anywhere from 10% to 200% strength. *Visual effects* is Automatic, Full or Lite; Lite (picked automatically on devices that look low on power) removes blur, glow and shaking animations. All dropdowns, steppers, switches and confirmations are drawn with CSS rather than native browser controls.

## Using it

1. On WaniKani open **Settings, Personal Access Tokens** and generate a token.
2. Tick **assignments:start** and **reviews:create**. Without them you can browse but lessons and reviews cannot be saved. Also tick **study_materials:create** and **study_materials:update** if you want to add synonyms and notes to items (they are saved on WaniKani).
3. Paste the token into KanjiLite. It is stored in your browser's local storage and only ever sent to `api.wanikani.com`.

Your plan and settings are kept in this browser too. If the browser clears its data they are lost, so Settings has **Back up and restore**: save a file and load it again later (the token is only included if you tick the box).

To use the same plan and settings on several devices, see [SYNC.md](SYNC.md) (Google or email sign-in, free, about five minutes; it also covers protecting a copy that other people use).

Treat the token like a password. Anyone who uses KanjiLite on a shared computer should log out (Settings, Log out).

## Files

```
index.html            App shell
sw.js                 Service worker: shows review notifications and focuses the app when one is tapped
manifest.webmanifest  Web app manifest, so the site can be installed as an app (Chrome, ChromeOS, Edge, Android)
icons/                App icons (also used as the notification icon and badge)
css/
  style.css           Styles, light and dark
js/
  config.js           Optional Firebase details for sync (empty by default)
  sync.js             Optional sync of plan and settings through Google or email sign-in and Firestore
  app.js              Entry point: starts the app once the files in app/ have loaded
  app/                The app itself, one file per area. Loaded in this order (see index.html); they share
                      what they need through window.KL
    core.js           Helpers, settings, the saved review session, toasts, navigation, shared state (KL.S)
    workload.js       Workload guard: gathers the numbers for logic/guard.js, gates lessons
    subject.js        Tiles, the item detail body, your own synonyms and notes
    modal.js          The detail popup and the item-spread grid
    keep.js           Browser-storage guard and backup
    syncui.js         Sync sign-in forms, the nav button, refresh when idle
    settings.js       The settings dialog
    router.js         Routing and the signed-in user
    login.js          Login view
    home.js           Dashboard view
    views.js          Search, stats, plan and level-browser views
    quiz.js           Quiz engine shared by reviews and lessons
    reviews.js        Reviews view and summary
    practice.js       Extra practice
    lessons.js        Lessons view
  data/
    api.js            WaniKani API wrapper: request pacing, 429 handling, pagination, IndexedDB access, upload queues
    store.js          Local copy of your data: first download, incremental sync, and the queries that replace API calls
    stats.js          Level history, review statistics, review recording (per-day totals), pace and estimate maths
  logic/
    check.js          Answer checking (meanings with typo tolerance, readings)
    readings.js       Which vocabulary is read differently from its kanji (regular, new reading, dakuten-changed or completely different)
    practice.js       Which items each extra-practice set holds, and the mistake log
    pitch.js          Pitch accent: mora splitting, diagram drawing, accent lookup (Kanjium)
    search.js         Matching subjects by meaning, reading or characters; WaniKani and Jisho links
    kana.js           Romaji to hiragana conversion
    plan.js           Level plan maths (pace, workload, schedule, on-track check) and the saved plan
    guard.js          Workload guard: backlog, a forecast of the reviews already scheduled, skipped days, lesson pace and plan weight against your own limit; what helps
  ui/
    ui.js             CSS-styled select, number stepper, switch and confirm dialog
    charts.js         SVG charts with hover values, drag-to-zoom and editable axes
    heatmap.js        Calendar heatmap of reviews per day
    dashboard.js      Dashboard widgets: level progress by type, critical condition, your numbers
    guardview.js      The dashboard's Workload check panel
    statsview.js      The Stats screen
    searchview.js     The Search screen
    pitchview.js      Fills pitch accent diagrams into the detail view
    audio.js          Native-speaker audio: buttons in the detail view and review autoplay
    notify.js         Review notifications (timer, local check, permission, settings text)
    planview.js       The Plan screen and the dashboard's off-track banner
```

Scripts load in this order (see `index.html`): `kana`, `check`, `search`, `pitch`, `api`, `store`, `stats`, `plan`, `guard`, `ui`, `charts`, `heatmap`, `dashboard`, `guardview`, `statsview`, `searchview`, `pitchview`, `audio`, `notify`, `planview`, `app`.

## Notes and limits

- Reviews load in sessions (100 items by default, adjustable).
- The first visit on a device downloads your assignments (a few requests, a few seconds). Changes made elsewhere (the WaniKani website, another app) show up the next time the app syncs: on opening, when the tab regains focus, and every few minutes on the dashboard.
- Logging out clears the saved copy of your data from the browser.
- WaniKani only accepts a review once an item's meaning and reading are both answered, so an item is sent when it is finished. Anything unfinished is kept in your browser and resumed instead.
- Audio is not saved for offline use (it streams from WaniKani), and the radical/kanji "wrap-up" extras, undo, burned-item resurrection and the Anki-style statistics of the official site are not included.
- WaniKani is a trademark of Tofugu. This project is not affiliated with or endorsed by WaniKani or Tofugu.

MIT licensed.
