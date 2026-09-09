/* Push-only worker: does not intercept or cache app pages or calendar data. */
const stateUrl = new URL(".calendar-push-owner", self.registration.scope).href;
const stateCache = "dailygrind-push-state-v1";
async function owner() {
  const response = await (await caches.open(stateCache)).match(stateUrl);
  return response ? response.text() : "";
}
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  if (event.data?.type !== "SET_PUSH_OWNER") return;
  event.waitUntil((async () => {
    const cache = await caches.open(stateCache);
    await cache.put(stateUrl, new Response(String(event.data.uid || "")));
    event.ports[0]?.postMessage({ ok: true });
  })());
});
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    const data = event.data?.json();
    // A queued push for a signed-out/previous account must not reveal its event.
    if (!data || !data.owner || data.owner !== await owner()) return;
    const url = new URL(data.url || "?calendar=1", self.registration.scope);
    if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
    await self.registration.showNotification(String(data.title || "Calendar reminder"), {
      body: String(data.body || "").slice(0, 240), tag: String(data.tag || "dailygrind-calendar"),
      data: { url: url.href }, icon: new URL("icon-192.png", self.registration.scope).href
    });
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(event.notification.data?.url || "?calendar=1", self.registration.scope);
    if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) {
      // Use a message instead of navigating an open app and discarding drafts.
      existing.postMessage({ type: "OPEN_CALENDAR", date: url.searchParams.get("date") });
      await existing.focus();
    } else await self.clients.openWindow(url.href);
  })());
});
