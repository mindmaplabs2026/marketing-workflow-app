# Setting up a reel-generation worker on a new machine

The worker pulls AI reel jobs from Supabase, drives **Codex** (ChatGPT subscription, no
OpenAI key) to write Remotion compositions, and renders them to MP4. Several pieces live
**outside** this git repo — read the gotcha first.

## The renderer is a SEPARATE repo

The app spawns a sibling project, `remotion-renderer/`, which lives in its own git repo —
**not** inside this one. (It's kept separate because its `.tsx` files import `remotion`,
which breaks this app's Next.js/Vercel `next build` typecheck if they live in the app tree.)
It holds the Remotion deps, `render.ts`, `scaffold/`, `examples/`, and the
`skill/remotion-best-practices/` the composition agent reads at runtime.

Clone it as a sibling of the app:

```bash
cd designFactorie
git clone https://github.com/developer-mmlabs/remotion-renderer.git
```

```
designFactorie/
  marketing-workflow-app/     ← git clone (this repo)
  remotion-renderer/          ← git clone (separate repo, above)
```

The app resolves it at `../../../../remotion-renderer` by default. To put it elsewhere, set
`REMOTION_RENDERER_DIR=/abs/path` in `.env.local`.

## 1. System tools (Homebrew on macOS)

```bash
brew install node ffmpeg          # Node 20+ ; ffmpeg is REQUIRED
brew install whisper-cpp          # OPTIONAL — video transcription; skipped if absent
npm install -g @openai/codex      # the Codex CLI — the pipeline's model engine
```

`ffmpeg` is required (music trim + keyframe extraction); reel jobs fail without it.
`whisper` is optional — if missing, transcription is silently skipped (keyframes only).

## 2. Codex auth (the model engine — no OpenAI key)

```bash
codex login        # sign in with the ChatGPT subscription account
```

Everything — creative direction, composition code, evaluation, refinement — runs through
`codex exec`. If this isn't logged in, every job fails. Quick check:

```bash
codex --version
echo "say hi" | codex exec -
```

## 3. The app

```bash
cd designFactorie/marketing-workflow-app
npm install
```

## 4. The renderer (after cloning it — see top of this doc)

```bash
cd designFactorie/remotion-renderer
npm install        # its OWN node_modules — Remotion 4.0.443 lives here, not in the app
```

The first render downloads a headless Chromium via Remotion — let it finish once.

## 5. `.env.local` in the app

Copy `.env.local.example` → `.env.local` and set at minimum:

```bash
NEXT_PUBLIC_SUPABASE_URL=...          # SAME Supabase project as the other machine
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

POSTER_ENGINE=server                  # this machine pulls jobs from the queue
MODEL_ENGINE=codex                    # use Codex, NOT OpenAI
# OPENAI_API_KEY — leave unset/blank; not needed in codex mode

JAMENDO_CLIENT_ID=...                 # music; without it reels fall back to curated library
```

Everything else (`REEL_*` knobs, render GL, refine rounds) has working defaults. Notable
optional one: `REEL_RENDER_GL=angle` enables GPU (Metal) acceleration on a Mac.

## 6. Run it

```bash
cd designFactorie/marketing-workflow-app
npm run preflight     # optional: checks codex / ffmpeg / renderer folder / env
npm run worker
```

On start the worker prints a preflight line — confirm `MODEL_ENGINE=codex` and `ffmpeg=yes`.
It then polls Supabase and claims queued jobs.

## Notes

- **Both machines share one Supabase queue.** Job claiming is atomic
  (`.eq("status","queued")`), so two workers won't double-process the same job — that's your
  parallelism. One render at a time per machine is expected (Codex + render are slow).
- **Git push** (only if this machine commits): use the `developer-mmlabs` account —
  `gh auth switch --user developer-mmlabs` if you hit a 403.
