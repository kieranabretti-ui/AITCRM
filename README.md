# A-IT Client Manager

Internal CRM for tracking A-IT's managed clients — packages, SLAs, review
cadence, activity log, signed contracts, and now a synced view of Jira
Service Management support tickets. Separate app from the public
marketing site, with its own login (invite-only) and its own deploy.

**Support desk integration**: Jira remains the source of truth for
ticket status and conversation history. This CRM keeps a synced summary
(via a Jira webhook) so support activity shows up on the right customer
record, plus a queue for the tickets Jira sends that couldn't be matched
to a client automatically. See [Support desk setup](#support-desk-jira-integration-setup)
below — this is a separate, later setup step from the base CRM below.

The first person to sign in becomes the **owner** (superuser) and can
invite employees as **staff** from the Team page. There is no public
sign-up — accounts only exist via an owner's invite.

## Stack

- React + Vite + Tailwind (same tooling as the main site)
- [Supabase](https://supabase.com) for the database, auth, and file storage
- Netlify Functions for the two privileged actions (invite / remove a
  team member) that need a service-role key, which never reaches the browser
- A Netlify Function receiving Jira Service Management webhooks to sync
  support tickets in (Jira stays the source of truth for ticket status
  and conversation — see [Support desk setup](#support-desk-jira-integration-setup))

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

## Support desk (Jira integration) setup

This is Phase 1 of the support-desk work: Jira tickets sync into a
`tickets` table, get matched to a client automatically where possible,
and show up on the client record and the new **Support** page. There's
no AI yet — classification, routing and automated responses are a later
phase, once you have a server-side Anthropic API key.

### 1. Apply the database migration

Your Supabase project already has the base schema from setup above. Add
the support-desk tables on top of it: open the **SQL Editor** and run
[`supabase/migrations/002_support_desk.sql`](./supabase/migrations/002_support_desk.sql)
in full. It only adds new tables (`tickets`, `client_email_domains`,
`jira_customer_mappings`, `webhook_events`) — nothing existing is
touched. (A brand-new install can skip this: `schema.sql` already
includes it.)

### 2. Add the new environment variables

In Netlify → **Site configuration → Environment variables**, alongside
the ones from setup above:

| Key | Value | Notes |
|---|---|---|
| `JIRA_BASE_URL` | e.g. `https://your-org.atlassian.net` | used to build "Open in Jira" links |
| `JIRA_WEBHOOK_SECRET` | any long random string you generate | shared secret Jira sends back on every webhook call — required before deploying |
| `JIRA_SERVICE_EMAIL` | *(optional for now)* the dedicated bot account's email, once you create one | stops the bot reacting to its own Jira writes — not needed until Phase 2, when the bot starts writing to Jira |

Redeploy (or trigger a new deploy) after adding these so the function picks them up.

### 3. Point Jira at the webhook

The webhook URL is:

```
https://crm.a-it.uk/.netlify/functions/jira-webhook?secret=<JIRA_WEBHOOK_SECRET>
```

Two ways to wire this up, depending on what access you have in Jira:

**Option A — Jira Automation (needs only project admin, recommended to start):**
1. In your JSM project → **Project settings → Automation → Create rule**.
2. Create one rule per trigger you want: **Issue created**, **Issue
   updated**, **Comment added** (three separate rules, or one rule with
   multiple triggers if your plan supports it).
3. Add a **Send web request** action: URL as above, method `POST`,
   Web request body → **Issue data (legacy)** (this is what makes the
   payload shape match — it mirrors the classic webhook JSON the
   function expects: `webhookEvent`, `issue`, `user`, `timestamp`).
4. Enable each rule.

**Option B — a real Jira webhook (needs Jira site-admin):**
1. Jira **Settings → System → WebHooks → Create a webhook**.
2. URL as above. Events: at least *Issue created*, *Issue updated*,
   *Comment created*. Optionally scope with a JQL filter to one project.

Either way, nothing needs to change in Jira beyond this — no custom
fields are required for Phase 1 (severity is read straight from Jira's
own Priority field; category and AI confidence are Phase 2 additions
once classification exists).

### 4. Backfill domains for better matching (optional)

Ticket matching checks, in order: the requester's email against a
client's contact email, then their email domain against
`client_email_domains`, then any previously-remembered mapping. The
domains table starts empty — add a row per client (`client_id`,
`domain`) for any customer whose staff email won't match the one
contact email on file, so their tickets match automatically instead of
landing in the unmatched queue. There's no UI for this yet; add rows
directly in the Supabase table editor.

Anything that doesn't match automatically shows up under **Support →
Review unmatched** — link it to the right client once, and every future
ticket from that same email matches on its own from then on.

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
