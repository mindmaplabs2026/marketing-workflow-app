// One-time helper to generate a VAPID key pair for web push.
// Usage:  node scripts/generate-vapid.mjs
// Then paste the printed lines into .env.local.
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("");
console.log("# --- paste into .env.local ---");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:abhishek@mindmaplabs.in`);
console.log("# -----------------------------");
console.log("");
console.log("Generated. Restart `npm run dev` after pasting.");
