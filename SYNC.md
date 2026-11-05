# Sync across devices (optional)

KanjiLite can keep your **plan and settings** the same on every device, using Google sign-in or an email address and password, and a tiny database in a Firebase project that you own. On Firebase's free Spark plan it costs nothing and needs no card. Without it, everything stays in the browser as before.

**Synced:** your plan, review and lesson settings, workload guard settings (on/off, comfortable reviews a day, the lesson prompt), pace choices and the daily review counts behind your streak.
**Not synced:** the theme and notification settings (per device), WaniKani data (each device downloads its own) and your API token, which only ever syncs if you set `allowTokenSync: true` in `js/config.js` and the person turns it on.

If the sync database is unreachable or over its limits, KanjiLite carries on working from the browser; only Settings shows a sync error.

## Set up

1. At <https://console.firebase.google.com> choose **Create a project**. Pick a name people will recognise (it appears on the Google sign-in screen and in the emails Firebase sends). Analytics is not needed.
2. **Build, Authentication, Get started, Sign-in method**: enable **Google** and **Email/Password** (leave "Email link (passwordless sign-in)" off, and do not enable anonymous). Enable only the one you want if you do not want both; the sign-in form always shows both buttons, and one that is not enabled shows an error saying so. Under **Authentication, Settings, User actions** you can leave "Email enumeration protection" on.
3. **Authentication, Settings, Authorized domains**: add the address your site is served from, for example `your-name.github.io`.
4. **Build, Firestore Database, Create database**: pick a location, start in production mode. On the **Rules** tab paste the rules below and **Publish**.
5. **Project settings** (gear), **Your apps**, web icon `</>`: register an app (skip Hosting). Copy `apiKey`, `authDomain`, `projectId` and `appId` into `js/config.js` and commit it.

### Rules

