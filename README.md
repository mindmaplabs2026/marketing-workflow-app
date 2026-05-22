# Marketing Workflow App

Internal workflow application for **Mindmap Labs** — replaces the chaotic WhatsApp loop between school clients and the agency's designer team with a single tracked pipeline.

**Production:** https://marketing-workflow-app-ht3l.vercel.app

---

## What it does

Schools (the agency's clients) submit creative requests — social posts, posters, newsletters. The agency's internal designers fulfill them. Both sides track status and approvals through the same app, replacing untracked WhatsApp threads with a structured pipeline.

The app ships as a **Progressive Web App (PWA)**. Users on Android or iOS open the URL in a browser and use "Add to Home Screen" to get an app-like icon and fullscreen experience — no App Store or Play Store dependency, no native build required.

### Asymmetric UX design (load-bearing decision)

- **School side** (school admins, teachers, decision makers) is intentionally light — magic-link sign-in, minimal taps, mobile-first. Every interaction must feel lighter than the WhatsApp it replaces.
- **Designer side** (internal team) is structured — dashboards, queues, filters. Designers can tolerate process because it saves them hours per week.

---

## User roles

| Role | What they do | Sign-in method |
|---|---|---|
| `super_admin` | Mindmap Labs leadership. Manages schools, designers, and all users. Full app access. | Password |
| `designer` | Internal designer. Sees the request queue, claims work, uploads designs. | Password |
| `school_admin` | School-side lead. Approves outgoing requests on behalf of the school. | Magic link |
| `teacher` | School-side contributor. Creates requests, uploads briefs and photos. | Magic link |
| `decision_maker` | School-side approver (e.g. principal). Approves final designs. | Magic link |

Internal users (`super_admin`, `designer`) set a password on first sign-in via `/setup-password`. School-side users skip this step — they receive a magic link and go straight in.

Login is invite-only: `/login` uses `shouldCreateUser:false`, so unknown emails are rejected with a clear message asking the user to contact a super admin. Super admins invite users at `/admin/users`.

---

## Core workflows

### Request lifecycle

```
draft
  → pending_admin_approval     (teacher submits)
  → approved                   (school admin OKs)
  → in_design                  (designer claims)
  → design_pending_approval    (designer uploads design)
  → changes_requested          (school sends back) ↺
  → published                  (final asset posted; URL recorded)
  → archived
```

### Calendar planning

Schools and designers plan upcoming content together. Calendar items can be linked to a request once it's created.

```
drafted → admin_approved → fulfilled
                         ↘ cancelled
```

### Notifications

Triple-channel delivery:

1. **In-app** — notification bell with unread count
2. **Web push** — using VAPID keys, even when the PWA is closed
3. **Email** — daily digest (default) or immediate, configurable per user (`off` / `daily` / `immediate`)

A one-tap quick-approve link in emails routes to `/api/quick-approve` for approvers who want to act without opening the app.

---

## Tech stack

- **Framework:** Next.js 16.2.6 (App Router, Turbopack, Server Actions)
- **Database & Auth:** Supabase (Postgres, Row-Level Security, magic-link + password auth)
- **Hosting:** Vercel
- **Email:** Resend (transactional, magic-link delivery, digests)
- **Push notifications:** `web-push` (VAPID)
- **Styling:** Tailwind CSS v4
- **Language:** TypeScript 5
- **Runtime:** Node.js 20+ recommended

> **Note on Next.js 16:** This is the latest Next.js — middleware is now called "proxy" (`src/proxy.ts`), and some APIs differ from older docs. See `AGENTS.md` and the in-repo guides under `node_modules/next/dist/docs/`.

---

## Project structure

```
marketing-workflow-app/
├── src/
│   ├── app/
│   │   ├── page.tsx                  Home (role-based landing)
│   │   ├── login/                    Magic-link sign-in (school)
│   │   ├── login/team/               Password sign-in (internal)
│   │   ├── setup-password/           First-time password setup (internal)
│   │   ├── auth/callback/            Magic-link callback handler
│   │   ├── admin/                    Super admin area
│   │   │   ├── pipeline/             All requests across all schools
│   │   │   ├── schools/              School list + detail + members
│   │   │   └── users/                User list + invite form
│   │   ├── requests/                 Request CRUD + lifecycle actions
│   │   │   ├── new/                  Create request
│   │   │   ├── [id]/                 View + upload design + publish
│   │   │   └── [id]/edit/            Edit + attachments
│   │   ├── calendar/                 Calendar planning views
│   │   ├── feed/                     Combined activity feed
│   │   ├── notifications/            Inbox + push toggle + email prefs
│   │   └── api/
│   │       ├── email/digest/         Cron-triggered daily digest
│   │       └── quick-approve/        One-tap approval from email link
│   ├── lib/
│   │   ├── supabase/                 Client / server / admin Supabase helpers
│   │   ├── email/                    Resend client + email dispatchers
│   │   └── push/                     Web push dispatchers
│   ├── components/                   Shared UI components
│   └── proxy.ts                      Next.js proxy (replaces middleware)
├── supabase/migrations/              SQL migrations (0001 → 0007)
├── scripts/                          Seed + utility scripts
├── public/                           Static assets, manifest, service worker
└── vercel.json                       Vercel config + cron schedules
```

---

## Database schema

Defined across 7 SQL migrations in `supabase/migrations/`:

| Migration | Purpose |
|---|---|
| `0001_initial_schema.sql` | Core tables: `schools`, `profiles`, `school_members`, `requests`, `request_uploads`, `designs`, `published_links` |
| `0002_rls_and_storage.sql` | Row-Level Security policies + Supabase Storage buckets |
| `0003_notifications.sql` | `notifications` table + triggers |
| `0004_push_subscriptions.sql` | Web push subscription storage |
| `0005_email_digest.sql` | Daily email digest support + prefs |
| `0006_calendar_feedback.sql` | `calendar_items` table + feedback flow |
| `0007_password_set.sql` | `profiles.password_set` flag for internal user setup |

Apply via the Supabase CLI:

```bash
supabase db push
```

Or paste each migration in order into the Supabase Dashboard SQL editor.

### TypeScript types

Hand-written types matching the schema live in `src/lib/supabase/types.ts`. Update them after any schema change. (Will switch to generated types via `supabase gen types typescript` once the Supabase CLI is wired in.)

---

## Local development

### Prerequisites

- Node.js 20+
- A Supabase project (free tier works)
- A Resend account (for email sending)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.local.example .env.local
# Then fill in the values — see "Environment variables" below.

# 3. Apply Supabase migrations
# Either via Supabase CLI:
supabase db push
# Or paste each file from supabase/migrations/ into the Supabase SQL editor in order.

# 4. Generate VAPID keys for web push (one-time)
node scripts/generate-vapid.mjs
# Copy the printed values into .env.local

# 5. Seed test users (optional, for local dev)
node scripts/seed.mjs

# 6. Run the dev server
npm run dev
```

Open http://localhost:3000.

---

## Environment variables

All variables live in `.env.local` (locally) and in Vercel project settings (production). A template is in `.env.local.example`.

### Required — Supabase

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key. Public — safe in client code. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key. **Secret, server-only.** Used for admin operations (creating users, bypassing RLS). |

### Required — App URL

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Full URL of the running app. `http://localhost:3000` locally; `https://your-app.vercel.app` in production. Used in magic-link redirects and email contents — **must match the actual host** or auth links break. |

### Required — Email (Resend)

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | Resend API key. **Secret.** |
| `EMAIL_FROM` | Sender address, e.g. `"Mindmap Workflow <noreply@yourdomain.com>"`. Sandbox `onboarding@resend.dev` only sends to your verified address until you verify a domain at resend.com/domains. |

### Required — Push notifications

Generate once with `node scripts/generate-vapid.mjs`:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Public VAPID key (sent to browsers) |
| `VAPID_PRIVATE_KEY` | Private VAPID key. **Secret.** |
| `VAPID_SUBJECT` | Contact mailto for push provider, e.g. `mailto:you@example.com` |

### Required — Cron

| Variable | Description |
|---|---|
| `CRON_SECRET` | Random secret protecting `/api/email/digest` from external invocation. Required by `vercel.json` cron. |

### Local development only — Test users

These match users created by `scripts/seed.mjs`. **Do not deploy these to production.**

```
TEST_SCHOOL_ADMIN_EMAIL=...
TEST_SCHOOL_ADMIN_PASSWORD=...
TEST_TEACHER_EMAIL=...
TEST_TEACHER_PASSWORD=...
TEST_DESIGNER_EMAIL=...
TEST_DESIGNER_PASSWORD=...
TEST_VIEWER_EMAIL=...
TEST_VIEWER_PASSWORD=...
```

---

## Scripts

### npm scripts

```bash
npm run dev      # Start dev server (Turbopack)
npm run build    # Production build
npm run start    # Run production build locally
npm run lint     # Run ESLint
```

### Utility scripts

```bash
node scripts/generate-vapid.mjs              # Generate VAPID keys for web push
node scripts/seed.mjs                        # Seed Test School + 4 test users
node scripts/change-school-admin-email.mjs   # Change a school admin's email
```

---

## Deployment

The app is deployed to Vercel and live at:

**https://marketing-workflow-app-ht3l.vercel.app**

### Initial deploy

1. Push to GitHub.
2. Import the repo on Vercel.
3. In Vercel project settings, add all production env vars (see "Environment variables" above). Do **not** include `TEST_*` vars in production.
4. Deploy.

### Subsequent deploys via CLI

```bash
vercel --prod --yes
```

(Or push to `main` if Git auto-deploys are enabled in Vercel.)

### Required post-deploy configuration

After the first deploy, configure Supabase to allow the Vercel URL:

1. **Supabase Dashboard → Authentication → URL Configuration**
2. **Site URL:** `https://your-vercel-url.vercel.app`
3. **Redirect URLs:** add `https://your-vercel-url.vercel.app/auth/callback` and `https://your-vercel-url.vercel.app/**`

Without this, magic links fail silently — Supabase rejects redirects to unconfigured URLs.

### Cron jobs

`vercel.json` defines a daily cron for the email digest:

```json
{
  "path": "/api/email/digest",
  "schedule": "30 2 * * *"
}
```

Runs at **02:30 UTC daily**. The endpoint requires the `CRON_SECRET` header to execute.

---

## Current status

| Area | Status |
|---|---|
| Database schema + RLS | Complete |
| Auth flows (magic link + password + invite + setup-password) | Complete |
| Request lifecycle (draft → published) | Complete |
| Calendar planning + feedback | Complete |
| Notifications (in-app + web push + email digest) | Complete |
| Super admin area (schools, users, pipeline) | Complete |
| PWA (manifest, service worker, Add to Home Screen) | Complete |
| Production deploy on Vercel | **Live** |
| Resend domain verification | **Pending** — invite emails only deliver to the verified Resend address until a Mindmap Labs domain is added |
| Custom Vercel domain | Pending — currently on default `*.vercel.app` URL |
| Pilot rollout to first school | Not started |

### Known limitations

- **Resend sandbox mode is active.** Until a domain is verified at resend.com/domains and `EMAIL_FROM` is updated, the app can only send emails to the verified Resend account address. Invites to any other address are blocked by Resend — the user still gets created in Supabase, but receives no email and cannot complete first-time sign-in until the domain is verified.
- **No custom domain yet.** Production is served from `marketing-workflow-app-ht3l.vercel.app` pending a Mindmap Labs decision on the production domain (e.g. `app.mindmaplabs.in`).

---

## Repositories

- **Primary (organization):** https://github.com/mindmaplabs2026/marketing-workflow-app
- **Personal mirror:** https://github.com/Abhishek99M/marketing-workflow-app

---

## Author

Abhishek Kumar — Mindmap Labs (`abhishek@mindmaplabs.in`)
