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
- The [Claude API](https://console.anthropic.com) powering an AI service-desk
  copilot that re-analyses each ticket throughout its lifecycle (not just
  once on creation) — severity, category, routing, technical diagnosis,
  and low-risk auto-replies — server-side only, with a human-escalation
  fallback whenever it's disabled or unavailable

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

Jira tickets sync into a `tickets` table, get matched to a client
automatically where possible, and show up on the client record and the
**Support** page (Phase 1) — plus AI triage (severity, category,
routing, low-risk auto-replies, SLA escalation) once you've done the
Phase 2 steps below.

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

### 4. Phase 2 — turn on AI triage

Everything below is additive on top of Phase 1 — the ticket sync above
keeps working even if you skip this section entirely, or if Claude or
Jira is temporarily down (the bot just escalates for manual triage
instead of classifying).

**Apply the Phase 2 migration** — SQL Editor, run
[`supabase/migrations/003_ai_triage.sql`](./supabase/migrations/003_ai_triage.sql)
in full. Adds `settings` (admin-configurable knobs, with sane defaults
already seeded) and `ai_audit_log` (every AI decision, for review).

**Create a dedicated Jira service account** — don't reuse a human's
login. In Jira: invite a new user (e.g. `ai-bot@a-it.uk`) with access
to your JSM project, but no admin rights. Sign in as that account once,
then generate an API token for it: **Atlassian account settings →
Security → Create and manage API tokens → Create API token**.

**Get an Anthropic API key** — [console.anthropic.com](https://console.anthropic.com) →
Settings → API keys → Create key. This is separate from any Claude.ai
or Claude Code login; it's billed per use.

**Add the new environment variables** in Netlify, then redeploy:

| Key | Value | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic API key | server-side only, powers ticket classification |
| `JIRA_SERVICE_EMAIL` | the dedicated bot account's email | now required — also used for the loop-guard so the bot never reacts to its own writes |
| `JIRA_API_TOKEN` | the API token you generated for that account | lets the bot post comments and apply labels in Jira |

**Review the defaults** on the new **Bot settings** page (owner-only,
in the nav) — confidence thresholds, SLA warning window, routing per
category, and the escalation queue name. Sensible defaults are already
in place; tune them here rather than in the database. The **AI support
bot** switch at the top turns off all automated behaviour instantly
without touching Jira or the rest of the CRM.

**How it behaves**: on a new ticket, the bot classifies severity and
category, applies Jira labels, and — only at high confidence, for a
non-escalated ticket, with auto-replies enabled — posts a low-risk
acknowledgement as a **public** Jira comment. Every other AI note it
leaves is an **internal** comment (staff-only, never customer-visible).
P1 tickets, anything in the Security or Account & Access categories,
low-confidence classifications, and anything mentioning legal/
regulatory concerns always escalate to the queue above rather than
being handled automatically. A scheduled function (`sla-check`, every
15 minutes — needs a Netlify plan with Scheduled Functions) catches SLA
deadlines that would otherwise pass with no new Jira activity to
trigger a webhook.

The bot never takes destructive or high-risk actions itself (disabling
accounts, resetting MFA, changing security policy, deleting data, and
so on) — it has no code path to do any of that; the Jira client this
app uses only supports adding a comment or a label. Anything of that
kind is always a recommendation to a human, never an automated action.

### 5. Backfill domains for better matching (optional)

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

### 6. AI copilot (Phase 3) — continuous ticket analysis

Extends Phase 2's one-shot triage into an AI technical copilot that
stays with a ticket for its whole lifecycle, the way a second Level 2
technician looking over a colleague's shoulder would. No new
environment variables — it reuses everything from Phase 2
(`ANTHROPIC_API_KEY`, `JIRA_SERVICE_EMAIL`, `JIRA_API_TOKEN`). Just run
the migration:

**Apply the Phase 3 migration** — SQL Editor, run
[`supabase/migrations/004_ai_copilot.sql`](./supabase/migrations/004_ai_copilot.sql)
in full.

**What changed:**

- **It re-analyses, not just classifies.** Where Phase 2 only ran once
  on ticket creation, the copilot now re-evaluates a ticket whenever
  something meaningful happens: a customer reply, a technician comment,
  a status/priority/assignee change, or it newly crosses into SLA risk.
  A relevance check (`lib/relevance.js`) filters out trivial metadata
  churn first, and a material-change check inside `lib/copilot.js` stops
  it posting a new Jira comment when it would just be repeating itself —
  it still logs every pass to the audit log, it just doesn't spam Jira.
- **Its internal comments are structured technical analysis** — current
  understanding, likely cause, other possibilities, recommended next
  steps, evidence (explicitly marked known/suspected/not-yet-checked),
  confidence, risk, and an escalation recommendation (None / Technician
  / Senior Technician / Security Escalation) — always posted as an
  **internal** (staff-only) Jira comment, never customer-visible.
- **Severity and category now write back to Jira itself**, not just
  the CRM. Severity maps onto Jira's native **Priority** field
  (P1→Highest … P4→Low — the standard Jira Cloud scheme; a project with
  a custom priority set just has this one write silently no-op, logged
  in the function log, everything else keeps working). Category has no
  universal Jira field, so it's represented as a `category-…` label,
  swapped out for the new one whenever it changes rather than piling
  up. A technician's **Override severity/category** in the ticket
  drawer locks the field — the AI keeps analysing and keeps logging
  what it *would* set, it just stops writing to that field, in Jira or
  the CRM, until the lock is lifted ("Hand back to AI").
- **It responds to what a technician does**, not just to the customer.
  If a technician comments "I'm going to reset the user's password", the
  next analysis can flag a relevant check to do first; if they say
  they've already tried something, it suggests the logical next
  diagnostic step.
- **It draws on the domain checklists in its own system prompt**
  (`lib/aiTechnician.js`) — Outlook/M365/endpoint/backup/security — to
  recommend specific checks a technician can actually run, not generic
  advice. It has no access to Microsoft Graph, ESET, RMM, backup APIs,
  or any other live telemetry yet; `lib/copilot.js` is built so those
  can be added later as more context fed into the same analysis, without
  changing its output shape.
- **Suggested customer replies need approval by default.** A reply only
  auto-sends when it's high confidence, non-escalated, and the AI itself
  flags it as a purely safe acknowledgement/info-request. Anything else
  sits on the ticket as `ai_draft_reply` (status `pending`) until a
  technician clicks **Approve & send** in the ticket drawer — which
  posts it via the new `approve-draft-reply` function — or dismisses it.
- **Humans can override it, per ticket.** From the ticket drawer (open
  any ticket row from Support, Closed tickets, or a client's Support
  section): disable AI analysis for just that ticket, override its
  severity/category (locks it so the AI stops silently reclassifying
  it), request an immediate fresh analysis, and dismiss / mark
  incorrect / mark completed on any past recommendation. All of it is
  recorded in the audit log via the same `ai_audit_log` table Phase 2
  added, now also carrying the trigger event, the full structured
  analysis, and the human decision where there is one.

Nothing here changes the safety boundary from Phase 2: the bot still has
no code path to any destructive or high-risk action (account changes,
MFA, backups, security policy, DNS, firewall, and so on) — it can only
add a Jira comment, apply a label, or write to the columns above.
Anything of that kind is always a recommendation for a human, never
something it does itself.

### 7. Contract management, customer health score, and Sales (Phase 4)

Three additions, all in the same run:

**Apply the migrations** — SQL Editor, run
[`005_contracts.sql`](./supabase/migrations/005_contracts.sql),
[`006_health_score.sql`](./supabase/migrations/006_health_score.sql), and
[`007_sales_pipeline.sql`](./supabase/migrations/007_sales_pipeline.sql)
in full, in that order.

**Contract management** — each client now carries its own contract
terms (start/renewal date, notice period, annual value, services
included, annual price increase %, auto-renewal, and free-text SLA
terms) in the client drawer's new Contract section. The Dashboard gets
a **Contract renewals due** panel — active clients within 90 days of
`contract_renewal_date`, banded at 90/60/30 days and overdue, the same
pattern as the existing review-due panel.

**Customer health score** — a new scheduled function,
`health-score.js` (daily, 6am UK time — needs Scheduled Functions on
your Netlify plan, same as `sla-check`), scores every active client
0-100 from six signals: rising ticket volume, SLA breaches, security
incidents, backup failures, unresolved tickets, and contract renewal
proximity. This is a **deterministic weighted formula**
(`lib/healthScore.js`), not a per-client AI call — every input is an
objective count, so a rules-based score is instant, free, and fully
explainable: the client drawer shows exactly which factors deducted
how many points, never a black-box number. Bands: 80+ Healthy, 60-79
Watch, 40-59 At risk, under 40 Critical. The Dashboard's **At-risk
clients** panel lists anything below Watch, worst first.

**Sales pipeline with an AI assistant** — a new Sales page (nav: Sales)
with a Kanban-style board across New → Qualified → Proposal sent →
Negotiation → Won/Lost, backed by a `sales_opportunities` table (every
opportunity belongs to a client record — a brand-new prospect is just
a client created with status `lead`, so contact info lives in one
place). Opening an opportunity gives you a **Draft with AI** button:
pick a goal (initial outreach, follow-up, re-engagement, etc.) and
`sales-draft.js` calls Claude to write a subject/body/key-points draft,
grounded only in real data on the opportunity and A-IT's actual
published pricing (it's instructed never to invent a discount, a
timeline, or a fact about the prospect it hasn't been given). The
draft is never sent automatically — there's no email-sending
integration in this app, and outbound sales messages are exactly the
kind of thing that stays a human's call. Copy it and send it from your
own email client.

### 8. Clients page scoped to onboarding + active, with AI next-action suggestions

**Apply the migration** — SQL Editor, run
[`008_next_actions.sql`](./supabase/migrations/008_next_actions.sql) in full.

**The Clients page (`/`) now shows only onboarding and active clients** —
a lead isn't a client yet (it lives on the Sales page), and a paused or
churned one has moved to its own **Inactive** page (`/clients/inactive`,
nav: Inactive), so this list stays focused on who you're actively
managing. Onboarding clients are always pinned above active ones,
whatever sort order is selected — they're the smaller, more
time-sensitive group. A client added directly here (rather than
through a won opportunity) now defaults to status Onboarding instead
of Lead.

**Winning a Sales opportunity now promotes the client automatically** —
moving an opportunity to the Won stage flips its linked client from
Lead to Onboarding (and sets a start date, if none was set), so a won
deal shows up on the Clients page without a manual edit. See
`updateStage()` in `src/lib/salesApi.js`.

**AI suggested next action** — the same daily scheduled function that
computes the health score (`health-score.js`, now scoring onboarding
clients too, not just active) also works out the single most useful
next action for each one: "onboarding has been open 35 days, check
in," "health score critical, schedule a review call," "contract
renews in 12 days, start the conversation," and so on
(`lib/nextAction.js`). Same design choice as the health score and for
the same reasons — a deterministic rules engine over objective signals
(status, days, score, renewal window), not a per-client LLM call, so
it's instant, free, and its reasoning is always inspectable rather
than an opaque suggestion. Shown in the client drawer and as a column
on the Clients table.

### 9. Lead finder (Sales page → "Find leads")

**Get a free Companies House API key** —
[developer.company-information.service.gov.uk](https://developer.company-information.service.gov.uk),
sign in, **Your applications → Create new key** (client type: API key).
Add it to Netlify as `COMPANIES_HOUSE_API_KEY`.

**What this is, deliberately, and what it isn't:** this searches the
UK's official, free, structured Companies House register
(`lib/companiesHouse.js`) — it does **not** scrape any website. A
general-purpose scraper (company sites, Google/search-engine results,
LinkedIn) was the original ask, but isn't something this app builds:
most of it breaks the target sites' own terms of service (LinkedIn in
particular explicitly prohibits and actively pursues scraping), and
using scraped personal contact details for unsolicited marketing runs
into UK PECR/GDPR risk that would sit on A-IT's name, not a third
party's.

**What you get:** company name, registered office address, SIC
code(s), status, and incorporation date, for companies whose
registered office is in one of a preset list of Dorset-area towns
(Companies House matches by town/locality, not county — "Dorset"
itself usually isn't a locality value). Optionally narrowed by a
curated set of SIC codes for likely MSP prospects (accountants,
solicitors, medical/dental, architects, engineering, management
consultancy, and so on), or any custom SIC code.

**What you don't get, and never will from this source:** employee
count and named contact details. Companies House doesn't hold either —
it's a company register, not a marketing database. "Add as
opportunity" creates the client and a **New**-stage Sales opportunity
with the registered address on file and a clear note that contact
details need confirming before any outreach (the registered office is
also frequently not where a company actually trades — many use an
accountant's address). If you want verified employee counts and
compliant contact data, that's a job for a proper B2B data provider
(Apollo.io, ZoomInfo, Lusha, Cognism, Data8...) — ask if you'd like a
CSV importer built for one of those instead.

### 10. Website contact finder (opportunity drawer → "Find contact info")

No setup needed — no API key, nothing to configure. Given a company's
website URL (stored on the client record, editable there or inline in
the opportunity drawer), `website-contact-finder.js` fetches **that one
site only** — its homepage plus a couple of likely `/contact` or
`/about` pages, at most 3 requests — and pulls out whatever the
business has published itself: a general `mailto:`/`tel:` contact, or
a phrase like "20 employees" if their site happens to say so.

This is deliberately not the general scraper originally asked for.
The difference matters: it never touches LinkedIn, a search engine, or
any directory site (the sources that would actually have verified
employee counts, and the ones whose terms of service explicitly
prohibit exactly this); it checks `robots.txt` first and skips
anything disallowed; it identifies itself honestly in its User-Agent
rather than pretending to be a browser; and it only ever reads a
business's own public "how to reach us" page, once, on request — not
an unattended crawl. Results are best-effort and unverified by design
(no fabricated confidence) — always shown with a reminder to check
before use.

### 11. Auto lead enrichment (Sales → "Find leads" → "Add as opportunity")

No setup needed — reuses everything above, no new API key. Companies
House never gives a website, so when you add one of its results as an
opportunity, `enrich-lead.js` tries to fill that gap automatically:

1. **Guess a domain from the company name** (`lib/domainGuesser.js`) —
   strips the legal suffix ("Limited"/"Ltd"/"LLP"/...), builds a
   handful of plausible `.co.uk`/`.com` candidates from what's left,
   and fetches each one directly. This is still not the search-engine
   query that was floated earlier — it never asks Google/Bing/any
   third-party platform "what's their website"; it only ever fetches
   domains it constructed itself from the company name, the same way
   someone might type a guess into the address bar.
2. **Verify before trusting it** — a candidate only counts as a match
   if enough of the company's own name-words actually turn up on that
   page. No match found (common — plenty of real domains don't follow
   a guessable pattern) means it stops there and says so, rather than
   attaching a wrong site to the wrong company.
3. **If a domain matches**, it runs the same single-site contact
   lookup as #10 above against it, saves the website onto the new
   client record, and logs whatever it found (or didn't) as an
   activity note — clearly labelled as an **unverified guess to
   confirm**, never presented as a confirmed match.

Runs in the background right after "Add as opportunity" — shown as a
small status line under the company name in the results list
("Looking for their website…" → "Website + contact info found
(unverified)" or "No matching website found"). Never blocks adding the
lead, and a miss just means nothing gets added — it doesn't retry or
escalate to a broader search.

### 12. Sales guru (Sales page → "Ask your sales guru")

No setup needed — reuses the same `ANTHROPIC_API_KEY` as the "Draft
with AI" tool, no new key. A free-form chat (`sales-advisor.js` /
`lib/salesAdvisor.js`) for tactical sales advice — chasing a specific
prospect, objection handling, what to prioritise this week, how to
follow up after a proposal's gone quiet — the kind of thing you'd ask
an experienced sales lead, not a form to fill in.

**What it's grounded in:** every request, the function fetches the
live pipeline itself (stage counts and values, the opportunities
that have gone longest without an update) and gives that to Claude as
a compact snapshot — so its advice reflects what's actually on the
board, not generic platitudes. It does *not* have every field of every
opportunity in front of it; if you ask about a prospect that isn't in
the "stalest" list it surfaces, it says so rather than inventing a
history for them — paste in the relevant detail and it'll use it.

**What it isn't:** a replacement for the per-opportunity "Draft with
AI" tool (`lib/salesAssistant.js`) — that one has full context on one
specific prospect and writes a ready-to-send email via a structured
tool call. The guru is the opposite shape: broad strategic
conversation, plain text replies, no tool access, and it can never
write to or send anything — at most it'll suggest a line or two of
outreach copy inline and point you at the per-opportunity drafting
tool for the real thing.

**Nothing is persisted automatically.** The conversation lives only in
the browser tab for that session — closing the panel or reloading the
page clears it, and there's no chat-history table.

**Save to a lead — the one deliberate exception.** Any individual
reply has a "Save to a lead…" link under it, and there's a "Save
conversation to a lead" option in the panel header for the whole
thread — both open a picker of your open opportunities and, on
confirm, write the reply (or the full transcript) into that client's
activity log via the same `addActivity` used everywhere else in the
app, clearly labelled as coming from the sales guru chat with a
timestamp. Nothing is ever saved without picking a lead and confirming
it yourself.

### 13. Dorset IT Support landing page → lead intake (`dorset-lead-webhook.js`)

Bridges the aitmsp marketing site's `/dorset-it-support` Google Ads
landing page form into this CRM: every real submission becomes a
client (`status: lead`, `lead_source: google_ads`) plus a matching
`sales_opportunities` row (`stage: new`), so it shows up on the Sales
pipeline exactly like a lead added manually or via the Companies House
finder. No new tables or migration needed — it writes through the
existing `clients`/`sales_opportunities` schema.

This has to be a genuinely public endpoint (called server-to-server,
not by a signed-in team member), so it can't use the normal
session-based auth every other write in this app requires. It uses a
shared secret instead — same pattern as `jira-webhook.js`.

**Primary path: direct relay, not a Netlify Forms webhook.** The
aitmsp site's landing page form calls its own `relay-lead.js` Netlify
Function at submit time, which then calls this endpoint
server-to-server with the shared secret attached. This replaced an
earlier design that depended on Netlify Forms' "Outgoing webhook"
notification (dashboard-only config, no config-as-code option) —
that path turned out to have two failure modes invisible from outside
the Netlify dashboard: whether the notification was actually
configured correctly, and whether Netlify's own automatic spam
classifier silently dropped a real submission before the webhook ever
fired. The relay removes both, since it's ordinary code in the aitmsp
repo rather than dashboard configuration. This function still accepts
the old Netlify-Forms-wrapped payload shape too (see `extractLeadData`
in the source), so re-adding that webhook notification later — e.g. as
a belt-and-braces backup — would still work with no changes here.

**Setup:**

1. Add the environment variable in Netlify → **Site configuration →
   Environment variables**:

   | Key | Value | Notes |
   |---|---|---|
   | `DORSET_LEAD_WEBHOOK_SECRET` | any long random string you generate | shared secret checked on every incoming request |

   Redeploy after adding it.

2. **Set the exact same secret value on the aitmsp site too** —
   Netlify → the aitmsp site → **Site configuration → Environment
   variables** → `DORSET_LEAD_WEBHOOK_SECRET` (same key, same value).
   That's what `relay-lead.js` over there attaches to its
   server-to-server call here. Redeploy the aitmsp site after adding
   it. Without this step the relay returns a 500 and no leads arrive,
   even though this side is fully configured.

**Known limitation:** there's no dedup table for this (unlike the Jira
webhook, which has one keyed by Jira's own event id) — a retried
delivery (which only happens if this function returns a 5xx) could
create a duplicate lead. Low-likelihood and low-cost if it does
happen — a duplicate is just an extra card on the Sales board to merge
or delete — so this was left out of scope for now rather than adding a
table for it.

If leads aren't showing up after setup, set `DEBUG_WEBHOOK=1` on this
function in Netlify and check its logs (Netlify → this site →
Functions → dorset-lead-webhook → Logs) next time the form is
submitted — it logs the payload's shape (field names only, never lead
content) so a mismatch between what's actually sent and what this
function expects shows up immediately instead of silently dropping
submissions. Also worth checking aitmsp's own `relay-lead` function
logs (Netlify → aitmsp site → Functions → relay-lead → Logs) — a
missing/mismatched secret or a network failure reaching this CRM
site would show up there instead.

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
