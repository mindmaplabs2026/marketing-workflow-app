/**
 * Probe: confirms the worker runtime can import the pipeline core —
 * i.e. tsconfig "@/*" aliases resolve AND the "server-only" guard is
 * neutralized (run with --conditions=react-server). Import only, no execution.
 */
async function main() {
  const mod = await import("../src/lib/ai/pipeline-core");
  console.log("✓ import OK — runPosterPipeline is", typeof mod.runPosterPipeline);
}
main().catch((e) => {
  console.error("✗ PROBE FAILED:", e);
  process.exit(1);
});
