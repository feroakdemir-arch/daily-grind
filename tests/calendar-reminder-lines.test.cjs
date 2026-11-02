// Reminder events (Nov 2): drawn as a thin line at their start time, never as a block that takes a column.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require.resolve("../index.html"), "utf8").replace(/\r\n/g, "\n");
const c = {};
vm.runInNewContext(html.slice(html.indexOf("function layoutDayEvents("), html.indexOf("function taskElapsedSeconds(")), c);
vm.runInNewContext(html.slice(html.indexOf("function calendarTimeMinutes("), html.indexOf("function makeId(")), c);
const layout = items => Object.fromEntries([...c.layoutDayEvents(items)].map(([key, value]) => [key, { ...value }]));
const plain = (value) => JSON.parse(JSON.stringify(value));
const at = (h, m = 0) => h * 60 + m;
// The calendar passes a reminder's chip span: a few minutes either side of its start.
const reminder = (key, h, m = 0) => ({ key, reminder: true, start: at(h, m) - 5, end: at(h, m) + 5 });

test("a reminder inside an event leaves the event its full width", () => {
  assert.deepEqual(layout([{ key: "wrestling", start: at(17), end: at(19) }, reminder("noFood", 18)]),
    { wrestling: { col: 0, cols: 1 }, noFood: { col: 0, cols: 1 } });
});

test("reminders never add a column to events that overlap each other", () => {
  const result = layout([
    { key: "study", start: at(19), end: at(21) }, { key: "task", start: at(19, 30), end: at(20, 30) },
    reminder("melatonin", 20), reminder("teeth", 20, 30),
  ]);
  assert.deepEqual(result.study, { col: 0, cols: 2 });
  assert.deepEqual(result.task, { col: 1, cols: 2 });
  assert.deepEqual(result.melatonin, { col: 0, cols: 1 });
  assert.deepEqual(result.teeth, { col: 0, cols: 1 });
});

test("a reminder between back-to-back events does not chain them into one cluster", () => {
  assert.deepEqual(layout([{ key: "a", start: at(9), end: at(10) }, reminder("r", 10), { key: "b", start: at(10), end: at(11) }]),
    { a: { col: 0, cols: 1 }, r: { col: 0, cols: 1 }, b: { col: 0, cols: 1 } });
});

test("two reminders whose chips would cover each other sit side by side; separate ones keep the full width", () => {
  const result = layout([reminder("first", 20), reminder("second", 20, 5), reminder("later", 21), { key: "sleep", start: at(21), end: at(26) }]);
  assert.deepEqual(result.first, { col: 0, cols: 2 });
  assert.deepEqual(result.second, { col: 1, cols: 2 });
  assert.deepEqual(result.later, { col: 0, cols: 1 });
  assert.deepEqual(result.sleep, { col: 0, cols: 1 });
});

// Pixels from the user's Nov 2 week (82px an hour, 18px chips): MELATONIN's line at 8 PM is y=252.
test("a chip rests above its line when an event starts there, so the event's name stays readable", () => {
  const chaplainChats = { top: 252, bottom: 282 }, wrestling = { top: 88, bottom: 118 };
  assert.equal(c.reminderChipSide(252, 18, [wrestling, chaplainChats]), "above");
});

test("a chip goes below its line when above would cover an event's time", () => {
  const task = { top: 211, bottom: 240 }; // Task 7:30-9:00: name and time end 12px above the 8 PM line
  assert.equal(c.reminderChipSide(252, 18, [task]), "below");
});

test("a chip at the very top of the grid goes below; with names on both sides the less covered side wins", () => {
  assert.equal(c.reminderChipSide(10, 18, []), "below");
  assert.equal(c.reminderChipSide(100, 18, [{ top: 80, bottom: 95 }, { top: 100, bottom: 104 }]), "below");
  assert.equal(c.reminderChipSide(100, 18, [{ top: 95, bottom: 99 }, { top: 100, bottom: 130 }]), "above");
});

test("the grid only needs a reminder's start hour, whatever end it kept", () => {
  assert.equal(c.calendarLastHour([{ start: "22:30", end: "10:00", reminder: true }], 21), 22);
  assert.equal(c.calendarLastHour([{ start: "22:30", end: "10:00" }], 21), 33, "a block ending 10:00 runs into the next morning");
});

test("saved data keeps reminder: true and drops anything else in that field", () => {
  const parsed = c.parseCalendarData([
    { id: "noFood", date: "2026-11-02", title: "No more food", start: "18:00", end: "18:15", repeat: "daily", reminder: true, edited: 1762100000000 },
    { id: "odd", date: "2026-11-02", title: "Odd", start: "09:00", end: "10:00", reminder: "yes" },
    { id: "plain", date: "2026-11-02", title: "Plain", start: "09:00", end: "10:00" },
  ]);
  assert.equal(parsed[0].reminder, true);
  assert.equal(parsed[0].id, "noFood");
  assert.equal(parsed[0].edited, 1762100000000, "the edit stamp the two-device merge needs is kept");
  assert.equal("reminder" in parsed[1], false);
  assert.equal("reminder" in parsed[2], false);
});

const series = () => [{ id: "mel", date: "2026-10-01", title: "MELATONIN", start: "20:00", end: "20:15", color: "#7c3aed", repeat: "daily" }];
const edits = (extra = {}) => ({ title: "MELATONIN", start: "20:00", end: "20:15", color: "#7c3aed", repeat: "daily", ...extra });

test("editing one day of a repeating event keeps it a reminder on that day", () => {
  const next = c.calEditScope([{ ...series()[0], reminder: true }], "mel", "2026-11-02", edits({ reminder: true, start: "21:00" }), "day", "one");
  assert.deepEqual(plain(next.find((e) => e.id === "one")), { id: "one", date: "2026-11-02", title: "MELATONIN", start: "21:00", end: "20:15", color: "#7c3aed", reminder: true });
  assert.equal(next.find((e) => e.id === "mel").reminder, true, "the series stays a reminder");
  assert.deepEqual(plain(next.find((e) => e.id === "mel").exceptions), ["2026-11-02"]);
});

test("turning Reminder on for all events, or from a day on, carries the flag; turning it off removes it", () => {
  const all = c.calEditScope(series(), "mel", "2026-11-02", edits({ reminder: true }), "all", "x");
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "mel", "the series keeps its id");
  assert.equal(all[0].reminder, true);
  const following = c.calEditScope(series(), "mel", "2026-11-02", edits({ reminder: true }), "following", "next");
  assert.equal(following.find((e) => e.id === "mel").reminder, undefined);
  assert.equal(following.find((e) => e.id === "mel").untilDate, "2026-11-02");
  assert.equal(following.find((e) => e.id === "next").reminder, true);
  const off = c.calEditScope(all, "mel", "2026-11-02", edits({ reminder: undefined }), "all", "x");
  assert.equal("reminder" in off[0], false);
});
