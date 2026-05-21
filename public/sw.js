// Service worker for the Marketing Workflow PWA.
// Owns:
//   - push events  -> show OS notification with body text + icon
//   - notificationclick -> focus an existing tab or open the deep link
// Cache strategy: intentionally none. We rely on Next.js for everything;
// the SW is push-only.

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
    data: { url: payload.url || "/notifications" },
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
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
