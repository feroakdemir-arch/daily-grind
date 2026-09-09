const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const calendar = require("../functions/calendar");
const NOW = Date.parse("2026-09-08T17:50:00Z");
const event = { id: "meeting", title: "Study", date: "2026-09-08", start: "14:00", end: "15:00" };
const subscription = n => ({ endpoint: `https://fcm.googleapis.com/send/${n}`, keys: {
  p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") } });
const request = (uid, data = {}) => ({ auth: { uid, token: { firebase: { sign_in_provider: "google.com" } } }, data });
function harness() {
  const store = new Map(), sent = [];
  let tail = Promise.resolve(), clock = NOW, sendError;
  const snapshot = path => ({ id: path.split("/").at(-1), exists: store.has(path), data: () => structuredClone(store.get(path)) });
  function query(path, filters = [], cap = Infinity, after) {
    return { path, get: async () => {
      const docs = [...store.keys()].filter(p => p.startsWith(path + "/") && p.split("/").length === path.split("/").length + 1)
        .sort().map(snapshot).filter(d => filters.every(([key, value]) => d.data()[key] === value) && (!after || d.id > after.id)).slice(0, cap);
      return { docs, size: docs.length };
    }, doc: id => doc(path + "/" + id), where: (key, op, value) => query(path, [...filters, [key, value]], cap, after),
    orderBy: () => query(path, filters, cap, after), limit: n => query(path, filters, n, after), startAfter: d => query(path, filters, cap, d) };
  }
  const doc = path => ({ path, get: async () => snapshot(path) });
  const db = { collection: path => query(path), doc, runTransaction: fn => {
    const result = tail.then(async () => {
      const writes = [];
      const tx = { get: ref => ref.get(), set: (ref, value, options) => writes.push(() => store.set(ref.path, { ...(options?.merge ? store.get(ref.path) : {}), ...value })),
        update: (ref, value) => writes.push(() => store.set(ref.path, { ...store.get(ref.path), ...value })) };
      const value = await fn(tx); writes.forEach(write => write()); return value;
    });
    tail = result.catch(() => {}); return result;
  } };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  class TestDate extends Date { static now() { return clock; } }
  const mocks = {
    "firebase-admin/app": { initializeApp() {} }, "firebase-admin/firestore": { getFirestore: () => db, Timestamp: { now: () => clock, fromMillis: n => n } },
    "firebase-functions/v2/https": { onCall: (opts, fn) => fn, HttpsError }, "firebase-functions/v2/scheduler": { onSchedule: (opts, fn) => fn },
    "firebase-functions/params": { defineString: name => ({ value: () => name }), defineSecret: name => ({ value: () => name }) },
    "web-push": { sendNotification: async (sub, payload) => { if (sendError) throw sendError; sent.push({ sub, payload: JSON.parse(payload) }); } }, "./calendar": calendar
  };
  const context = { exports: {}, require: name => mocks[name] || require(name), Date: TestDate, console: { warn() {}, error() {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../functions/index.js"), "utf8") + "\nexports.deliverForTest = deliver;", context);
  function seedDevice(uid, n) {
    const sub = subscription(n), id = calendar.hash(sub.endpoint);
    store.set(`calendarPushDevices/${id}`, { uid, subscription: sub, enabled: true, enabledAt: NOW - 60000 });
    store.set(`calendarPushAccounts/${uid}`, { enabled: true, timeZone: "America/New_York" });
    store.set(`users/${uid}/data/dg-cal-events`, { value: JSON.stringify([event]) });
    return id;
  }
  return { api: context.exports, store, sent, seedDevice, time: n => { clock = n; }, fail: error => { sendError = error; } };
}
test("overlapping scheduler executions deliver one reminder per device", async () => {
  const h = harness(); h.seedDevice("owner", 1); h.seedDevice("owner", 2);
  await Promise.all([h.api.sendCalendarReminders(), h.api.sendCalendarReminders()]);
  assert.equal(h.sent.length, 2);
  await h.api.sendCalendarReminders(); assert.equal(h.sent.length, 2);
  assert.ok(h.sent.every(s => s.payload.owner === "owner" && s.payload.body === "Study starts at 2:00 PM."));
});
test("claim rechecks edits, deletion, disabled devices and account ownership", async () => {
  const reminder = calendar.dueReminders([event], "America/New_York", NOW)[0];
  for (const change of ["delete", "reschedule", "disable", "owner"]) {
    const h = harness(), id = h.seedDevice("owner", 1);
    if (change === "delete") h.store.set("users/owner/data/dg-cal-events", { value: "[]" });
    if (change === "reschedule") h.store.set("users/owner/data/dg-cal-events", { value: JSON.stringify([{ ...event, start: "15:00" }]) });
    if (change === "disable") h.store.get(`calendarPushDevices/${id}`).enabled = false;
    if (change === "owner") h.store.get(`calendarPushDevices/${id}`).uid = "other";
    await h.api.deliverForTest("owner", id, reminder);
    assert.equal(h.sent.length, 0, change);
  }
});
test("transient delivery failures retry, expired endpoints are disabled", async () => {
  const h = harness(); h.seedDevice("owner", 1);
  h.fail({ statusCode: 503 }); await h.api.sendCalendarReminders(); assert.equal(h.sent.length, 0);
  h.fail(null); h.time(NOW + 60000); await h.api.sendCalendarReminders(); assert.equal(h.sent.length, 1);
  const expired = harness(), id = expired.seedDevice("owner", 2);
  expired.fail({ statusCode: 410 }); await expired.api.sendCalendarReminders();
  assert.equal(expired.store.get(`calendarPushDevices/${id}`).enabled, false);
});
test("bad data in one account does not prevent other accounts from receiving", async () => {
  const h = harness(); h.seedDevice("a", 1); h.seedDevice("b", 2);
  h.store.set("users/a/data/dg-cal-events", { value: "corrupt" });
  await h.api.sendCalendarReminders(); assert.equal(h.sent.length, 1); assert.equal(h.sent[0].payload.owner, "b");
});
test("registration requires a real account, keeps account zone, and test/disable enforce ownership", async () => {
  const h = harness();
  await assert.rejects(h.api.calendarPushConfig({}), { code: "unauthenticated" });
  const anon = request("anonymous"); anon.auth.token.firebase.sign_in_provider = "anonymous";
  await assert.rejects(h.api.calendarPushConfig(anon), { code: "unauthenticated" });
  const first = await h.api.calendarPushRegister(request("owner", { subscription: subscription(1), timeZone: "America/New_York" }));
  const second = await h.api.calendarPushRegister(request("owner", { subscription: subscription(2), timeZone: "America/Los_Angeles" }));
  assert.equal(first.timeZone, second.timeZone);
  await h.api.calendarPushDisable(request("other", { deviceId: first.deviceId }));
  assert.equal(h.store.get(`calendarPushDevices/${first.deviceId}`).enabled, true);
  await assert.rejects(h.api.calendarPushTest(request("other", { deviceId: first.deviceId })), { code: "failed-precondition" });
  await h.api.calendarPushTest(request("owner", { deviceId: first.deviceId }));
  await assert.rejects(h.api.calendarPushTest(request("owner", { deviceId: first.deviceId })), { code: "resource-exhausted" });
  await h.api.calendarPushDisable(request("owner", { deviceId: first.deviceId }));
  assert.equal(h.store.get(`calendarPushDevices/${first.deviceId}`).enabled, false);
  assert.equal(h.store.get(`calendarPushDevices/${second.deviceId}`).enabled, true);
});
