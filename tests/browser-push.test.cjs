const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function client({ ios = false, standalone = false, permission = "default" } = {}) {
  const calls = [], local = new Map(); let owner = "", sub = null, permissionResult = "granted", fail = false;
  const pub = Buffer.alloc(65, 4).toString("base64url");
  const account = { uid: "owner", isAnonymous: false, getIdToken: async () => "test-token" };
  const auth = { currentUser: account, onAuthStateChanged() {} };
  const reg = { active: { postMessage(data, ports) { owner = data.uid; ports[0].postMessage({ok:true}); } },
    pushManager: { getSubscription: async () => sub, subscribe: async options => {
      calls.push("subscribe"); sub = { options, toJSON: () => ({ endpoint: "https://fcm.googleapis.com/test", keys: {} }), unsubscribe: async () => { calls.push("unsubscribe"); sub = null; return true; } }; return sub;
    } } };
  const context = { window: {}, firebase: { auth: () => auth }, navigator: { userAgent: ios ? "iPhone" : "Chrome", platform: "", maxTouchPoints: 0, standalone,
    serviceWorker: { getRegistration: async () => reg, register: async () => reg } }, matchMedia: () => ({ matches: standalone }),
    isSecureContext: true, Notification: { permission, requestPermission() { calls.push("permission"); this.permission = permissionResult; return Promise.resolve(permissionResult); } },
    localStorage: { getItem: k => local.get(k) || null, setItem: (k, v) => local.set(k, v), removeItem: k => local.delete(k) },
    URL, location: { href: "https://feroakdemir-arch.github.io/daily-grind/" }, Uint8Array, atob, Intl, setTimeout, clearTimeout, AbortController,
    MessageChannel: class { constructor() { this.port1 = { close() {} }; this.port2 = { postMessage: data => this.port1.onmessage({ data }) }; } },
    fetch: async (url, options) => {
      const name = url.split("/").at(-1); calls.push(name);
      assert.equal(options.headers.Authorization, "Bearer test-token");
      if (fail) throw new TypeError("offline");
      return { ok: true, json: async () => ({ result: name === "calendarPushConfig" ? { publicKey: pub, timeZone: "America/New_York" } :
        name === "calendarPushRegister" ? { deviceId: "a".repeat(64), timeZone: "America/New_York" } : { enabled: true } }) };
    }
  };
  context.window = context; context.PushManager = function(){};
  vm.runInNewContext(fs.readFileSync(require.resolve("../calendar-reminders.js"), "utf8"), context);
  return { api: context.calendarReminders, calls, local, auth, owner: () => owner, sub: () => sub,
    deny: () => { permissionResult = "denied"; }, offline: () => { fail = true; } };
}
test("iPhone requires Home Screen; checking status never prompts permission", async () => {
  const iphone = client({ ios: true });
  assert.equal((await iphone.api.status()).state, "install"); assert.deepEqual(iphone.calls, []);
  const installed = client({ ios: true, standalone: true });
  assert.equal((await installed.api.status()).state, "off"); assert.deepEqual(installed.calls, ["calendarPushConfig"]);
});
test("permission is requested from the click before async setup; reload preserves opt-in", async () => {
  const h = client();
  const enabling = h.api.enable(); assert.equal(h.calls[0], "permission");
  assert.equal((await enabling).state, "on"); assert.equal(h.owner(), "owner");
  assert.ok(h.sub()); assert.equal((await h.api.status()).state, "on");
  assert.equal(h.calls.filter(c => c === "permission").length, 1);
  await h.api.test(); assert.equal(h.calls.at(-1), "calendarPushTest");
  await h.api.disable(); assert.equal(h.owner(), ""); assert.equal(h.sub(), null); assert.equal(h.local.size, 0);
});
test("denied permission creates no subscription or server registration", async () => {
  const h = client(); h.deny(); await assert.rejects(h.api.enable(), /not allowed/);
  assert.deepEqual(h.calls, ["permission"]); assert.equal(h.sub(), null);
});
test("offline sign-out still clears local push ownership and unsubscribes", async () => {
  const h = client(); await h.api.enable(); h.offline();
  await h.api.disable(); assert.equal(h.owner(), ""); assert.equal(h.sub(), null); assert.equal(h.local.size, 0);
});
test("a different account cannot use the old device's test operation", async () => {
  const h = client(); await h.api.enable(); h.auth.currentUser = { ...h.auth.currentUser, uid: "other" };
  await assert.rejects(h.api.test(), /Enable reminders/);
  await h.api.disable(); assert.equal(h.owner(), ""); assert.equal(h.sub(), null);
});
function worker() {
  const events = {}, shown = [], messages = []; let owner = "owner", focused = false, opened = false;
  const scope = "https://feroakdemir-arch.github.io/daily-grind/";
  const context = { URL, Response, caches: { open: async () => ({ match: async () => new Response(owner), put: async (url, value) => { owner = await value.text(); } }) },
    self: { registration: { scope, showNotification: async (title, options) => shown.push({ title, options }) }, location: { origin: "https://feroakdemir-arch.github.io" },
      addEventListener: (name, fn) => { events[name] = fn; }, skipWaiting() {},
      clients: { claim: async () => {}, matchAll: async () => [{ url: scope, postMessage: m => messages.push(m), focus: async () => { focused = true; } }],
        openWindow: async () => { opened = true; } } } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../calendar-push-sw.js"), "utf8"), context);
  async function dispatch(name, fields) { let work; events[name]({ ...fields, waitUntil: p => { work = p; } }); await work; }
  return { events, shown, messages, dispatch, focused: () => focused, opened: () => opened };
}
test("worker displays only the current owner's push and rejects external navigation", async () => {
  const h = worker(); const payload = { owner: "owner", title: "Calendar reminder", body: "Study at 2 PM", tag: "event-1", url: "?calendar=1&date=2026-09-08" };
  await h.dispatch("push", { data: { json: () => payload } }); assert.equal(h.shown.length, 1);
  await h.dispatch("push", { data: { json: () => ({ ...payload, owner: "other" }) } }); assert.equal(h.shown.length, 1);
  await h.dispatch("push", { data: { json: () => ({ ...payload, url: "https://evil.test" }) } }); assert.equal(h.shown.length, 1);
  assert.equal(h.events.fetch, undefined, "push worker must not cache app data");
});
test("notification click focuses and messages the open app without reloading its drafts", async () => {
  const h = worker();
  await h.dispatch("notificationclick", { notification: { close() {}, data: { url: "?calendar=1&date=2026-09-08" } } });
  assert.equal(h.focused(), true); assert.equal(h.opened(), false); assert.equal(h.messages[0].type, "OPEN_CALENDAR");
  assert.equal(h.messages[0].date, "2026-09-08");
});
