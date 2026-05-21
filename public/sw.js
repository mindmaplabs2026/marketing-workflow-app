// Service worker for the Marketing Workflow PWA.
// Owns:
//   - push events       -> show OS notification with body + actions
//   - notificationclick -> if an action button was tapped, POST to
//                          /api/quick-approve; otherwise focus / open
//                          the deep link
// Cache strategy: intentionally none. We rely on Next.js for everything;
// the SW is push-only.

const QUICK_ACTIONS = new Set([
  "approve_request",
  "send_back_request",
  "approve_design",
  "request_design_changes",
]);

self.addEventListener("install", (event) => {
  // Activate immediately so the user doesn't have to refresh twice.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "New activity", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "New activity";
  const options = {
    body: payload.body || "",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: payload.tag,
    data: {
      url: payload.url || "/notifications",
      request_id: payload.request_id || null,
    },
    actions: Array.isArray(payload.actions) ? payload.actions : undefined,
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

async function quickAct(action, data) {
  try {
    const res = await fetch("/api/quick-approve", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: data.request_id,
        action,
      }),
    });
    const json = await res.json().catch(() => ({}));
    let title = "Done";
    let body = "";
    if (!res.ok || !json.ok) {
      title = "Couldn't do that";
      body = json.error || "Open the app and try again.";
    } else if (json.applied === false) {
      title = "Already handled";
      body = json.message || "Someone got there first.";
    } else {
      switch (action) {
        case "approve_request":
          body = "Request approved.";
          break;
        case "send_back_request":
          body = "Sent back to the teacher.";
          break;
        case "approve_design":
          body = "Design approved.";
          break;
        case "request_design_changes":
          body = "Changes requested.";
          break;
      }
    }
    await self.registration.showNotification(title, {
      body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: `quick-act-${data.request_id || ""}`,
    });
  } catch (e) {
    await self.registration.showNotification("Couldn't do that", {
      body: "Network error. Open the app and try again.",
      icon: "/icon.svg",
      badge: "/icon.svg",
    });
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action;

  if (action && QUICK_ACTIONS.has(action)) {
    event.waitUntil(quickAct(action, data));
    return;
  }

  const target = data.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          try {
            const url = new URL(client.url);
            if (url.pathname === target && "focus" in client) {
              return client.focus();
            }
          } catch {}
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }
        return null;
      }),
  );
});