These work the same for Google and email accounts. They let each signed-in person read, write and delete only their own document, and only the settings KanjiLite syncs, each as a short text value. Anything else is refused.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Each setting is stored as { v: text or null, t: time in milliseconds }, up to `max` characters.
    function fieldOk(d, k, max) {
      return !(k in d) || (d[k].keys().hasOnly(['v', 't'])
        && d[k].t is number
        && (d[k].v == null || (d[k].v is string && d[k].v.size() <= max)));
    }

    function validDoc(doc) {
      return doc.keys().hasOnly(['data', 'updated'])
        && doc.updated == request.time
        && doc.data is map
        && doc.data.keys().hasOnly([
          'kl_plan', 'kl_plan_dismissed', 'kl_target_level', 'kl_pace_basis', 'kl_pace_custom', 'kl_rev_days',
          'kl_session_size', 'kl_lesson_batch', 'kl_b2b', 'kl_first', 'kl_show_level', 'kl_show_stage',
          'kl_srs_toast', 'kl_autoplay', 'kl_wrong_delay',
          'kl_guard', 'kl_guard_cap', 'kl_guard_gate'
        ])
        && fieldOk(doc.data, 'kl_plan', 2000)
        && fieldOk(doc.data, 'kl_rev_days', 20000)
        && fieldOk(doc.data, 'kl_plan_dismissed', 40)
        && fieldOk(doc.data, 'kl_target_level', 40)
        && fieldOk(doc.data, 'kl_pace_basis', 40)
        && fieldOk(doc.data, 'kl_pace_custom', 40)
        && fieldOk(doc.data, 'kl_session_size', 40)
        && fieldOk(doc.data, 'kl_lesson_batch', 40)
        && fieldOk(doc.data, 'kl_b2b', 40)
        && fieldOk(doc.data, 'kl_first', 40)
        && fieldOk(doc.data, 'kl_show_level', 40)
        && fieldOk(doc.data, 'kl_show_stage', 40)
        && fieldOk(doc.data, 'kl_srs_toast', 40)
        && fieldOk(doc.data, 'kl_autoplay', 40)
        && fieldOk(doc.data, 'kl_wrong_delay', 40)
        && fieldOk(doc.data, 'kl_guard', 40)
        && fieldOk(doc.data, 'kl_guard_cap', 40)
        && fieldOk(doc.data, 'kl_guard_gate', 40);
    }

    match /users/{uid} {
      allow read, delete: if request.auth != null && request.auth.uid == uid;
      allow create, update: if request.auth != null && request.auth.uid == uid
                            && validDoc(request.resource.data);
    }
  }
}
```

The Firebase console checks the rules when you publish and shows any error. If a future KanjiLite version syncs another setting, it has to be added to the list here and to `SYNCED` in `js/sync.js`. If you turn on `allowTokenSync`, also add `'kl_token'` to the list and `&& fieldOk(doc.data, 'kl_token', 200)`.

## Upgrading from a version without the workload guard

If you already set up sync before the workload guard existed, your published rules don't list its three settings (`kl_guard`, `kl_guard_cap`, `kl_guard_gate`), and Firestore refuses any write that includes a key the rules don't know. So **publish the rules above first, then deploy the new site files**. If you do it the other way round, syncing fails (Settings shows a sync error) until the rules are updated; nothing is lost, and the next sync after you publish them goes through.

To check: in the Firebase console open **Firestore Database, Rules**, make sure `'kl_guard', 'kl_guard_cap', 'kl_guard_gate'` are in the `hasOnly` list and the three `fieldOk` lines are present, then press **Publish**.

## Protecting it

If only you use it, the steps above are enough. If other people use your copy, add these. They are in order of value.

1. **Stay on the free Spark plan and never switch to Blaze.** Spark cannot bill you. If anyone floods the database, the worst outcome is that the daily free quota (about 50,000 reads and 20,000 writes) runs out and sync pauses until it resets; KanjiLite keeps working locally. Requests the rules refuse may also count towards that quota.
2. **Keep tokens out.** Leave `allowTokenSync` as `false`. Then your database holds only plans and settings, never anyone's WaniKani token, and the rules above do not even allow one.
3. **Turn on App Check.** It makes Firebase accept requests only from your site, which stops scripts and bots that call the database directly with the public config.
   - Register your site at <https://www.google.com/recaptcha/admin> as **reCAPTCHA v3** with your site's domain. Copy the site key and secret key.
   - Firebase console, **App Check, Apps**: register your web app with the reCAPTCHA provider and the secret key.
   - Put the site key in `appCheckSiteKey` in `js/config.js` and deploy. Check the App Check metrics for a day, then under **APIs** enforce it for **Cloud Firestore** and **Authentication**.
   - It is score-based and not a guarantee: a determined person with a real browser can still pass. Testing on `localhost` needs an App Check debug token (see Firebase's App Check docs).
4. **Invite only (the strongest option for a community).** Anyone with a Google account, or anyone who creates an email account, can otherwise sign in. To allow only people you approve, replace the two `allow` lines with these, listing their emails. Adding someone means editing the rules and publishing.
   ```
   function invited() {
     return request.auth != null && request.auth.token.email_verified == true
       && request.auth.token.email in ['friend@gmail.com', 'another@gmail.com'];
   }
   match /users/{uid} {
     allow read, delete: if invited() && request.auth.uid == uid;
     allow create, update: if invited() && request.auth.uid == uid && validDoc(request.resource.data);
   }
   ```
   (Put `invited()` next to `validDoc`, inside `match /databases/{database}/documents`.) The rule needs `email_verified`, so a person who signs up with an email and password has to click the link in the verification email Firebase sends them before the database accepts them. Settings shows a reminder, with a button to send it again, until they have.
5. **Restrict the API key to your site.** Google Cloud console, **APIs & Services, Credentials**, open the Firebase "Browser key", set **Application restrictions** to **Websites** and add your site's address (for example `https://your-name.github.io/*`). Leave the API restrictions as Firebase set them (it limits the key to Firebase's own APIs); make sure no other API, such as Gemini, is added to this key. This stops other websites from using your key, though a script that fakes the referrer is not stopped by it.
6. **Watch the Usage tab** in the Firestore console now and then. A sudden jump with few users is the sign to switch on invite-only.

## Good to know

- Each setting is synced separately and the most recent change wins. Daily review counts are merged, keeping the larger count for each day.
- Changes are sent a few seconds after you make them and when you leave the tab. Changes from another device arrive within moments through a live connection, and the page refreshes to show them. It waits if you are in the middle of a review or lesson, have a dialog open or are typing.
- Signing in with Google and signing in with an email address are separate accounts, even for the same address, and each has its own synced data. Someone who wants their plan on a new device signs in the same way they did before.
- With email accounts, people can create an account, sign in, and get a password-reset email from the sign-in form. Firebase sends those emails; you can reword them under **Authentication, Templates**. Passwords are handled entirely by Firebase Authentication and never reach your database. The minimum is 8 characters.
- Settings has **Delete my synced data**, which removes the person's document and stops syncing on that device. It does not delete the sign-in account itself; you can do that in **Authentication, Users** in the console.
- You, as the project owner, can see every document in the console. It holds plans and settings only (and tokens only if you enable that option).
- The values in `js/config.js` are not secrets; the rules above are what protect the data.
