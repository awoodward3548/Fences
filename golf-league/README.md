# Golf League Scoreboard

A phone-friendly scoreboard for the 14-team indoor golf simulator league. Players pick their team, type a 4-digit PIN, tap + / − for 12 holes, review the card and submit. Everyone sees the same live leaderboard, scorecards, season standings, the Final and a public change log.

- **Website:** plain HTML/CSS/JavaScript with no build step. It's hosted free on **Netlify**.
- **Database:** **Supabase** (free tier). All saving goes through database functions that check PINs, so a card can't be changed by tampering with the page. PINs are stored as bcrypt hashes, never as typed.
- **Scoring math:** all of it is in `scoring.js`, with tests in `tests/scoring.test.js`.

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The website |
| `scoring.js` | Every scoring rule (strokes, Double Maxx, sections, payouts, points, ties, final) |
| `api.js` | Talks to the database (or to a built-in demo when `config.js` is blank) |
| `config.js` | The only file you edit: your Supabase address and key |
| `supabase/setup.sql` | Creates the database, security rules and the 14 teams |
| `tests/scoring.test.js` | Scoring tests (`npm test`, needs Node.js; optional) |

---

## 1. Try it on your computer (2 minutes, no accounts)

1. Unzip the `golf-league` folder anywhere, for example your Desktop.
2. Double-click **`index.html`**. It opens in your web browser in **DEMO** mode, with some sample scores already in.
3. To see the phone layout, make the browser window narrow. In Chrome you can also press F12 and click the phone icon.
4. Things to try:
   - **Enter our score** → pick a team → PIN **1234** → tap + / − → Review → Submit. Then try entering the same team again: you'll see the locked card.
   - **More → League admin** → PIN **0000** → *Set up this week*, *Scores & fixes*, *Teams & PINs*, *Rules & settings*, *Download spreadsheet*.
   - **More → Reset demo data** starts the demo over.

Demo data lives only in that browser. Nobody else sees it.

---

## 2. Put it online for free (about 20 minutes, one time)

### A. Create the database (Supabase)

1. Go to **https://supabase.com** and click **Start your project**. Sign up with your email (or GitHub) and confirm the email.
2. Click **New project**:
   - **Organization:** the one it made for you (free).
   - **Project name:** `golf-league`.
   - **Database password:** click **Generate a password** and save it somewhere. You won't need it day to day.
   - **Region:** the one closest to you.
   - Click **Create new project** and wait 1–2 minutes until it's ready.
3. In the left sidebar click **SQL Editor** (the `>_` icon), then **New query** (or the **+**).
4. On your computer, open `golf-league/supabase/setup.sql` in Notepad (Windows) or TextEdit (Mac). Select all, copy, and paste it into the Supabase query box.
5. Click **Run** (bottom right). If Supabase warns about the query, click **Run this query**. You should see **"Success. No rows returned"**.
6. Get your two connection values. Click **Connect** at the top of the project page, or go to **Project Settings** (gear icon) → **API Keys** / **Data API**:
   - **Project URL**: looks like `https://abcdefghijk.supabase.co`
   - **Publishable key** (starts with `sb_publishable_`) or the **anon public** key (a long code starting with `eyJ`).
   - ⚠️ Do **not** use the *secret* or *service_role* key.
7. Open `golf-league/config.js` in Notepad or TextEdit. On a Mac, first choose **Format → Make Plain Text**. Paste the two values between the quotes:
   ```js
   supabaseUrl: 'https://abcdefghijk.supabase.co',
   supabaseKey: 'sb_publishable_xxxxxxxxxxxxxxxx'
   ```
   Save the file.
8. Double-click `index.html` again. The **DEMO** badge should be gone and the page should say *"Waiting for the admin to set this week's course."* That means it's connected.

### B. Put the website online (Netlify)

1. Go to **https://app.netlify.com/signup** and sign up (email or GitHub).
2. On your Netlify dashboard, click **Add new project** (some accounts say **Add new site**) → **Deploy manually**.
3. Drag the whole **`golf-league` folder** onto the box that says *drag and drop your project folder here*.
4. After a few seconds you get a web address like `https://silly-name-12345.netlify.app`. Click it to check it works.
5. To get a nicer address: **Project configuration** (or **Site configuration**) → **Change project name** → type e.g. `simgolf-league`. Your link becomes **`https://simgolf-league.netlify.app`**.
6. **Before sharing the link, set your admin PIN** (section 3 below).
7. Share that one link with the league. Tip for players: open it on the phone and choose **Add to Home Screen**.

