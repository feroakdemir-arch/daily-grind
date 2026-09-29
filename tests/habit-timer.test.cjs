// Habit timers (Sep 29): Start/Stop on habits like tasks, time kept per day, one timer running at a time.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require.resolve("../index.html"), "utf8").replace(/\r\n/g, "\n");
const c = { localStorage: { getItem: () => null } };
vm.runInNewContext("const STORAGE_KEY = 'daily-grind-v13';\n" + html.slice(html.indexOf("function taskElapsedSeconds("), html.indexOf("function fmtTaskDuration(")), c);
const loader = {};
vm.runInNewContext(
  html.slice(html.indexOf("function _mainRichness("), html.indexOf("function _validStorageValue(")) +
  html.slice(html.indexOf("const DEFAULT_HABIT_SECTIONS ="), html.indexOf("function parseCalendarData(")) +
  html.slice(html.indexOf("function normalizeNoteSections("), html.indexOf("function localDateStr(")), loader);
c.parseMainData = loader.parseMainData;

const T0 = Date.UTC(2026, 8, 29, 14, 0, 0);
const account = () => ({
  habitSections: [{ id: "morning", title: "MORNING", items: [{ id: "read", name: "Read", points: 10 }, { id: "run", name: "Run", points: 20 }] }],
  taskLists: [{ id: "main", title: "Main", items: [{ id: "essay", name: "Essay", points: 30, done: false, trackedSeconds: 60 }] }],
  log: {}, history: {}, habitTime: {},
});
const start = (data, habitId, at, date = "2026-09-29") => ({
  ...data,
  habitSections: data.habitSections.map((s) => ({ ...s, items: s.items.map((h) => h.id === habitId ? { ...h, timerStartedAt: at, timerDate: date } : h) })),
});
const habit = (data, id) => data.habitSections[0].items.find((h) => h.id === id);

test("a running habit timer counts up and its time is saved for its day when stopped", () => {
  const running = start(account(), "read", T0);
  assert.equal(c.habitElapsedSeconds(running, habit(running, "read"), "2026-09-29", T0 + 90000), 90);
  const stopped = c.stopTimers(running, T0 + 90000);
  assert.equal(habit(stopped, "read").timerStartedAt, undefined);
  assert.equal(habit(stopped, "read").timerDate, undefined);
  assert.equal(stopped.habitTime["2026-09-29"].read, 90);
  // A second session the same day adds up.
  const again = c.stopTimers(start(stopped, "read", T0 + 200000), T0 + 230000);
  assert.equal(again.habitTime["2026-09-29"].read, 120);
  assert.equal(c.habitElapsedSeconds(again, habit(again, "read"), "2026-09-29"), 120);
  assert.equal(c.habitElapsedSeconds(again, habit(again, "read"), "2026-09-30"), 0, "the next day starts at zero");
});

test("stopping one timer leaves the others alone, and stopping all includes tasks", () => {
  const data = account();
  data.taskLists[0].items[0].timerStartedAt = T0;
  const both = start(data, "run", T0 + 1000);
  const onlyRun = c.stopTimers(both, T0 + 61000, (kind, item) => kind === "habit" && item.id === "run");
  assert.equal(onlyRun.habitTime["2026-09-29"].run, 60);
  assert.equal(onlyRun.taskLists[0].items[0].timerStartedAt, T0);
  const all = c.stopTimers(both, T0 + 61000);
  assert.equal(all.taskLists[0].items[0].timerStartedAt, undefined);
  assert.equal(all.taskLists[0].items[0].trackedSeconds, 60 + 61);
});

test("nothing running returns the same data object", () => {
  const data = account();
  assert.equal(c.stopTimers(data, T0), data);
});

test("the running timer is the most recently started one", () => {
  const data = account();
  data.taskLists[0].items[0].timerStartedAt = T0;
  assert.deepEqual({ ...c.findRunningTimer(data) }, { kind: "task", id: "essay", name: "Essay", startedAt: T0 });
  const later = start(data, "read", T0 + 5000);
  assert.deepEqual({ ...c.findRunningTimer(later) }, { kind: "habit", id: "read", name: "Read", startedAt: T0 + 5000 });
  assert.equal(c.findRunningTimer(account()), null);
  assert.equal(c.findRunningTimer(null), null);
  const done = account();
  done.taskLists[0].items[0] = { ...done.taskLists[0].items[0], done: true, timerStartedAt: T0 };
  assert.equal(c.findRunningTimer(done), null, "a finished task's leftover start time isn't a running timer");
});

test("saved habit time and running timers survive loading, and broken values are dropped", () => {
  const data = start(account(), "read", T0);
  data.habitTime = { "2026-09-28": { read: 300.7, run: -5, bad: "x" }, "not-a-date": { read: 10 }, "2026-09-27": "oops" };
  const loaded = c.parseMainData(JSON.stringify(data));
  assert.equal(JSON.stringify(loaded.habitTime), JSON.stringify({ "2026-09-28": { read: 300 } }));
  assert.equal(habit(loaded, "read").timerStartedAt, T0);
  assert.equal(habit(loaded, "read").timerDate, "2026-09-29");
  const broken = start(account(), "run", T0, "yesterday");
  assert.equal(habit(c.parseMainData(JSON.stringify(broken)), "run").timerStartedAt, undefined, "a timer without a valid day is stopped");
});
