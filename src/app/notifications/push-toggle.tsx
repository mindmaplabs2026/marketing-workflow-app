"use client";

import { useEffect, useState, useTransition } from "react";
import { subscribePush, unsubscribePush } from "./actions";

type State =
  | { kind: "loading" }
  | { kind: "unsupported"; reason: string }
  | { kind: "denied" }
  | { kind: "off" }
  | { kind: "on"; endpoint: string };

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (typeof window === "undefined") return;
      if (!vapidPublicKey) {
        setState({
          kind: "unsupported",
          reason: "Push isn't configured on this server yet.",
        });
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState({
          kind: "unsupported",
          reason: "This browser doesn't support push notifications.",
        });
        return;
      }
      try {
        const reg =
          (await navigator.serviceWorker.getRegistration("/sw.js")) ??
          (await navigator.serviceWorker.register("/sw.js"));
        if (cancelled) return;
        if (Notification.permission === "denied") {
          setState({ kind: "denied" });
          return;
        }
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (existing) {
          setState({ kind: "on", endpoint: existing.endpoint });
        } else {
          setState({ kind: "off" });
        }
      } catch (e) {
        setState({
          kind: "unsupported",
          reason: e instanceof Error ? e.message : "Service worker failed.",
        });
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? { kind: "denied" } : { kind: "off" });
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Browser returned an incomplete subscription.");
      }
      startTransition(async () => {
        try {
          await subscribePush({
            endpoint: json.endpoint!,
            keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
            userAgent: navigator.userAgent,
          });
          setState({ kind: "on", endpoint: json.endpoint! });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not save subscription.");
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable push.");
    }
  }

  async function disable() {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const endpoint = sub?.endpoint;
      if (sub) await sub.unsubscribe();
      if (endpoint) {
        startTransition(async () => {
          try {
            await unsubscribePush(endpoint);
            setState({ kind: "off" });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not unsubscribe.");
          }
        });
      } else {
        setState({ kind: "off" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disable push.");
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Push on this device
          </p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {state.kind === "on"
              ? "You will get a push when something needs your attention — even when the app is closed."
              : state.kind === "denied"
                ? "Your browser blocked notifications. Update site settings to re-enable."
                : state.kind === "unsupported"
                  ? state.reason
                  : "Get pinged when a request, design, or post needs you."}
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
        <div className="shrink-0">
          {state.kind === "loading" && (
            <span className="text-xs text-zinc-500">…</span>
          )}
          {state.kind === "off" && (
            <button
              type="button"
              onClick={enable}
              disabled={pending}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {pending ? "Enabling…" : "Enable"}
            </button>
          )}
          {state.kind === "on" && (
            <button
              type="button"
              onClick={disable}
              disabled={pending}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {pending ? "…" : "Disable"}
            </button>
          )}
          {state.kind === "denied" && (
            <span className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 dark:border-rose-900/50 dark:text-rose-300">
              Blocked
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
