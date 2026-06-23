/**
 * Floating worker status bar.
 *
 * Pins a one-line dashboard to the BOTTOM of the terminal while normal logs scroll
 * above it — elapsed time, current stage, assets in/out, last eval score. It uses an
 * ANSI scroll region (rows 1..N-1 scroll; row N holds the bar), so it needs a real
 * TTY; on a pipe/redirect it's a no-op and logs print normally.
 *
 * State is DERIVED from the log stream (noteLogLine) rather than threaded through the
 * pipeline, so this stays decoupled — if a log string changes the bar just gets a bit
 * less accurate, it never affects the pipeline. Disable with WORKER_STATUS_BAR=0.
 */

type Status = {
  label: string;        // job title or "idle"
  jobStartMs: number;   // 0 when idle
  stage: string;
  inImg: number;
  inVid: number;
  brand: number;
  varsTotal: number;
  varsDone: number;
  score: number | null;
  state: "idle" | "running" | "done" | "failed";
};

// Theme. Default "light": a soft light-grey bar with BLACK text + dark accents, so it
// stays readable on a white/light terminal. Set WORKER_STATUS_BAR_THEME=dark for the
// old white-on-blue bar (better on dark terminals).
const DARK = process.env.WORKER_STATUS_BAR_THEME === "dark";
const C = DARK
  ? {
      reset: "\x1b[0m", bold: "\x1b[1m",
      bg: "\x1b[44m", fg: "\x1b[97m",        // blue bg, bright-white text
      run: "\x1b[93m", done: "\x1b[92m", fail: "\x1b[91m", idle: "\x1b[37m", sep: "\x1b[90m",
    }
  : {
      reset: "\x1b[0m", bold: "\x1b[1m",
      bg: "\x1b[48;5;253m", fg: "\x1b[30m",  // light-grey bg, BLACK text
      run: "\x1b[34m", done: "\x1b[32m", fail: "\x1b[31m", idle: "\x1b[90m", sep: "\x1b[90m",
    };

let enabled = false;
let rows = 0;
let timer: NodeJS.Timeout | null = null;
let tornDown = false;

const s: Status = {
  label: "idle", jobStartMs: 0, stage: "waiting for jobs",
  inImg: 0, inVid: 0, brand: 0, varsTotal: 0, varsDone: 0, score: null, state: "idle",
};
let curVar = 0;

function setRegion(): void {
  // Reserve the bottom row: scroll region = rows 1..(rows-1), park cursor in it.
  process.stdout.write(`\x1b[1;${rows - 1}r\x1b[${rows - 1};1H`);
}

