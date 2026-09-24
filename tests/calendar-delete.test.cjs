const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8").replace(/\r\n/g, "\n");
const start = html.indexOf("  function calDeleteTransform(");
const source = html.slice(start, html.indexOf("\n  }\n", html.indexOf("  async function deleteCalEvent(")) + 4);

function harness({ waitMs = 1000 } = {}) {
  const state = { pending: [], saved: null, saves: 0, stored: {}, alerts: [], events: [
    { id: "cad", date: "2026-09-23", title: "CAD", start: "19:00", end: "21:00" },
    { id: "gym", date: "2026-09-23", title: "Gym", start: "07:00", end: "08:00", repeat: "daily" },
  ] };
  let resolveCopy;
  const ctx = {
    makeId: () => "caldel-" + Math.random(),
    setCalPendingDeletes: update => { state.pending = update(state.pending); },
    protectBeforeDestructive: () => new Promise(resolve => { resolveCopy = resolve; }),
    saveCalEvents: transform => { state.saves += 1; state.events = transform(state.events); return Promise.resolve(true); },
    setTimeout, CAL_DELETE_COPY_WAIT_MS: waitMs,
    localStorage: { setItem: (k, v) => { state.stored[k] = v; } },
    dataRef: { current: { habitSections: [], taskLists: [] } },
    calEventsRef: { get current() { return state.events; } },
    alert: message => state.alerts.push(message),
  };
  vm.runInNewContext(source + "; this.deleteCalEvent = deleteCalEvent; this.calDeleteTransform = calDeleteTransform;", ctx);
  const visible = () => state.pending.reduce((events, p) => p.transform(events), state.events).map(e => e.id);
  return { ctx, state, visible, copy: ok => resolveCopy(ok) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("a deleted event disappears at once but is only deleted after the safety copy", async () => {
  const { ctx, state, visible, copy } = harness();
  const done = ctx.deleteCalEvent("cad");
  assert.deepEqual(visible(), ["gym"]);          // hidden immediately
  assert.equal(state.saves, 0);                    // nothing destroyed before the copy exists
  assert.deepEqual(state.events.map(e => e.id), ["cad", "gym"]);
  copy(true); assert.equal(await done, true);
  assert.equal(state.saves, 1);
  assert.deepEqual(state.events.map(e => e.id), ["gym"]);
  assert.equal(state.pending.length, 0);
});

test("if the safety copy fails the event comes back untouched", async () => {
  const { ctx, state, visible, copy } = harness();
  const done = ctx.deleteCalEvent("cad");
  assert.deepEqual(visible(), ["gym"]);
  copy(false); assert.equal(await done, false);
  assert.equal(state.saves, 0);
  assert.deepEqual(visible(), ["cad", "gym"]);
});

test("recurring deletes: one day, this-and-following, and the whole series", () => {
  const { ctx, state } = harness();
  const one = ctx.calDeleteTransform("gym", false, "2026-09-25")(state.events).find(e => e.id === "gym");
  assert.deepEqual([...one.exceptions], ["2026-09-25"]);
  assert.equal(ctx.calDeleteTransform("gym", false, undefined, "2026-09-30")(state.events).find(e => e.id === "gym").untilDate, "2026-09-30");
  assert.equal(ctx.calDeleteTransform("gym", false, undefined, "2026-09-23")(state.events).some(e => e.id === "gym"), false);
  assert.deepEqual(ctx.calDeleteTransform("gym", true)(state.events).map(e => e.id), ["cad"]);
});

test("two quick deletes both vanish immediately and both land", async () => {
  const { ctx, state, visible } = harness();
  const copies = [];
  ctx.protectBeforeDestructive = () => new Promise(resolve => copies.push(resolve));
  vm.runInNewContext("", ctx);
  const first = ctx.deleteCalEvent("cad"), second = ctx.deleteCalEvent("gym", true);
  assert.deepEqual(visible(), []);
  copies.forEach(resolve => resolve(true));
  await Promise.all([first, second]); await tick();
  assert.deepEqual(state.events, []);
  assert.deepEqual(visible(), []);
});

test("\"All events\" removes only the chosen series, not other series with the same name and times", () => {
  const { ctx } = harness();
  const series = [
    { id: "wrestle-mon", date: "2026-09-07", title: "wrestling", start: "18:00", end: "20:00", repeat: "weekly" },
    { id: "wrestle-wed", date: "2026-09-09", title: "wrestling", start: "18:00", end: "20:00", repeat: "weekly" },
    { id: "wrestle-fri", date: "2026-09-11", title: "wrestling", start: "18:00", end: "20:00", repeat: "weekly" },
  ];
  assert.deepEqual(ctx.calDeleteTransform("wrestle-mon", true)(series).map(e => e.id), ["wrestle-wed", "wrestle-fri"]);
});

test("with no signal the delete is saved after a short wait, keeping a safety copy on the device", async () => {
  const { ctx, state, visible } = harness({ waitMs: 20 });
  const done = ctx.deleteCalEvent("cad");                 // the cloud safety copy never confirms (offline)
  assert.deepEqual(visible(), ["gym"]);
  assert.equal(state.saves, 0);
  assert.equal(await done, true);                          // it used to wait forever and never save
  assert.equal(state.saves, 1);
  assert.deepEqual(state.events.map(e => e.id), ["gym"]);
  const copy = JSON.parse(state.stored["dg-vault-local-safety"]);
  assert.equal(copy.reason, "before-calendar-delete");
  assert.deepEqual(JSON.parse(copy.calendarValue).map(e => e.id), ["cad", "gym"]);  // the pre-delete calendar
  assert.equal(state.pending.length, 0);
});
