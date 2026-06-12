# AI Poster Generation — Cost Investigation Report

**Date:** 2026-06-08
**Project:** marketing-workflow-app (`C:\Loop\marketing-workflow-app`)
**Scope:** Investigation only. No code edits performed.

---

## 1. Observed Behavior

| Mode | Approximate cost per run |
|---|---|
| **Single poster** | ~₹115 (~$1.35) |
| **"Take over all" (carousel, 3–5 pages)** | ~₹400–500 (~$4.70–5.90) |

User flagged a 4–5× cost jump and asked for root cause + reduction options without quality loss and without code edits.

---

## 2. Pipeline Architecture

The pipeline lives in `src/lib/inngest/functions/ai-pipeline.ts` and chains 5 Inngest functions to avoid Vercel timeouts and Inngest step-output size limits:

```
started → analyze (Agent 1) → creative (Agent 2)
       → generate-v1 (Agent 3) → evaluate → (refine?) → completed
```

| Stage | File | Model | Purpose |
|---|---|---|---|
| Agent 1 — Pass 1 | `src/lib/ai/agent-understanding.ts:90` | gpt-4o-mini (vision, **low** detail) | Scan ALL uploads, shortlist top ~15 |
| Agent 1 — Pass 2 | `src/lib/ai/agent-understanding.ts:172` | gpt-4o-mini (vision, **high** detail) | Deep-analyze shortlisted images |
| Agent 2 — Creative | `src/lib/ai/agent-creative.ts:316` | gpt-4o-mini Responses API + **web_search** + vision on up to **10 sample posters at high detail** + all brand assets | Direction, theme, color palette, layout, per-page photo distribution |
| Agent 3 — Enhancer | `src/lib/ai/agent-generation.ts:380` | gpt-4o-mini (text) | Expand creative brief into rich image prompt — **runs per page** |
| Agent 3 — Image | `src/lib/ai/agent-generation.ts:417, 443` | gpt-image, `quality:"high"`, `1024x1536`, 6–10 reference images | Render the poster — **runs per page** |
| Evaluator | `src/lib/ai/agent-generation.ts:91` | gpt-4o-mini (vision, **high** detail on poster + low on refs) | Score 1–10, compare to references — **runs per page** |
| Refinement | `src/lib/ai/agent-generation.ts:602` | gpt-4o-mini enhancer + gpt-image edit | Auto-triggers if any page < `QUALITY_THRESHOLD=7` (`agent-generation.ts:42`), refines worst page |

---

## 3. Cost Breakdown — Single Poster (~₹115)

| Line item | Approx cost |
|---|---|
| Agent 1 Pass 1 (low-detail vision on all uploads) | $0.005 |
| Agent 1 Pass 2 (high-detail vision on ~10 shortlisted) | $0.05 |
| Agent 2 (Responses API + web_search + high-detail vision on 10 samples + brand assets) | $0.10–0.20 |
| Agent 3 prompt enhancer | $0.005 |
| **Agent 3 image edit (high quality, 1024x1536, 6–10 ref images)** | **$0.25–0.35** |
| Evaluator (high-detail vision on poster + low-detail refs) | $0.02 |
| **Auto-refinement (if score < 7): enhancer + 1 more high-quality image edit** | **$0.30–0.40** |
| **Total per single poster** | **~$0.70–1.30** (≈ ₹60–110) |

Note: actual cost is often higher than `cost-tracker.ts` reports — see Section 7.

---

## 4. Cost Breakdown — Carousel (~₹400–500)

Agents 1 and 2 run once (same cost as single). Then per page, in parallel:

| Per-page line item | Approx cost (× pages) |
|---|---|
| Agent 3 enhancer (`agent-generation.ts:380`) | $0.005 × N |
| **Agent 3 image edit at quality:"high"** with brand refs re-attached every page (`agent-generation.ts:207-216`, `337-339`) | **$0.25–0.35 × N** |
| Evaluator vision call per page (`ai-pipeline.ts:619-639`) | $0.02 × N |
| Refinement on worst-scoring page only (still adds one full image edit) | $0.30–0.40 |

