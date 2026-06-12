# Codex Poster Bridge — Implementation & End-to-End Flow

**Date:** 2026-06-12
**Project:** marketing-workflow-app
**Status:** Built and tested end-to-end (on a local always-on machine). Not yet pushed/cut over to production.
**Purpose:** Explain — for someone who already knows the app — the AI poster flow *before* Codex, exactly *what changed*, and *how it works now*.

---

## 1. Why we did this

AI poster generation used two OpenAI models via the metered **OpenAI API**:
- **gpt-4o-mini** for the "thinking" agents (cheap — about a cent per poster), and
- **gpt-image-2** for the actual poster image (the expensive part — ~80–90% of the AI bill).

**Goal:** move the expensive **image generation onto Codex (ChatGPT subscription)** so it's covered by the flat subscription instead of per-image API charges — **without changing the app, the user flow, the agents, or the output quality.**

---

## 2. The flow BEFORE Codex (unchanged for the user, still the default)

```
Designer clicks "Generate with AI"
   → triggerAiGeneration() creates an ai_generation_jobs row (status = queued)
   → sends an Inngest event "ai/pipeline.started"
        │
        ▼  (Inngest runs 5 chained serverless functions on Vercel —
            split into 5 only to dodge Vercel's function timeout)
   ① Agent 1 — Understanding   gpt-4o-mini (vision): curate the best uploaded
                               photos, work out theme / audience / tone
   ② Agent 2 — Creative        gpt-4o-mini + web_search: pick the creative
                               direction, the layout (single or 3–5 carousel
                               pages), and WHICH brand assets to use
   ③ Agent 3 — Generation      gpt-image-2 (images.edit/generate): render the
                               poster, copying logo/header/footer + photos;
                               upload to the "designs" bucket; write ai_variations
   ④ Agent 4 — Evaluate        gpt-4o-mini (vision): score the poster 1–10 vs
                               the real brand assets
   ⑤ Agent 5 — Refine          re-render the worst page if it scored below 7
        │
        ▼
   Job status → completed → designer reviews the variations in the app
   → Chat & Edit / Regenerate → Accept → design_pending_approval
   → school admin approves → Published
```

**Every model call (text *and* image) went to the OpenAI API.**

---

## 3. What changed with Codex (the whole change in one paragraph)

We kept the **exact same 5 agents and the exact same app flow**. We changed **two things**:

1. **Where the pipeline runs** — instead of 5 chained Inngest functions on Vercel, it now runs as **one sequential pass on our own always-on machine** (a "worker"). Vercel has no function-timeout limit problem on our own box, so the split is no longer needed.
2. **The image engine** — Agent 3 and Agent 5 now generate the poster through **Codex's built-in image tool (gpt-image-2) on the ChatGPT subscription**, instead of the metered OpenAI image API. (The text agents 1, 2, 4 still use OpenAI for now — they're the cheap part.)

Everything else — curation, creative direction, brand-asset selection, evaluation, refinement, the review/redesign/approve/publish flow, the database, the UI, and the Android `.apk` — is **untouched**.

It's controlled by a switch (`POSTER_ENGINE`) that **defaults to the old behavior**, so the change is fully additive and reversible.

---

## 4. The flow NOW (with Codex, end-to-end)

```
Designer clicks "Generate with AI"   (same button, same screen)
   → triggerAiGeneration() creates ai_generation_jobs (status = queued)
   → does NOT call Inngest (because POSTER_ENGINE = server)
   → the app's job is done; the row sits queued
        │
        ▼
   Our always-on WORKER (polls the DB every 5s) claims the job
        │
        ▼  runs the whole pipeline in ONE sequential pass:
   fetchContext   — load request + school + uploaded photos + brand assets
                    (SAME database queries as before — unchanged)
   ① Agent 1      — Understanding        (OpenAI gpt-4o-mini)
   ② Agent 2      — Creative + assets    (OpenAI gpt-4o-mini + web_search)
   ③ Agent 3      — Generation           (CODEX built-in gpt-image-2)  ← changed
   ④ Agent 4      — Evaluate             (OpenAI gpt-4o-mini)
   ⑤ Agent 5      — Refine if < 7        (CODEX built-in gpt-image-2)  ← changed
        │
        ▼
   Upload posters to "designs" bucket → write ai_variations
   → job status = completed → "AI posters ready" notification
        │
        ▼
   Designer reviews in the SAME UI → Chat & Edit / Regenerate
        (these now also run on the worker via Codex)
   → Accept → design_pending_approval → admin approves → Published
```

