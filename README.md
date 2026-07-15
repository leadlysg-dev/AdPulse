# Leadly Pulse — setup guide

This is a working starting point for a self-serve Meta + Google Ads reporting
dashboard. Customers click "Connect", log in with their own Facebook/Google
account, and your dashboard pulls their numbers automatically. You never
handle their passwords or API keys by hand.

Follow these steps in order. Nothing here needs coding — it's account setup
and copy-pasting values into one file.

---

## Part 1 — Deploy the site (5 min)

1. Unzip this project.
2. Push it to a new GitHub repository (or drag the folder into Netlify's
   "Deploy manually" upload box at app.netlify.com/drop for a quick first test).
3. In Netlify: **Site settings → Build & deploy** — the build settings are
   already set in `netlify.toml`, so you don't need to change anything.
4. Note your live site URL, e.g. `https://adpulse-demo.netlify.app` — you'll
   need it in the next steps.

---

## Part 2 — Create your Meta (Facebook) app (15 min)

This is the one-time registration that represents *your product* to Facebook.
It is free.

1. Go to https://developers.facebook.com/apps and click **Create App**.
2. Choose type **Business**, give it a name like "Leadly Pulse".
3. In the app dashboard, click **Add Product** → find **Facebook Login** →
   **Set up**.
4. Go to **Facebook Login → Settings**. Under "Valid OAuth Redirect URIs" add:
   `https://YOUR-SITE.netlify.app/.netlify/functions/auth-meta-callback`
   (replace with your real Netlify URL from Part 1).
5. Go to **App Settings → Basic**. Copy the **App ID** and **App Secret** —
   you'll paste these into Netlify in Part 4.
6. Go to **App Review → Permissions and Features**, and request
   `ads_read` and `business_management`. While your app is in "Development
   Mode" you can test with your own ad accounts immediately; to onboard
   real customers you'll need to submit for **App Review** (Facebook checks
   that your app does what it says — usually a few days).

---

## Part 3 — Create your Google Ads API access (15–20 min)

1. Go to https://console.cloud.google.com and create a new project, e.g.
   "Leadly Pulse".
2. Go to **APIs & Services → OAuth consent screen**. Choose **External**,
   fill in the app name and your email, and save.
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth
   client ID**. Choose **Web application**. Under "Authorized redirect URIs"
   add both:
   `https://YOUR-SITE.netlify.app/.netlify/functions/auth-google-callback`
   (for connecting Google Ads accounts) and
   `https://YOUR-SITE.netlify.app/.netlify/functions/login-google-callback`
   (for the "Sign in with Google" button — same client, identity scopes
   only, no extra keys or env vars needed)
4. Copy the **Client ID** and **Client Secret** shown after creation.
5. Apply for a **Google Ads API developer token**: sign in to your Google
   Ads manager account (or create one, it's free) at ads.google.com, go to
   **Tools → API Center**, and apply for a token. Google reviews this
   (can take a few days for full "Basic" access; you get an instant "test"
   token for your own accounts while you wait).

---

## Part 4 — Add your keys to Netlify (5 min)

1. In Netlify: **Site settings → Environment variables**.
2. Add each of these (values from Parts 2 and 3):
   - `META_APP_ID`
   - `META_APP_SECRET`
   - `META_REDIRECT_URI` → `https://YOUR-SITE.netlify.app/.netlify/functions/auth-meta-callback`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` → `https://YOUR-SITE.netlify.app/.netlify/functions/auth-google-callback`
   - `GOOGLE_ADS_DEVELOPER_TOKEN`
   - `SESSION_SECRET` → any long random string
   - `SUPABASE_URL` → your Supabase project URL (Project Settings → API)
   - `SUPABASE_SECRET_KEY` → your Supabase secret/service key (never the
     public anon key)
   - `FAL_KEY` → your fal.ai API key (fal.ai → API Keys) — powers the
     Leadly Studio tab's image/video generation
   - `FAL_ADMIN_KEY` (optional) → an admin-scoped fal key so the Studio can
     show your remaining credit balance
   - `ANTHROPIC_API_KEY` → already used by PulseAI insights; the Studio's
     prompt writer reuses the same key
   - `STUDIO_MOCK=1` (optional) → dry-run the whole Studio tab without
     calling fal or Anthropic and without spending anything — useful for
     a first walkthrough

   Before the first deploy with Supabase, run `supabase-schema.sql` (repo
   root) once in the Supabase SQL editor to create the tables. If you
   created the tables before a migration file in `supabase-migrations/`
   existed, run that file too (each one is safe to re-run).

   If anything goes wrong with the database, set `STORAGE_BACKEND=blobs`
   to switch storage back to Netlify Blobs without a code change (Netlify
   redeploys automatically when you save the variable).
3. Redeploy the site (Netlify does this automatically after saving env vars,
   or trigger a manual redeploy).

---

## Part 5 — Test it

1. Open your live site and click **Connect Meta**. Log in with your own
   Facebook account that manages an ad account. You should land back on
   `/dashboard.html?connected=meta`.
2. The dashboard will show **live data** once at least one account is
   connected; before that it shows clearly-labelled **demo data** so it
   never looks broken or empty.

---

## How multiple customers and accounts are handled

- **Every customer has a real login** (email + password), not just a browser
  cookie. They can log in from any device and always land on their own data.
  Passwords are hashed, never stored in plain text.
- **One customer, multiple ad accounts**: if a customer manages more than one
  Meta or Google ad account, they're automatically sent to a picker screen
  after connecting, and choose which one you track. You (Kenneth) never have
  to touch this — it's self-serve.
- **Isolation between customers is enforced by the backend**: every function
  checks the logged-in customer's own session before returning any data, so
  customer A can never see customer B's numbers, regardless of what the
  interface shows.
- **Team members on one account**: not built into this version. The simplest
  way to add it later is letting a customer invite a teammate by email, and
  storing a small list of "allowed emails" on their account record instead of
  a single owner email.

## What's simplified for this first version (build these next as you get real customers)

- **Google Ads live numbers**: the OAuth connection and account picker both
  work, but pulling live spend/lead numbers needs the official Google Ads API
  client library layered on top — flagged clearly in `get-dashboard-data.js`.
- **Billing**: there's no payment wall yet. Add Stripe Checkout in front of
  `/dashboard.html` once you're ready to charge.
- **Password reset**: not built yet — if a customer forgets their password
  today, you'd need to manually help them. Worth adding before your first
  real customer.
- **Multiple industries**: nothing here is industry-specific — the same
  dashboard works for a dental clinic, a gym, or an insurance agent, which
  is exactly what makes this sellable across your client base.

---

## If something doesn't connect

- "Could not connect Meta account" usually means the redirect URI in your
  Meta app settings doesn't exactly match `META_REDIRECT_URI` (including
  `https://` and no trailing slash).
- Same idea for Google — the redirect URI must match exactly, character
  for character.