For a **5-page carousel:**
- Agent 1+2 base: ~$0.30
- 5× image edits: ~$1.50
- 5× enhancers + 5× evaluators: ~$0.13
- 1× refinement: ~$0.35
- **Total: ~$2.30–3.50 base.** With input-image tokens for re-attached brand assets, real bill reaches **~$4–5** (₹340–425). Matches observed ₹400–500.

---

## 5. Root Causes of the 4–5× Jump

| # | Cause | Code location |
|---|---|---|
| 1 | **Per-page image generation at quality:"high"** — each page is a separate `images.edit` call | `agent-generation.ts:417-424, 443-449, 476-478` |
| 2 | **Reference images re-sent every page** — logo, header, footer, samples, uniform attached to ALL pages even though identical | `agent-generation.ts:207-216, 337-339` |
| 3 | **Per-page enhancer call** | `agent-generation.ts:380` |
| 4 | **Per-page evaluator vision call** — also re-sends brand-asset refs each time | `ai-pipeline.ts:619-639` |
| 5 | **Auto-refinement** silently triggered when any page scores < 7/10 | `ai-pipeline.ts:676`, threshold `agent-generation.ts:42` |

---

## 6. Why "Save Assets Locally" Does NOT Reduce Cost

User asked whether saving brand assets on the local machine instead of Supabase would cut the bill.

**Answer: No.**

1. The bill is at the **OpenAI API**, not at Supabase or your app.
2. `images.edit` requires the brand asset PNGs to be **sent to OpenAI as input images** so the model can copy logo/header/footer pixel-faithfully (`agent-generation.ts:409-413`).
3. Wherever the files are stored, the same bytes reach OpenAI at pipeline run time. OpenAI charges per token / per input image — origin doesn't matter.
4. Supabase storage cost is negligible (~$0.021/GB/month). Optimizing here saves rupees per year.

---

## 7. Cost Tracker Under-Reports the Real Bill

`src/lib/ai/cost-tracker.ts:67-72` prices image generation at a flat **$0.08** per 1024x1536 image.

Reality:
- `quality:"high"` at 1024x1536 is **~$0.19–0.25** per output image.
- **Input reference images are billed separately** at input-image token rates (~$10/1M). A call with 8 reference images can add **$0.10–0.20** just for the inputs.

**Implication:** the `cost_tracking` JSON stored in `ai_generation_jobs` understates the actual OpenAI invoice by **roughly 2–3×**. That's why the card charge feels higher than what the app shows.

---

## 8. Why "Run via Codex CLI Locally" Does NOT Help As Expected

User asked whether running the generation through Codex CLI with local assets would cut cost.

### What doesn't change
1. **Image generation cost is identical.** Codex CLI uses your OpenAI API key and hits the same `images.edit` endpoint. Per-call price is unchanged.
2. **Same OpenAI account = same invoice.** App and Codex bill against the same key.
3. **Local assets still get uploaded.** The model needs them visible; same bytes flow to OpenAI.

### What WOULD be cheaper (but for a different reason)
4. Codex one-shot bypasses the multi-agent pipeline → you skip Agent 1 vision passes, Agent 2 web_search, evaluator, and auto-refinement → ~**₹40–60 saved per single, ~₹150–250 per carousel**.
5. **This is savings from skipping work, not from local storage.**

