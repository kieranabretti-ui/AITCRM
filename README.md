# A-IT Client Manager

Internal CRM for tracking A-IT's managed clients — packages, SLAs, review
cadence, activity log, and signed contracts. Separate app from the public
marketing site, with its own login (invite-only) and its own deploy.

The first person to sign in becomes the **owner** (superuser) and can
invite employees as **staff** from the Team page. There is no public
sign-up — accounts only exist via an owner's invite.

## Stack

- React + Vite + Tailwind (same tooling as the main site)
- [Supabase](https://supabase.com) for the database, auth, and file storage
- Netlify Functions for the two privileged actions (invite / remove a
  team member) that need a service-role key, which never reaches the browser

## One-time setup

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project. Free tier is
   plenty for this. Pick any region (EU West / London is closest to you).
2. Once it's created, open the **SQL Editor** and run the contents of
   [`supabase/schema.sql`](./supabase/schema.sql) in full. This creates:
   - `profiles`, `clients`, `client_activity`, `client_contracts` tables
   - Row-level security policies so only signed-in team members can read/write
   - A trigger so the *first* person who ever signs in is automatically
     made `owner`; everyone after that is `staff`
   - A private `contracts` storage bucket for signed-contract PDFs
3. In **Project Settings → API**, note down three values you'll need below:
   - **Project URL**
   - **anon / public key**
   - **service_role key** (click "reveal" — keep this one secret)
4. In **Authentication → URL Configuration**, once you know your deployed
   site's URL (step 3 below), set the **Site URL** to it, e.g.
   `https://crm.a-it.uk`. This is what invite emails link back to.

### 2. Create a Netlify site

This app lives in its own repo (`AITCRM`) and deploys as its own Netlify
site, fully separate from the main `aitmsp` marketing site — its own
domain, its own env vars, its own security headers.

1. Netlify → **Add new site** → Import an existing project → pick the
   `AITCRM` repo.
2. Build settings come from this repo's `netlify.toml` (build command
   `npm run build`, publish directory `dist`) — Netlify should detect
   them automatically.
3. Before the first deploy, add environment variables under **Site
   configuration → Environment variables**:

   | Key | Value | Notes |
   |---|---|---|
   | `VITE_SUPABASE_URL` | your Project URL | reaches the browser build |
   | `VITE_SUPABASE_ANON_KEY` | your anon/public key | reaches the browser build, safe to expose |
   | `SUPABASE_URL` | same Project URL | server-side only, used by the Netlify Functions |
   | `SUPABASE_SERVICE_ROLE_KEY` | your service_role key | **server-side only — never add a `VITE_` version of this** |
   | `SITE_URL` | this site's own URL once known, e.g. `https://crm.a-it.uk` | used to build the invite-email link |

4. Deploy. Once it's live, if you want a proper subdomain (e.g.
   `crm.a-it.uk`), add it under **Domain management** and point a CNAME
   at Netlify as usual — then update `SITE_URL` above and the Supabase
   Site URL from step 1.4 to match.

### 3. Create your own (owner) account

1. Since sign-up is invite-only and there's no one to invite you yet,
   create your first user directly in Supabase: **Authentication →
   Users → Add user**, enter your email and a password, and tick
   "Auto Confirm User".
2. Sign in at your deployed URL with that email/password. Because the
   `profiles` table is empty at this point, the schema's trigger makes
   you `owner` automatically.
3. From then on, invite employees yourself from the **Team** page in the
   app — they'll get an email with a link to set their own password.

## Local development

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

The invite/remove-user Netlify Functions only run on Netlify (or via
`netlify dev`), not under plain `vite dev` — team management needs to be
tested against the deployed site.

## Notes

- `noindex, nofollow` is set site-wide (`index.html` meta tag +
  `X-Robots-Tag` header in `netlify.toml`) since this is an internal tool.
- Signed contracts live in a **private** Supabase Storage bucket; the app
  reads them via short-lived signed URLs, never public links.
- Every table is locked down with row-level security — only authenticated
  team members (anyone with a `profiles` row) can read or write, checked
  server-side by Postgres itself, not just hidden in the UI.
