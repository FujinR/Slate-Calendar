# Slate 1.0

A small calendar site for two people on opposite schedules. It has:

- **Public page** (`index.html`) — no login needed. Anyone can see your weekly free/busy
  blocks and request a time slot.
- **Private dashboard** (`dashboard.html`) — login required. Edit your own weekly shifts
  and one-off exceptions, see a **combined view** of both your and your partner's free time
  (with a travel-time buffer subtracted), and approve/decline incoming requests.

It's a static site (works on GitHub Pages) backed by [Firebase](https://firebase.google.com)
(free tier) for accounts + data storage. There's no public sign-up — only the two accounts
you create manually can log in.

Right now the site runs in **demo mode** with sample data (you'll see a banner about it) —
that's expected until you complete the setup below.

## 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a new project (the free "Spark" plan is enough).
2. **Authentication** → get started → enable the **Email/Password** sign-in method.
3. **Authentication → Users → Add user** — create an account for yourself (email + password).
   Then add a second one for your partner. Copy down each account's **User UID** (shown in
   the users table) — you'll need yours in a minute.
4. **Firestore Database** → create database → start in **production mode** → pick any region.
5. In **Firestore Database → Rules**, replace the contents with everything in
   [`firestore.rules`](firestore.rules) from this repo, then click **Publish**.
6. **Project settings → General → Your apps** → click the `</>` (web) icon → register an app
   (no need for Firebase Hosting) → copy the `firebaseConfig` object it shows you.

## 2. Wire the config into the site

Open [`js/firebase-config.js`](js/firebase-config.js) and paste your `firebaseConfig` values
in place of the `YOUR_...` placeholders.

Open [`js/site-config.js`](js/site-config.js) and set `OWNER_UID` to **your** UID (the one
from Authentication → Users, step 3 above) — this determines whose schedule shows up on the
public page. Change `SITE_NAME` to whatever you'd like the page titled.

Once `firebase-config.js` has a real `apiKey`, demo mode turns off automatically.

## 3. Run it locally to check it

Because the site uses ES modules, opening `index.html` directly (`file://...`) will be
blocked by the browser. Serve it over local http instead, e.g.:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## 4. First-time setup inside the app

1. Go to `/login.html` and log in with your account.
2. **Settings tab**: set your display name, turn **on** "Make my schedule visible on the
   public calendar page", set **Partner's UID** to your partner's UID, and set the travel
   buffer (minutes) — this is subtracted from "both free" windows in the Combined View to
   account for travel time between you two.
3. **My Schedule tab**: click a free block on the timeline to add a shift, or a busy block to
   free it up — this is the fastest way in if your schedule rotates week to week. Use
   "Copy this week → next week" to carry forward anything that repeats. If part of your
   schedule genuinely repeats every week, you can add it once under the collapsed
   "Recurring pattern" section instead (check "ends next day" for overnight shifts there).
4. Have your partner log in with their account, go to **Settings**, set their partner UID to
   *your* UID, and add their own shifts the same way. They can leave "public" off — their
   calendar is only visible to whoever it's linked to, not to the public page.
5. **Combined View tab** now shows both schedules stacked plus a "Together" row highlighting
   real overlapping free time.
6. When someone submits a request on the public page, it shows up under the **Requests**
   tab for either of you to approve or decline. Approving adds it to your schedule as a
   busy block automatically.

## 5. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Initial calendar site"
```

Create a new (can be private) repo on GitHub, then:

```bash
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

In the GitHub repo: **Settings → Pages** → Source: **Deploy from a branch** → Branch:
**main**, folder **/(root)** → Save. After a minute your site is live at
`https://<you>.github.io/<repo>/`.

## Notes & limitations

- There's no password-reset UI — reset passwords from the Firebase console if needed.
- No email notifications for new requests yet — check the Requests tab when you visit.
- Assumes both of you are in the same timezone (times are stored as plain `HH:MM`, not
  timezone-aware).
- Anyone who guesses a request document ID can't read it — the `requests` collection is
  create-only for the public; only logged-in accounts can read/manage requests.
