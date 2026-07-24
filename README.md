# leadly-pulse-internal

Internal agency dashboard for presenting clients' **Meta Ads + Google Ads**
data, with AI insights and chat (Anthropic Claude). Single operator: you log
in, connect your own Meta and Google Ads credentials, and use the Pulse and
Campaigns tabs to review and present ad performance.

This is a stripped-down internal build of the Leadly Pulse SaaS. Removed:
billing/plans/upgrade, SEO + Google Business Profile tools, invites and
multi-tenant client sharing, alerts/automations, Studio (creative
generation), demo mode, audit log, and platform admin. Everything left is
unlocked.

## Stack

- Frontend: React + Vite (SPA in `src/`, routes in `src/main.jsx`)
- Backend: Netlify Functions (`netlify/functions/`)
- Storage: Supabase Postgres (or Netlify Blobs with `STORAGE_BACKEND=blobs`)
- AI: Anthropic API (Claude)

## Setup

1. **Supabase**: create a project and run `supabase-reset.sql` in the SQL
   editor (destructive - it rebuilds the schema from scratch; its header
   lists the tables removed from the SaaS schema). The
   `supabase-migrations/` files are only for upgrading a pre-existing
   Leadly Pulse database.
2. **Deploy** to Netlify (build settings are in `netlify.toml`), or run
   locally with `npm install && npm run dev` (Netlify CLI).
3. **Meta app**: at developers.facebook.com create a Business app with
   Facebook Login, redirect URI
   `https://YOUR-SITE/.netlify/functions/auth-meta-callback`, and the
   `ads_read` + `business_management` permissions (plus `ads_management`
   for budget/pause controls from the Campaigns tab).
4. **Google Cloud**: create an OAuth Web client with redirect URIs
   `https://YOUR-SITE/.netlify/functions/auth-google-callback` (connect
   Google Ads) and
   `https://YOUR-SITE/.netlify/functions/login-google-callback` ("Sign in
   with Google"). Apply for a Google Ads API developer token.
5. **First login**: open the site, click "Create the account" on the login
   page (restricted by `ALLOWED_LOGIN_EMAILS` if set), then connect Meta
   and Google Ads from Settings and pick the client ad account to report on.

## Environment variables (Netlify → Site settings → Environment variables)

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Long random string; signs the login session JWTs |
| `ALLOWED_LOGIN_EMAILS` | Optional comma-separated list; only these emails can create an account (recommended) |
| `META_APP_ID` / `META_APP_SECRET` | Meta app credentials (OAuth + Marketing API) |
| `META_REDIRECT_URI` | Optional override for the Meta OAuth callback URL |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client (Ads connect + Google sign-in) |
| `GOOGLE_REDIRECT_URI` | Optional override for the Google Ads OAuth callback URL |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API developer token |
| `ANTHROPIC_API_KEY` | Claude - powers the Pulse AI bar, suggested chips, and AI insights |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | Supabase project URL + service (secret) key |
| `STORAGE_BACKEND` | Optional; `blobs` switches storage to Netlify Blobs (`NETLIFY_SITE_ID` + `NETLIFY_BLOBS_TOKEN`) |
| `AI_MOCK` | Optional; `1` makes the AI endpoints answer with canned copy (no API calls) |
| `MANAGE_BUDGET_CEILING` | Optional; max daily budget (S$) the Campaigns tab will accept |

## Scripts

- `npm run dev` - local dev via Netlify CLI (frontend + functions)
- `npm run build` - production build to `dist/`
