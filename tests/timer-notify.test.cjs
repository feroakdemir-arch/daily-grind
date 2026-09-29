// The running-timer notification (timer-notify.js) against a fake notification worker.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../timer-notify.js"), "utf8");
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function phone({ permission = "granted", storage = new Map() } = {}) {
  const shown = [];
  const reg = {
    active: {},
    showNotification: async (title, options) => { shown.push({ title, ...options, open: true }); },
    getNotifications: async ({ tag }) => shown.filter((n) => n.open && n.tag === tag).map((n) => ({ close: () => { n.open = false; } })),
  };
  const Notification = { permission, requestPermission: async () => { Notification.permission = "granted"; return "granted"; } };
  const sandbox = {
    isSecureContext: true, Notification, URL, Date, Promise, console: { warn() {} },
    location: { href: "https://example.test/daily-grind/" },
    navigator: { serviceWorker: { getRegistration: async () => reg, register: async () => reg } },
    localStorage: { getItem: (k) => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return { api: sandbox.timerNotify, shown, open: () => shown.filter((n) => n.open), storage, Notification };
}
const timer = (startedAt, id = "essay") => ({ kind: "task", id, name: "Essay", startedAt });

test("starting a timer posts one lock-screen notification; stopping removes it", async () => {
  const p = phone();
  await p.api.sync(timer(Date.now()));
  assert.equal(p.open().length, 1);
  assert.equal(p.open()[0].title, "⏱ Essay");
  assert.match(p.open()[0].body, /^Timer running since /);
  await p.api.sync(timer(p.open()[0].timestamp)); // the same timer again (another save): nothing new
  assert.equal(p.shown.length, 1);
  await p.api.sync(null);
  assert.equal(p.open().length, 0);
});

test("switching to another timer replaces the notification", async () => {
  const p = phone();
  await p.api.sync(timer(Date.now(), "a"));
  await p.api.sync(timer(Date.now() + 1, "b"));
  assert.equal(p.open().length, 1);
  assert.equal(p.shown.length, 2);
});

test("a timer already running when the app opens doesn't post again, even after a reload", async () => {
  const storage = new Map();
  const first = phone({ storage });
  const t = timer(Date.now());
  await first.api.sync(t);
  const reopened = phone({ storage });
  await reopened.api.sync(t);
  assert.equal(reopened.shown.length, 0, "already posted on this device");
  const old = phone();
  await old.api.sync(timer(Date.now() - 10 * 60 * 1000));
  assert.equal(old.shown.length, 0, "started 10 minutes ago somewhere else: no new notification");
});

test("the first timer asks for permission and gets its notification once allowed", async () => {
  const p = phone({ permission: "default" });
  let allow;
  p.Notification.requestPermission = () => new Promise((resolve) => { allow = () => { p.Notification.permission = "granted"; resolve("granted"); }; });
  p.api.askPermission();
  await p.api.sync(timer(Date.now()));
  assert.equal(p.shown.length, 0, "not allowed yet");
  allow(); await settle();
  assert.equal(p.open().length, 1);
  assert.equal(p.shown.length, 1);
});

test("allowing while the first update is still running posts only once", async () => {
  const p = phone({ permission: "default" });
  p.api.askPermission(); // this fake allows at once
  await p.api.sync(timer(Date.now()));
  await settle();
  assert.equal(p.shown.length, 1);
});

test("no permission, no notification", async () => {
  const p = phone({ permission: "denied" });
  p.api.askPermission();
  await p.api.sync(timer(Date.now()));
  await settle();
  assert.equal(p.shown.length, 0);
});
