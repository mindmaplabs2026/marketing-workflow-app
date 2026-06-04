# AI Poster Generation — Clarity Document

## What You Actually Want

**The real goal:**
Eliminate the designer from the workflow by replacing them with a 3-agent AI pipeline that produces higher-quality posters faster — turning a multi-day process into a ~20-30 minute automated one.

**Why it matters:**
AI image models now outperform human designers for this work. The designer bottleneck slows the pipeline and adds cost without proportional value.

**What success looks like:**
- High admin approval rate on AI-generated posters
- Output quality that visibly exceeds human designer work
- Teacher submits → 3 distinct poster variations ready in ~20-30 minutes

**What to avoid:**
- Misunderstanding the theme / off-target storyboards
- Broken async notification flow
- Mindless use of school assets (uniforms, infrastructure forced in where not needed)
- Copy-paste branding (adapt uniquely, don't stamp)
- Poor curation from large image uploads
- Repetitive/samey variations — the 3 outputs must feel genuinely different

## The Pipeline

### Agent 1 (Understanding)
- Analyzes title, description, all uploaded images
- Assesses quality/content/relevance
- Curates a shortlist from potentially 50-60 uploads
- Identifies the core theme

### Agent 2 (Storyboard/Creative)
- First decides 3 distinct creative directions for the theme
- Does **separate internet research per direction** for design trends, color palettes, and visual styles
- Outputs a structured brief per variation:
  - Theme and color palette
  - Text content and placement
  - Image selection by filename
  - Collage layout (single poster: 4-5 images max)
  - Logo, header, footer placement (adapted uniquely, not stamped)
  - School asset usage decisions (uniform, infrastructure — only when appropriate)
- Handles both single poster and carousel (3-5 pages) formats
- Carousel posters must maintain a uniform theme across all pages

### Agent 3 (Generation)
- Produces posters following each brief from Agent 2
- Uses school brand assets appropriately
- Uniforms mandatory on AI-generated students only, never on real uploaded photos
- Generates 3 variations total

## School Brand Assets (Pre-configured per school)
- Logo
- Header
- Footer
- School uniform standards
- School infrastructure images

## Poster Types
- **Single poster**: One image, Instagram-standard dimensions
- **Carousel poster**: 3-5 pages with a uniform theme across all

## Interactive Chat Editing (Post-Generation)

After the 3 variations are generated:
- Each variation gets its **own chat thread** with full pipeline context
- Teacher can open any variation's chat and request targeted edits:
  - Change captions/text
  - Adjust colors, tone, layout
  - Swap images
  - Any visual refinement
- Chat has access to Agent 1's understanding + Agent 2's creative brief for that variation
- Edits regenerate **only that specific poster**, not the full pipeline
- **25 chat rounds max** per variation (cost control)
- Uses a chat-chain mechanism (LangChain or OpenAI API with conversation history)

## Flow
```
Teacher submits request with "AI Generate"
  → Agents run async (~20-30 min)
    → Agent 1: Understand & curate
    → Agent 2: 3 creative directions → separate research each → structured briefs
    → Agent 3: Generate 3 poster variations
  → Teacher notified (push notification)
  → Teacher reviews 3 variations
  → Teacher opens chat on any variation to iterate (up to 25 rounds each)
  → Teacher accepts final version
  → School admin approves
  → Published
```

## Real Constraints
- GPT ecosystem only (Image 1/1.5/2 for generation, cheapest vision-capable model for agents 1 & 2)
- Deployed on Vercel + Supabase (queue-based async required due to serverless timeouts)
- Must work within existing app infrastructure (Next.js 16, React 19, Supabase auth/storage/RLS)
- School brand assets pre-configured per school
- Must handle 30-40 concurrent users within the 20-30 min target

## Success Metric
Admin approval rate per request — if admins are consistently approving AI-generated posters, the pipeline is working.

## North Star
Confidence that AI output is better than human designer work.
