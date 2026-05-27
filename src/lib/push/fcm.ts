import "server-only";
import {
  initializeApp,
  cert,
  getApps,
  type App,
  type ServiceAccount,
} from "firebase-admin/app";
import { getMessaging, type Message } from "firebase-admin/messaging";

type FcmHandle = ReturnType<typeof getMessaging>;

let cached: FcmHandle | null = null;

// Returns null when FIREBASE_SERVICE_ACCOUNT_JSON isn't configured —
// callers should no-op the FCM channel cleanly in that case (e.g. local
// dev without secrets, or before the env var has been set on Vercel).
function getMessagingClient(): FcmHandle | null {
  if (cached) return cached;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw) as ServiceAccount;
  } catch (e) {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON", e);
    return null;
  }

  // firebase-admin caches the App by name across hot-reloads. Reuse if present.
  const existing = getApps().find((a) => a.name === "[DEFAULT]");
  const app: App = existing ?? initializeApp({ credential: cert(parsed) });
  cached = getMessaging(app);
  return cached;
}

export type FcmSendResult = {
  sent: number;
  invalidTokens: string[];
};

// Sends a single notification to a list of FCM tokens. Tokens that come back
// as `messaging/registration-token-not-registered` or `invalid-argument`
// are returned in invalidTokens so the caller can prune them from the DB.
export async function sendFcm(params: {
  tokens: string[];
  title: string;
  body: string;
  deepLink: string;
}): Promise<FcmSendResult> {
  const messaging = getMessagingClient();
  if (!messaging || params.tokens.length === 0) {
    return { sent: 0, invalidTokens: [] };
  }

  const invalid: string[] = [];
  let sent = 0;

  await Promise.all(
    params.tokens.map(async (token) => {
      const msg: Message = {
        token,
        // Use `notification` so Android renders the system banner even when
        // the app is killed. `data` rides alongside so the app can pull
        // out the deep link when the user taps the notification.
        notification: {
          title: params.title,
          body: params.body,
        },
        data: {
          deepLink: params.deepLink,
        },
        android: {
          priority: "high",
          notification: {
            channelId: "default",
            clickAction: "FCM_PLUGIN_ACTIVITY",
          },
        },
      };
      try {
        await messaging.send(msg);
        sent += 1;
      } catch (e) {
        const code =
          (e as { errorInfo?: { code?: string }; code?: string }).errorInfo
            ?.code ?? (e as { code?: string }).code ?? "";
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token" ||
          code === "messaging/invalid-argument"
        ) {
          invalid.push(token);
        } else {
          console.error("fcm send failed", { token: token.slice(0, 8), code, e });
        }
      }
    }),
  );

  return { sent, invalidTokens: invalid };
}