function elapsed(): string {
  if (!s.jobStartMs) return "--:--";
  const sec = Math.floor((Date.now() - s.jobStartMs) / 1000);
  const m = Math.floor(sec / 60), ss = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function renderBar(cols: number): string {
  const dot = s.state === "failed" ? `${C.fail}●` : s.state === "done" ? `${C.done}●` : s.state === "running" ? `${C.run}●` : `${C.idle}○`;
  const segs = [
    `${dot}${C.fg}${C.bold} ${s.label.slice(0, 28)}${C.reset}${C.bg}${C.fg}`,
    `⏱ ${elapsed()}`,
    `▸ ${s.stage}`,
    `in ${s.inVid}🎬 ${s.inImg}🖼 ${s.brand}🏷`,
    `out ${s.varsDone}/${s.varsTotal || "?"}🎞`,
    s.score != null ? `★ ${s.score.toFixed(1)}` : "",
  ].filter(Boolean);
  const sep = `${C.sep}│${C.fg}`;
  let text = " " + segs.join(`  ${sep}  `) + " ";
  // Strip ANSI when measuring width, then pad/truncate the visible text to cols.
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
  if (visible.length > cols) {
    // truncate (approx — fine for a status bar)
    text = text.slice(0, cols);
  } else {
    text = text + " ".repeat(cols - visible.length);
  }
  return `${C.bg}${C.fg}${text}${C.reset}`;
}

function draw(): void {
  if (!enabled || tornDown) return;
  const cols = process.stdout.columns || 80;
  // Save cursor, jump to bottom row, clear it, paint the bar, restore cursor.
  process.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K${renderBar(cols)}\x1b8`);
}

/** Update bar state from a raw (uncoloured) log line, then redraw. */
export function noteLogLine(raw: string): void {
  if (!enabled || typeof raw !== "string") return;
  let changed = false;
  const m = (re: RegExp) => raw.match(re);

  if (raw.includes("| START (request")) {
    s.label = "loading…"; s.jobStartMs = Date.now(); s.stage = "starting";
    s.inImg = s.inVid = s.brand = s.varsTotal = s.varsDone = 0; s.score = null;
    s.state = "running"; curVar = 0; changed = true;
  }
  const up = m(/(\d+) uploads \((\d+) images, (\d+) videos\), (\d+) brand assets, title="(.*?)"/);
  if (up) {
    s.inImg = Number(up[2]); s.inVid = Number(up[3]); s.brand = Number(up[4]);
    s.label = up[5] || s.label; changed = true;
  }
  const vt = m(/for (\d+) variation\(s\)/);
  if (vt) { s.varsTotal = Number(vt[1]); changed = true; }
  const vn = m(/── Variation (\d+) ──/);
  if (vn) { curVar = Number(vn[1]); s.stage = `variation ${curVar}`; changed = true; }

  if (raw.includes("── Agent 1")) { s.stage = "analyzing media"; changed = true; }
  else if (raw.includes("── Agent 2")) { s.stage = "creative direction"; changed = true; }
  else if (/— Finding music/.test(raw)) { s.stage = `music · V${curVar}`; changed = true; }
  else if (/Generating Remotion composition/.test(raw)) { s.stage = `writing · V${curVar}`; changed = true; }
  else if (/Re-rendering \(round|refine round/.test(raw)) { s.stage = `refining · V${curVar}`; changed = true; }
  else if (/Rendering \d+ frames/.test(raw)) { s.stage = `rendering · V${curVar}`; changed = true; }
  else if (/— Evaluating/.test(raw)) { s.stage = `evaluating · V${curVar}`; changed = true; }

  const sc = m(/Score: ([\d.]+)\/10/);
  if (sc) { s.score = Number(sc[1]); changed = true; }
  if (/— Uploaded:/.test(raw)) { s.varsDone += 1; changed = true; }
  if (/\| COMPLETED/.test(raw)) { s.stage = "completed"; s.state = "done"; changed = true; }
  if (/\| FAILED:/.test(raw)) { s.stage = "failed"; s.state = "failed"; changed = true; }

  if (changed) draw();
}

/** Initialise the bar (TTY only). Returns a teardown fn (also auto-runs on exit). */
export function initStatusBar(): () => void {
  enabled =
    process.env.WORKER_STATUS_BAR !== "0" &&
    !!process.stdout.isTTY &&
    (process.stdout.rows ?? 0) >= 5;
  if (!enabled) return () => {};

  rows = process.stdout.rows || 24;
  setRegion();
  draw();

  timer = setInterval(draw, 1000);
  timer.unref();

  const onResize = () => { rows = process.stdout.rows || 24; setRegion(); draw(); };
  process.stdout.on("resize", onResize);

  const teardown = () => {
    if (tornDown || !enabled) return;
    tornDown = true;
    if (timer) clearInterval(timer);
    process.stdout.off("resize", onResize);
    // Reset scroll region to the full screen, clear the bar line, show cursor.
    process.stdout.write(`\x1b[r\x1b[${rows};1H\x1b[2K\x1b[?25h`);
  };

  // Restore the terminal on ANY exit path. We do NOT register SIGINT/SIGTERM here —
  // the worker owns those and calls process.exit(), which fires "exit" → teardown.
  process.on("exit", teardown);
  return teardown;
}
