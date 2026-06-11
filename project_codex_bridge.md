# Codex Poster Bridge — Clarity Document (Revised)

**Date:** 2026-06-09 (supersedes the 2026-06-08 draft)
**Project:** marketing-workflow-app (`C:\Loop\marketing-workflow-app`)
**Scope:** Architecture clarity / brainstorm output. No code edits. No migration plan yet.
**Why revised:** The first draft was wrong on the core idea. It assumed we *skip* the AI agents, use a *fixed asset rule*, and that the driver was *control*. After manager review and a code re-read, the correct intent is: **keep all 5 agents exactly as built, change only the engine they run on (Codex subscription instead of the OpenAI API key), to cut cost.**

---

## 1. The Real Goal

Run the **existing 5-agent poster pipeline unchanged**, but execute it on **our own always-on server through Codex CLI signed in with a ChatGPT subscription**, instead of on Vercel through the metered OpenAI API key — so image generation is paid for by the flat subscription rather than per-image API billing. **The app, the agents, the user flow, the review/redesign loop, and the UI all stay the same.**

---

## 2. Driver — COST (corrected)

- The driver is **cost**, not control.
- The old `cost-report.md` §8 said Codex would not help because it assumed *Codex + OpenAI API key = same bill.* **That assumption is outdated.**
- **Verified (2026-06-09):** Codex CLI has built-in image generation on **gpt-image-2** (the same model the app uses). When signed in with a **ChatGPT subscription (Plus/Pro/etc.)**, image generation is **included in the subscription with no API key and no per-image charge** — it draws from plan usage limits instead.
- **Honest limits (must stay in the doc):**
  1. Not unlimited — image turns **burn subscription usage limits ~3–5× faster** than text; past the limit you spend **credits** (paid). So it's "flat-fee up to a ceiling," not "free forever."
  2. **Quality still to be proven by test** — our posters depend on *image edits with multiple reference images* (copy logo/header/footer exactly + photos as-is). Codex's image tool supports "edit," but we must run a 1-poster test to confirm brand-asset fidelity matches the raw API before trusting it.

