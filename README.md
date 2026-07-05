# AdPulse — setup guide

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
2. Choose type **Business**, give it a name like "AdPulse".
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
   "AdPulse".
2. Go to **APIs & Services → OAuth consent screen**. Choose **External**,
   fill in the app name and your email, and save.
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth
   client ID**. Choose **Web application**. Under "Authorized redirect URIs"
   add:
   `https://YOUR-SITE.netlify.app/.netlify/functions/auth-google-callback`
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

## What's simplified for this first version (build these next as you get real customers)

- **Account picker**: if a customer manages multiple ad accounts, this
  version reads the first one only. Add a dropdown once you have your first
  real customer with multiple accounts.
- **Google Ads live numbers**: the OAuth connection works, but pulling live
  numbers needs the official Google Ads API client library and a selected
  customer ID — this is the next coding step, flagged clearly in
  `get-dashboard-data.js`.
- **Billing**: there's no payment wall yet. Add Stripe Checkout in front of
  `/dashboard.html` once you're ready to charge.
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