**If you ever change a file** (for example `config.js`): open your project on Netlify → **Deploys** → drag the `golf-league` folder onto the deploy box again. Same link, new version.

**Free-tier note:** Supabase pauses free projects after about a week with no visits. If the site says it can't reach the scoreboard after a long break, log in to Supabase, open the project and click **Restore**. No data is lost.

---

## 3. PINs

### Admin PIN (do this first, right after going online)
1. Open your link → **More** → **League admin**.
2. The first time, it asks you to **create the admin PIN** (4–8 digits). Type it twice and tap **Set admin PIN**. From then on, only that PIN gets into the admin pages.
3. When you log in, type **your name** too. It goes into the public change log next to every fix you make.
4. To change it later: **League admin → Change admin PIN**.
5. **Forgot it?** In Supabase → SQL Editor, run `update league set admin_pin_hash = null;`. Then open **League admin** on the site and create a new one.

### Team PINs
- **Fastest:** **League admin → Teams & PINs → Make new random PINs for every team**. A list of 14 PINs appears **once**. Screenshot it or write it down, then text each team their own PIN.
- **One team at a time** (e.g. a team forgot theirs): **Teams & PINs** → tap the team → type a new 4-digit PIN → **Set PIN**.
- Teams can't enter scores until they have a PIN.
- After 8 wrong PIN tries in 10 minutes, that team (or the admin login) has to wait 10 minutes.

---

## 4. Your weekly routine (about 3 minutes on your phone)

**Before league night, once you know the course:**
1. Open the link → **More → League admin** → log in.
2. Tap the big **⛳ Set up this week** button.
3. **Course name:** type it, e.g. *Pebble Beach*.
4. **Holes 1–12:** tap the **par** (3 / 4 / 5) and type the **stroke index** (the "handicap" row on the course scorecard, 1 = hardest). 18-hole numbers are fine; the app ranks the 12 holes from hardest to easiest itself.
5. Only if a tee box plays a different par on some hole this week: open **"A tee box plays a different par this week?"** and fill in just those holes.
6. **Handicaps & tees:** these are already filled in from last week. Tap **+ / −** for any team whose handicap moved. Leave **Both on the same tee** ticked, or untick it to pick each player's tee.
7. Tap **✓ Save & open for scores**. Teams can now enter scores. Until you do this, the home page says *"Waiting for the admin to set this week's course."*

**After league night:**
1. **League admin → Scores & fixes** shows who is in and who isn't.
2. If a team can't enter their score, tap the team, set the scores, and tap **Save these scores**.
3. If a team didn't play, tap the team → **Mark as not playing**. They get 0 points and no payout.
4. If a card has a mistake, tap the team, fix the holes, type a **reason**, and tap **Save these scores**. Or tap **Unlock for the team** so they can re-enter it themselves.
5. If you made a mistake in the course or handicaps, open **Weekly setup** for that week, fix it, type a reason, and save. Everyone's results recalculate.

Every fix shows in **More → Change log** for the whole league: who, when, old → new, and why.

**Other admin screens:** **Schedule** (dates and the Final), **Teams & PINs**, **Tee boxes**, **Rules & settings** (Double Maxx, payouts, points, tiebreaks, starting strokes, prizes), **Download spreadsheet** (CSV for Excel or Google Sheets).

---

## For developers

- Run the tests: `npm test` (Node 18+). There are 24 scoring tests, including ties, handicaps over 12, 0 handicap, Double Maxx and missed weeks.
- `supabase/setup.sql` can be run again safely. It never deletes scores, and it only adds teams and weeks when those tables are empty.
- Security: every table has row-level security turned on and no grants to `anon`. The browser can only call the `security definer` functions, which check the team or admin PIN (bcrypt via pgcrypto), validate scores, refuse to change a submitted card, require a reason for admin corrections, and write the change log.
