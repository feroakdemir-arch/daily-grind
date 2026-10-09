// Editing one day of a repeating event (Oct 9): this day only / this and following / all events.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require.resolve("../index.html"), "utf8").replace(/\r\n/g, "\n");
const c = {};
vm.runInNewContext(html.slice(html.indexOf("function calEditScope("), html.indexOf("function parseCalendarData(")), c);

const plain = (value) => JSON.parse(JSON.stringify(value));
const series = () => [
  { id: "hw", date: "2026-09-04", title: "HW-->Tasks--> Business", start: "07:15", end: "09:50", color: "#fb8c00", repeat: "weekly", exceptions: ["2026-09-18", "2026-10-23"] },
  { id: "gym", date: "2026-09-01", title: "Gym", start: "12:00", end: "13:00", repeat: "daily" },
];
const edits = (extra = {}) => ({ title: "Did CS 1800 PSet 3, marketing reading", start: "07:15", end: "09:50", color: "#fb8c00", repeat: "weekly", ...extra });
// Which events show on a date (the app's own rule: start date, repeat kind, exceptions, untilDate).
const on = (events, date) => plain(events.filter((e) => {
  if (e.exceptions && e.exceptions.includes(date)) return false;
  if (e.date === date) return true;
  if (!e.repeat || e.date > date || (e.untilDate && date >= e.untilDate)) return false;
  if (e.repeat === "weekly") return new Date(e.date + "T12:00").getDay() === new Date(date + "T12:00").getDay();
  return e.repeat === "daily";
}).map((e) => e.title));

test("this day only: that date gets its own event with the edits; every other week is unchanged", () => {
  const next = c.calEditScope(series(), "hw", "2026-10-09", edits(), "day", "new1");
  assert.deepEqual(on(next, "2026-10-09"), ["Gym", "Did CS 1800 PSet 3, marketing reading"]);
  assert.deepEqual(on(next, "2026-10-02"), ["HW-->Tasks--> Business", "Gym"]);
  assert.deepEqual(on(next, "2026-10-16"), ["HW-->Tasks--> Business", "Gym"]);
  const oneOff = next.find((e) => e.id === "new1");
  assert.deepEqual(plain(oneOff), { id: "new1", date: "2026-10-09", title: "Did CS 1800 PSet 3, marketing reading", start: "07:15", end: "09:50", color: "#fb8c00" });
  assert.deepEqual(plain(next.find((e) => e.id === "hw").exceptions), ["2026-09-18", "2026-10-23", "2026-10-09"]);
  assert.equal(next.length, 3, "nothing is removed");
});

test("this day only works on the series' first day and for a new time", () => {
  const next = c.calEditScope(series(), "hw", "2026-09-04", edits({ start: "08:00", end: "10:00" }), "day", "new1");
  assert.deepEqual(on(next, "2026-09-04"), ["Gym", "Did CS 1800 PSet 3, marketing reading"]);
  assert.equal(next.find((e) => e.id === "new1").start, "08:00");
  assert.deepEqual(on(next, "2026-09-11"), ["HW-->Tasks--> Business", "Gym"]);
});

test("this and following: earlier weeks keep the old block, later weeks get the edits and keep their skips", () => {
  const next = c.calEditScope(series(), "hw", "2026-10-09", edits({ title: "HW block", start: "06:30" }), "following", "new1");
  assert.deepEqual(on(next, "2026-10-02"), ["HW-->Tasks--> Business", "Gym"]);
  assert.deepEqual(on(next, "2026-10-09"), ["Gym", "HW block"]);
  assert.deepEqual(on(next, "2026-10-16"), ["Gym", "HW block"]);
  assert.deepEqual(on(next, "2026-10-23"), ["Gym"], "a skipped later week stays skipped");
  assert.equal(next.find((e) => e.id === "hw").untilDate, "2026-10-09");
  assert.equal(next.find((e) => e.id === "new1").start, "06:30");
});

test("this and following from the first day, or all events, edits the whole series", () => {
  for (const [scope, day] of [["following", "2026-09-04"], ["all", "2026-10-09"]]) {
    const next = c.calEditScope(series(), "hw", day, edits({ title: "Renamed" }), scope, "new1");
    assert.equal(next.length, 2);
    assert.deepEqual(on(next, "2026-09-11"), ["Renamed", "Gym"]);
    assert.deepEqual(on(next, "2026-10-16"), ["Renamed", "Gym"]);
    assert.equal(next.find((e) => e.id === "hw").date, "2026-09-04", "the series keeps its start");
  }
});

test("choosing repeat None: all = one event on the edited day; following = the series stops there", () => {
  const all = c.calEditScope(series(), "hw", "2026-10-09", edits({ repeat: undefined }), "all", "new1");
  assert.deepEqual(plain(all.find((e) => e.id === "hw")), { id: "hw", date: "2026-10-09", title: "Did CS 1800 PSet 3, marketing reading", start: "07:15", end: "09:50", color: "#fb8c00" });
  const following = c.calEditScope(series(), "hw", "2026-10-09", edits({ repeat: undefined }), "following", "new1");
  assert.deepEqual(on(following, "2026-10-09"), ["Gym", "Did CS 1800 PSet 3, marketing reading"]);
  assert.deepEqual(on(following, "2026-10-16"), ["Gym"]);
  assert.deepEqual(on(following, "2026-10-02"), ["HW-->Tasks--> Business", "Gym"]);
});

test("a plain one-off event, or an unknown id, behaves as before", () => {
  const events = [{ id: "a", date: "2026-10-09", title: "A", start: "10:00", end: "11:00" }];
  assert.equal(c.calEditScope(events, "a", "2026-10-09", { title: "B", start: "10:00", end: "11:00" }, "day", "n")[0].title, "B");
  assert.equal(c.calEditScope(events, "zzz", "2026-10-09", { title: "B" }, "day", "n"), events);
});
