/* Optional: fill these in to turn on sync across devices (see SYNC.md for the setup).
   Leave them empty and KanjiLite works exactly as before, keeping everything in this browser.
   The Firebase values identify your project; they are not secrets (your data is protected by the
   Firestore rules from SYNC.md and by Google sign-in). */
window.KL_FIREBASE = {
  apiKey: 'AIzaSyBvymynplCv_wnMH5-uE_8ZofvSlmLdIhE',
  authDomain: 'kanjilite-f3be0.firebaseapp.com',
  projectId: 'kanjilite-f3be0',
  appId: '1:569694372369:web:3a42ec8d67fbf25a7967b0',

  // Recommended when other people use your copy: your reCAPTCHA v3 site key, which turns on Firebase App Check
  // so that only this site (not scripts and bots) can talk to your database. See "Protecting it" in SYNC.md.
  appCheckSiteKey: '',

  // Off by default. When true, each person gets a switch to store their WaniKani API token in your database.
  // Leave it off if other people use your copy: you would be holding their tokens.
  allowTokenSync: false,
};