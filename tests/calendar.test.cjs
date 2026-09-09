const test = require("node:test");
const assert = require("node:assert/strict");
const { dueReminders, parseEvents, validateSubscription, canClaim } = require("../functions/calendar");
const event = (overrides = {}) => ({ id: "meeting", title: "Study", date: "2026-09-08", start: "14:00", end: "15:00", ...overrides });
const due = (events, iso, zone = "America/New_York") => dueReminders(events, zone, Date.parse(iso));
test("reminds 10 minutes before, never early or after the catch-up window", () => {
  assert.equal(due([event()], "2026-09-08T17:49:59Z").length, 0);
  assert.equal(due([event()], "2026-09-08T17:50:00Z").length, 1);
  assert.equal(due([event()], "2026-09-08T17:52:30Z").length, 1);
  assert.equal(due([event()], "2026-09-08T17:53:01Z").length, 0);
  assert.equal(due([event()], "2026-09-08T18:00:00Z").length, 0);
});
test("midnight event is found on the previous calendar day", () => {
  const result = due([event({ start: "00:05" })], "2026-09-08T03:55:00Z");
  assert.equal(result.length, 1);
  assert.equal(result[0].date, "2026-09-08");
});
test("daily, weekly, weekdays, custom days and original dates match the calendar", () => {
  for (const repeat of ["daily", "weekly", "weekdays", "custom"]) {
    assert.equal(due([event({ repeat, repeatDays: [2] })], "2026-09-15T17:50:00Z").length, 1);
  }
  assert.equal(due([event({ repeat: "weekly" })], "2026-09-09T17:50:00Z").length, 0);
  assert.equal(due([event({ repeat: "weekdays" })], "2026-09-12T17:50:00Z").length, 0);
  assert.equal(due([event({ repeat: "custom", repeatDays: [2] })], "2026-09-09T17:50:00Z").length, 0);
  assert.equal(due([event({ repeat: "custom", repeatDays: [1] })], "2026-09-08T17:50:00Z").length, 1);
});
test("deleted, excepted, truncated, rescheduled and future series do not send stale reminders", () => {
  const now = "2026-09-15T17:50:00Z";
  assert.equal(due([], now).length, 0);
  assert.equal(due([event({ repeat: "daily", exceptions: ["2026-09-15"] })], now).length, 0);
  assert.equal(due([event({ repeat: "daily", untilDate: "2026-09-15" })], now).length, 0);
  assert.equal(due([event({ repeat: "daily", start: "15:00" })], now).length, 0);
  assert.equal(due([event({ repeat: "daily", date: "2026-09-16" })], now).length, 0);
});
test("time zones and daylight saving keep the intended local time", () => {
  assert.equal(due([event()], "2026-09-08T20:50:00Z", "America/Los_Angeles").length, 1);
  assert.equal(due([event({ date: "2026-11-05" })], "2026-11-05T18:50:00Z").length, 1);
  assert.equal(due([event({ date: "2026-03-08", start: "02:30" })], "2026-03-08T07:20:00Z").length, 0);
  const fall = event({ date: "2026-11-01", start: "01:30" });
  assert.equal(due([fall], "2026-11-01T05:20:00Z").length, 1);
  assert.equal(due([fall], "2026-11-01T06:20:00Z").length, 0);
});
test("occurrence keys survive retries but change for another date or start time", () => {
  const e = event({ repeat: "daily" });
  const a = due([e], "2026-09-08T17:50:00Z")[0];
  assert.equal(a.key, due([e], "2026-09-08T17:51:00Z")[0].key);
  assert.notEqual(a.key, due([e], "2026-09-09T17:50:00Z")[0].key);
  assert.notEqual(a.key, due([event({ start: "15:00" })], "2026-09-08T18:50:00Z")[0].key);
});
test("malformed calendar fails closed", () => {
  for (const raw of ["bad", "null", "{}", '[null]', JSON.stringify([event({ date: "2026-02-30" })]), JSON.stringify([event({ start: "24:00" })])]) {
    assert.throws(() => parseEvents(raw));
  }
  assert.deepEqual(parseEvents(JSON.stringify([event()])), [event()]);
});
test("subscriptions reject private networks, redirects via credentials and lookalike hosts", () => {
  const keys = { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") };
  for (const endpoint of ["http://fcm.googleapis.com/send/a", "https://127.0.0.1/a", "https://fcm.googleapis.com.evil.test/a", "https://fcm.googleapis.com@evil.test/a", "https://fcm.googleapis.com:444/a"]) {
    assert.throws(() => validateSubscription({ endpoint, keys }));
  }
  for (const host of ["fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com", "wns2-db5p.notify.windows.com"]) {
    assert.equal(validateSubscription({ endpoint: `https://${host}/send/a`, keys }).keys.auth, keys.auth);
  }
  assert.throws(() => validateSubscription({ endpoint: "https://fcm.googleapis.com/send/a", keys: {} }));
});
test("delivery leases, terminal states and retry cap reject duplicate claims", () => {
  assert.equal(canClaim(null, 100), true);
  assert.equal(canClaim({ state: "sending", attempts: 1, leaseUntil: 101 }, 100), false);
  assert.equal(canClaim({ state: "sending", attempts: 1, leaseUntil: 99 }, 100), true);
  for (const state of ["sent", "failed"]) assert.equal(canClaim({ state }, 100), false);
  assert.equal(canClaim({ state: "retry", attempts: 3 }, 100), false);
});