*Sources: [Codex Pricing – OpenAI](https://developers.openai.com/codex/pricing), [Using Codex with your ChatGPT plan – OpenAI Help](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan), [Codex CLI image generation (gpt-image-2)](https://codex.danielvaughan.com/2026/04/27/codex-cli-image-generation-gpt-image-2-visual-development-workflows/)*

---

## 3. The 5 Agents — KEPT, NOT SKIPPED

All five stages stay, with the same roles and logic. The **only** change is *which engine the model calls go through.*

| Agent | File | Job | Call type | Today | After |
|---|---|---|---|---|---|
| 1 — Understanding | `agent-understanding.ts` | Curate/shortlist uploaded photos, theme/tone | text/vision | OpenAI API | Codex (subscription) |
| 2 — Creative + **asset picking** | `agent-creative.ts` | Direction + **chooses which brand assets each variation uses (`selectedAssets`)** | text/vision + web_search | OpenAI API | Codex (subscription) |
| 3 — Generation | `agent-generation.ts:417/443` | Render the poster | **IMAGE (gpt-image-2)** | OpenAI API | **Codex image tool (subscription)** |
| 4 — Evaluate | `agent-generation.ts:91` | Score 1–10 vs references | text/vision | OpenAI API | Codex (subscription) |
| 5 — Refine | `agent-generation.ts:714/730` | Re-render low-scoring page | **IMAGE (gpt-image-2)** | OpenAI API | **Codex image tool (subscription)** |

**Asset selection stays with Agent 2 — there is NO fixed rule.** Agent 2 looks at the brand assets and outputs `selectedAssets` (logo/header/footer/uniform/infrastructure/samples, with `null` to skip), and Agent 3 consumes exactly those (`agent-generation.ts:173-242`). This behaviour is unchanged.

**Single seam:** the OpenAI client is created in one place — `openai-client.ts:12` (`new OpenAI({ apiKey })`) — and every agent imports `getOpenAI()`. That's the natural place to re-point model calls. ⚠️ Note: Codex's interface is **not** a drop-in for the OpenAI SDK (it's an agent/skill, not `chat.completions`/`images.edit`), so this is more than a one-line base-URL swap — re-expressing each agent's structured/vision/web_search/image calls under Codex is the main implementation work and a key risk to verify.

---

## 4. Where the Pipeline Runs — Vercel App + Our Own Server

The app stays on **Vercel** (serverless, disposable — it cannot run Codex or hold a ChatGPT login). The 5-agent pipeline moves to **our own always-on server**, where Codex is installed and signed in.

### Dispatch = PULL (chosen)
The app and the server are two different machines. They connect via a **pull** model:

```
Designer clicks the EXISTING "Generate with AI" button
        ⬇
App (Vercel) just writes a job row  → ai_generation_jobs (status: queued)   [unchanged code path]
        ⬇
Our server is always watching: "any queued jobs?"  → claims the job
        ⬇
Server downloads the needed assets from Supabase (fresh, just-in-time)
        ⬇
Runs the 5 agents via Codex (subscription) → renders poster(s)
        ⬇
Uploads results to the designs bucket + writes ai_variations rows
        ⬇
Marks job completed  → DELETES the local asset copies
        ⬇
App shows the posters in the EXISTING review UI (ai-variations.tsx)
```

**Why PULL (not push):** the server only makes **outgoing** calls to Supabase, so it never has to be exposed to the internet — no tunnels, no router/firewall changes, no extra attack surface. Simplest and safest.

### Hosting options (senior-dev note)
"Local server" = any always-on machine we own and control (NOT Vercel). Two ways to provide it:

| | Local always-on machine (manager's wording) | VPS (rented cloud server) |
|---|---|---|
| Cost | Free if we already have it | ~$5–20/month |
| Reliability | ⚠️ risk: sleep / power cut / Wi-Fi drop stalls jobs | ✅ always on |
| Codex/ChatGPT login | ✅ easy (browser on desktop) | ⚠️ slightly fiddly (headless login) |

**Recommendation:** start on the **local always-on machine** (default — matches the requirement, easiest login, no cost). Document **VPS as the reliability upgrade** for production. ⚠️ Hard requirement either way: the machine must be **genuinely always on — never a laptop that sleeps**, or jobs silently pile up.

---

## 5. Assets — Download to Local, Delete After

- Input collection is **unchanged**: teachers upload photos; school admins' brand assets sit in the school library (Supabase).
- When the server claims a job, it **downloads just-in-time** the request's photos + the brand assets Agent 2 will choose from (lookup by request → `school_id`, the same context `fetchContext` builds today).
- After the poster is generated and uploaded back, the **local asset copies are deleted** — nothing lingers on the server.
- ⚠️ Existing-endpoint note: `/api/assets/download` currently pulls `request-uploads` + `designs` only — **not** the `school-assets` bucket. The server's download step must also reach brand assets (or read them directly from Supabase like the pipeline does today).

---

## 6. Output, Review & Redesign — EXISTING FLOW (corrected)

Generation output is **not** uploaded via the "Upload Design" screen. It uses the AI review flow that already exists:

- Finished variations appear in **`ai-variations.tsx`** for the designer to review (signed URLs from the designs bucket).
- **Not good?** Designer redesigns using the existing tools — **chat edit** (`/api/ai/chat` → `ai-chat.ts`) or **`regenerateAi`** — exactly as today.
- **Good?** Designer clicks **Accept** (`acceptAiVariation`) → copies the variation into the `designs` table → status → `design_pending_approval` → school admin reviews → **published**.

---

## 7. End-to-End Flow (one poster, full picture)

```
STAGE 1 — REQUEST  (in app, unchanged)
   Teacher fills form: title + description + photos
        → saved to requests + request_uploads (Supabase)
        → status: pending_admin_approval
   School admin APPROVES → status: approved → in_design
   🔔 Designer notified ("New request to design")   [existing push/FCM]

STAGE 2 — TRIGGER  (designer, ONE click, existing button)
   Designer (own device/phone) clicks "Generate with AI"
        → triggerAiGeneration() writes ai_generation_jobs (status: queued)
   App's part is done. No Codex on Vercel — just a queued job.
   [Guard #1: designer only clicked, no terminal ever]

STAGE 3 — OUR SERVER PICKS IT UP  (PULL — the new piece)
   Always-on server keeps asking DB: "any queued jobs?"
        → claims the job
        → downloads FRESH from Supabase (just-in-time):
              • teacher's photos
              • school's brand assets
   [Guard #2: fresh every time, no stale files]

STAGE 4 — THE 5 AGENTS RUN  (via Codex subscription, no API key)
   Agent 1  Understanding  → curate photos, theme/tone      (Codex)
   Agent 2  Creative       → direction + PICKS which assets (Codex)
   Agent 3  Generation     → render poster      [IMAGE via Codex]
   Agent 4  Evaluate       → score 1–10 vs references       (Codex)
   Agent 5  Refine (if <7) → re-render worst page [IMAGE via Codex]
        → uploads poster(s) to designs bucket + writes ai_variations
        → marks job completed → DELETES local asset copies
   [Guard #3: ai_generation_jobs + generation_log = traceable]

STAGE 5 — REVIEW & REDESIGN  (existing UI, unchanged)
   🔔 "AI posters ready" → shown in ai-variations.tsx
   Designer reviews:
        • Not good → Chat & Edit / Regenerate  (loops back to review)
        • Good     → Accept (acceptAiVariation)
                     → copies variation into designs table
                     → status: design_pending_approval

STAGE 6 — FINAL APPROVAL  (existing flow, unchanged)
   🔔 School admin: "Design ready to review"
        • Approve         → status: PUBLISHED  🎉
        • Request changes → back to designer (Stage 5)
```

**What is actually new vs today (only 2 spots):**
1. **Stage 3** — a server that *pulls* queued jobs (instead of Inngest running them on Vercel).
2. **Stage 4** — the agents call **Codex (subscription)** instead of the **OpenAI API key**.

Everything in Stages 1, 2, 5, and 6 is the current app, untouched.

---

## 8. Failure Modes (Anti-Goals)

1. **No manual terminal step for the designer.** The designer only clicks the **existing button**; Codex runs invisibly on the server. (Pull model makes this automatic.)
2. **No stale assets.** The server downloads assets **fresh at job time** and deletes them after, so an old local copy can't be reused by mistake.
3. **Full traceability.** Each poster is already traceable via `ai_generation_jobs` + `ai_variations.creative_brief._generation_log` + the `designs.notes` stamp. Add to the generation log that it ran via **Codex on the server** (and which job), so any published poster is traceable later.

---

## 9. Critical Constraints

- **Keep all 5 agents and their logic intact** — same curation, direction, asset selection, evaluation, refinement. Only the model engine changes.
- **The in-app flow, review UI, redesign loop, DB schema, and statuses are unchanged.**
- The **designer works from their own device/phone**, gets the existing approval notification, and triggers generation with the existing button.
- **Codex runs on an always-on machine we control** (local or VPS), signed in with a ChatGPT subscription; the app stays on Vercel.
- Treat the **OpenAI-API-key → Codex-subscription** switch as removing the per-image API cost, **bounded by subscription usage limits** (credits beyond).

---

## 10. Open Risks to Verify Before Building

1. **Image-edit fidelity** — confirm by a 1-poster test that Codex's image edit copies logo/header/footer + photos as faithfully as the current `images.edit` API.
2. **Re-expressing agents under Codex** — the structured JSON outputs, vision inputs, and Agent 2's `web_search` must be reproduced under Codex's interface (not a drop-in SDK swap).
3. **Subscription limits** — confirm a realistic day of single + carousel generation stays within the chosen plan's limits before credits kick in.
4. **Codex/ChatGPT automated, server-side, 24/7 usage** — confirm this fits the subscription's intended use.

---

## 11. Existing Architecture Reference (current state)

- **Trigger:** `ai-generate-button.tsx` → `triggerAiGeneration` (`requests/actions.ts:746`) → creates `ai_generation_jobs` (status `queued`) → Inngest event `ai/pipeline.started`.
- **Pipeline today:** 5 Inngest functions in `src/lib/inngest/functions/ai-pipeline.ts`, agents in `src/lib/ai/`, all calling OpenAI via `openai-client.ts:12`.
- **Review/redesign:** `ai-variations.tsx`, chat edit `/api/ai/chat` + `ai-chat.ts`, `regenerateAi`, `acceptAiVariation` → `designs` → `design_pending_approval`.
- **Storage:** Supabase private buckets `request-uploads`, `designs`, `school-assets`; paths in `request_uploads`, `designs`, `school_brand_assets`, `ai_variations.storage_paths[]`.
- **Notifications:** DB triggers + `dispatchPendingPushes()` (web push + FCM) on approval / AI-completed.

---

## 12. Status

- Corrected understanding locked: **keep 5 agents, switch engine to Codex-on-subscription, run on our own server, cost-driven.**
- Decisions made: **PULL dispatch**; **local always-on machine default, VPS as upgrade**; **Agent 2 keeps asset selection (no fixed rule)**; **existing review/redesign flow**.
- **NOT yet done:** the verification tests (§9) and the step-by-step build/migration plan. No code written.

---

*End of revised clarity document. No code edits performed.*
