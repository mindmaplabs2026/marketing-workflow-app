/**
 * Worker preflight — verifies a new machine can run the reel pipeline before you
 * start the worker. Checks: codex CLI + login, ffmpeg, the sibling renderer
 * project (folder + node_modules + skill), and the critical env vars.
 *
 * Run with:  npm run preflight   (or: npx tsx scripts/preflight.ts)
 * Exits non-zero if any REQUIRED check fails.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const C = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", grey: "\x1b[90m",
};
const ok = (m: string) => console.log(`${C.green}✓${C.reset} ${m}`);
const warn = (m: string) => console.log(`${C.yellow}⚠${C.reset} ${m}`);
const fail = (m: string) => console.log(`${C.red}✗${C.reset} ${m}`);

let hardFail = false;

function has(cmd: string, args: string[] = ["--version"]): string | null {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: true });
  if (r.status === 0 || (r.stdout && r.stdout.trim())) return (r.stdout || r.stderr || "").trim().split("\n")[0];
  return null;
}

console.log(`${C.grey}— Worker preflight —${C.reset}`);

// 1. ffmpeg (REQUIRED)
const ff = has("ffmpeg", ["-version"]);
if (ff) ok(`ffmpeg: ${ff.replace("ffmpeg version ", "").slice(0, 40)}`);
else { fail("ffmpeg NOT FOUND — reel jobs will fail. brew install ffmpeg"); hardFail = true; }

// 2. codex CLI (REQUIRED) + login
const cx = has("codex", ["--version"]);
if (cx) {
  ok(`codex CLI: ${cx}`);
  const login = spawnSync("codex", ["exec", "-"], { input: "reply with the single word: ready", encoding: "utf8", shell: true, timeout: 60_000 });
  if (login.status === 0 && /ready/i.test(login.stdout || "")) ok("codex login: authenticated (exec responded)");
  else { fail("codex exec did not respond — run: codex login (ChatGPT subscription)"); hardFail = true; }
} else { fail("codex CLI NOT FOUND — npm install -g @openai/codex"); hardFail = true; }

// 3. whisper (OPTIONAL)
if (process.env.WHISPER_CPP_MODEL && existsSync(process.env.WHISPER_CPP_MODEL)) ok("whisper: whisper.cpp model present");
else if (has("whisper", ["--help"]) || has("whisper-cli", ["--help"])) ok("whisper: CLI present");
else warn("whisper: not found — video transcription disabled (keyframes only). Optional.");

// 4. renderer sibling project (REQUIRED)
const rendererDir = process.env.REMOTION_RENDERER_DIR ?? path.resolve(__dirname, "../../remotion-renderer");
if (existsSync(path.join(rendererDir, "render.ts"))) {
  ok(`renderer: ${rendererDir}`);
  if (existsSync(path.join(rendererDir, "node_modules", "remotion"))) ok("renderer: node_modules installed");
  else { fail(`renderer: node_modules missing — cd ${rendererDir} && npm install`); hardFail = true; }
  if (existsSync(path.join(rendererDir, "skill", "remotion-best-practices", "SKILL.md"))) ok("renderer: remotion skill present");
  else warn("renderer: skill/ missing — compositions generate without best-practices guidance");
  if (existsSync(path.join(rendererDir, "examples"))) ok("renderer: examples/ present");
  else warn("renderer: examples/ missing — fewer few-shot references for the agent");
} else {
  fail(`renderer NOT FOUND at ${rendererDir} — git clone https://github.com/developer-mmlabs/remotion-renderer.git here, or set REMOTION_RENDERER_DIR`);
  hardFail = true;
}

// 5. env (REQUIRED)
const need = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
for (const k of need) {
  if (process.env[k]) ok(`env: ${k} set`);
  else { fail(`env: ${k} missing in .env.local`); hardFail = true; }
}
if (process.env.MODEL_ENGINE === "codex") ok("env: MODEL_ENGINE=codex");
else warn(`env: MODEL_ENGINE=${process.env.MODEL_ENGINE ?? "(unset)"} — expected 'codex' for the no-key Codex path`);
if (process.env.POSTER_ENGINE === "server") ok("env: POSTER_ENGINE=server");
else warn(`env: POSTER_ENGINE=${process.env.POSTER_ENGINE ?? "(unset)"} — expected 'server' so this machine pulls jobs`);
if (process.env.JAMENDO_CLIENT_ID) ok("env: JAMENDO_CLIENT_ID set");
else warn("env: JAMENDO_CLIENT_ID missing — music falls back to curated library");

console.log("");
if (hardFail) { fail("Preflight FAILED — fix the ✗ items above before starting the worker."); process.exit(1); }
else ok("Preflight passed — ready to run: npm run worker");