**For the teacher, admin, and designer, nothing looks or behaves differently.** Only the place the image is rendered changed.

---

## 5. How Codex actually generates the image (the new piece)

The worker calls the **Codex CLI** (`codex exec`) with the same poster prompt the pipeline always built, plus the brand assets/photos as reference images. Codex's **built-in image tool** renders the poster on the ChatGPT subscription and saves it; the worker reads that file and uploads it to storage — exactly where the OpenAI API result used to go.

Two hardening details we added so it's reliable:
- Codex runs in a scratch folder **outside the project** so it stays focused on "make the image" (otherwise it picks up the project's developer instructions and wanders).
- **6-minute timeout + one automatic retry**, and for carousels the pages render **one at a time** (so we don't overload the machine or hit subscription rate limits).

---

## 6. What stayed exactly the same

- The 5 agents and all their logic (curation, creative direction, **brand-asset selection**, evaluation, refinement).
- Brand assets (logo / header / footer / samples) are still pulled from the school's library in the database and reproduced on the poster.
- The full request lifecycle: raise → approve → design → review → approve → publish.
- The database schema (only two small, backward-compatible columns added — see §8).
- The web UI and the Android **.apk** (no rebuild needed).

---

## 7. Cost impact

| Step | Before | Now |
|---|---|---|
| Image generation (the expensive ~80–90%) | OpenAI API, **paid per image** | **Codex subscription — no per-image charge** |
| Text agents (curation, direction, evaluation) | OpenAI API (~1¢/poster) | OpenAI API (~1¢/poster) — can move to Codex later |

So the large image-generation cost moves to the flat subscription; the remaining OpenAI cost is negligible.

---

## 8. What's new in the codebase (high level)

- **A switch** (`POSTER_ENGINE`, `MODEL_ENGINE`) — defaults to the old behavior.
- **A swappable model client** — the agents call it instead of OpenAI directly; it routes images to Codex when enabled.
- **A Codex image driver** — runs `codex exec` and returns the rendered poster.
- **A sequential pipeline runner** — reuses the existing agent code, runs all 5 in one pass on the worker.
- **The worker** — polls for queued jobs (generation *and* chat-edits), runs them, cleans up.
- **Two small DB migrations** — `poster_type` on the job (so the worker knows single vs carousel) and a small chat-edit queue flag. Both backward-compatible.

---

## 9. Testing — done end-to-end, and it works

| Test | Result |
|---|---|
| Single poster via Codex (full 5-agent pipeline) | ✅ completed, professional poster |
| Carousel (multi-page, sequential) | ✅ completed |
| Branded poster — school logo/header/footer reproduced | ✅ (verified with a real school logo) |
| Chat & Edit ("make the logo bigger") on the worker | ✅ edited page produced |
| Regenerate | ✅ |
| Full lifecycle: request → approve → designer → generate → review → publish | ✅ |
| Image generation runs on the ChatGPT subscription (no API key) | ✅ confirmed |

**I tested it and it works as expected.**

---

## 10. How we go live (when ready)

1. Keep the **always-on machine running the worker** (signed in to Codex).
2. On **Vercel**, add one setting: **`POSTER_ENGINE=server`** (and redeploy). Everything else stays.
3. To roll back at any time: remove that one Vercel setting → instantly back to the old OpenAI/Inngest path.

*Note:* a school will only get a fully branded poster if its **logo/header/footer are uploaded** in Admin → School → Brand Assets (same as before Codex) — without them, the poster generates without branding.

---

*End of document.*