### What you LOSE going Codex-only
6. **No photo curation** (Agent 1 picks best 10–15 of however many were uploaded).
7. **No creative direction** (Agent 2's layout, palette, font choices, per-page photo distribution, trend research).
8. **No carousel rule enforcement** (cover ≤ 1 photo, middle 3–6 photos, closing ≤ 1 — currently in `ai-pipeline.ts:225-263`).
9. **No quality check / auto-refinement.**
10. **Designer workflow breaks.** The app expects `ai_variations` + `designs` rows to drive the `pending_admin_approval → approved → in_design → design_pending_approval → published` flow. A locally-generated poster bypasses approval and push notifications. The designer would have to upload the final PNG manually via the existing form.
11. **Higher iteration count.** Without Agent 2's direction, prompts will be weaker → more retries → **same or HIGHER total cost** in practice.

---

## 9. The ONLY Path That Cuts Cost Without Quality Loss

**Local compositing.**

Change what the model is asked to render:
- gpt-image generates **background + event imagery only** (no logo, header, footer).
- Stamp real logo/header/footer onto the AI output using **Sharp** server-side (or Canvas).
- These elements are pixel-perfect by definition (they're your real PNGs) — arguably **better** than the AI's redraw.

**Savings:**
- ~30–40% per single (3–5 fewer reference images per `images.edit`).
- ~40–50% per carousel page (multiplied across all pages).
- Bonus: shorter prompts (no "copy logo exactly" instructions), and evaluator no longer needs to verify logo accuracy.

**Catch:** This is the "compositing" approach you explicitly **locked out** in the original plan (decided on 2026-06-04 after gpt-image's text/logo rendering passed the bar on sample posters — "AI-only, NO compositing"). Cutting cost without quality loss requires reopening that decision.

---

## 10. Recommended Actions, Ranked by Impact

Without revisiting the AI-only decision (i.e., quality may dip slightly on some, none on others):

| # | Change | Effort | Quality risk | Est. savings |
|---|---|---|---|---|
| 1 | Drop `quality:"high"` → `"medium"` on first generation; keep "high" only for designer-approved final | 4 line changes (`agent-generation.ts:424,449,715,731` + `ai-chat.ts:107`) | Low–medium | **~60% per image call** |
| 2 | Disable auto-refinement OR raise `QUALITY_THRESHOLD` from 7 to 5 | 1 line (`agent-generation.ts:42`) | None (output unchanged unless user requests) | **~25–30% per run** |
| 3 | De-duplicate brand-asset references on carousel pages 2–N | Refactor in `agent-generation.ts:207-216` | None | **~15–25% per carousel** |
| 4 | Cap carousel at 3 pages | `agent-creative.ts:121-122` | Slight (less variety) | **~30% on long carousels** |
| 5 | Cut Agent 2 sample posters from 10 → 3, lower detail to `"low"` | `agent-creative.ts:255` + detail param | Slight (less style reference) | **~10–15% on Agent 2** |
| 6 | Switch `web_search` off or `search_context_size:"low"` | `agent-creative.ts:323` | Slight (no trend research) | **~5–10% on Agent 2** |
| 7 | Lower evaluator detail to `"low"` | `agent-generation.ts:88` | Low (evaluator becomes less precise) | **~5%** |
| 8 | Evaluate cover page only on carousels, not every page | `ai-pipeline.ts:619-639` | Medium (other pages skip QA) | **~10% per carousel** |
| 9 | Fix cost tracker to reflect real pricing | `cost-tracker.ts:67-72` | None (observability only) | $0 saved, but accurate billing |

**Quick win combo (#1 + #2):** 5-page carousel drops from ₹400–500 → roughly **₹150–200**, with no quality drop until the user clicks a "finalize at high quality" button (which would need to be added).

**True quality-preserving combo:** local compositing (Section 9) + #2 + #3 = ~50–60% cost reduction, **zero quality loss**, but requires reversing the AI-only lock.

---

## 11. Summary

- Carousel costs 4–5× single because the expensive image-edit + evaluator + reference-image work runs **per page**, while Agent 1/2 cost only once.
- Saving assets locally doesn't help — the cost is at the OpenAI API, not at storage.
- Running via Codex CLI doesn't reduce image generation cost — it only saves the multi-agent overhead, at the cost of curation, direction, QA, and the designer workflow.
- The only zero-quality-loss path is **local compositing** of logo/header/footer onto AI-generated background.
- Without revisiting the AI-only decision, the highest-impact tweaks are dropping initial image quality to `"medium"` and disabling auto-refinement — together cutting cost roughly in half.

---

*End of report. No code edits performed.*
