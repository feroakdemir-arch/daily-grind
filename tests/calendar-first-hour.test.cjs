const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const c = {};
vm.runInNewContext(html.slice(html.indexOf("function calendarTimeMinutes("), html.indexOf("function makeId(")), c);
const ev = (id, start, end = "23:00") => ({ id, start, end });
const minutes = (t) => c.calendarTimeMinutes(t);

// Mirrors getDisplayedEvents: own column from the grid start, plus next-day events before the spill cutoff.
function columns(week, configuredStart, endHour) {
  const start = c.calendarGridStartHour(week, configuredStart, endHour);
  const cutoff = c.calendarSpillCutoffMin(start, endHour);
  const drawn = week.map((events, di) => [
    ...events.filter(e => minutes(e.start) >= start * 60).map(e => e.id),
    ...(endHour >= 24 && week[di + 1] ? week[di + 1].filter(e => minutes(e.start) < cutoff).map(e => e.id + "@prev") : []),
  ]);
  return { start, drawn };
}

test("an event before \"Day starts at\" pulls the grid start up so it is visible", () => {
  assert.equal(c.calendarGridStartHour([[ev("a", "09:00")], [ev("fajr", "05:30", "06:00")]], 6, 23), 5);
  assert.equal(c.calendarGridStartHour([[ev("a", "09:00")], []], 6, 23), 6);          // nothing early: keep the setting
  assert.equal(c.calendarGridStartHour([[ev("late", "00:15", "01:00")]], 8, 23), 0);
});

test("past-midnight hours: every event is drawn exactly once and none is above the grid", () => {
  // Day ends at 2 AM (hour 26). Tuesday 1 AM is shown under Monday; Monday 1 AM has no column before it.
  const week = [[ev("mon-early", "01:00", "01:30")], [ev("tue-early", "01:00", "01:30"), ev("tue", "09:00")]];
  const both = columns(week, 6, 26);
  assert.equal(both.start, 1);
  // The grid starts at 1 AM for Monday, so Tuesday's 1 AM fits in its own column and Monday does not repeat it.
  assert.deepEqual(both.drawn, [["mon-early"], ["tue-early", "tue"]]);
  // Without Monday's early event the grid keeps 6 AM and Tuesday's 1 AM is drawn once, under Monday.
  const tuesdayOnly = columns([[], week[1]], 6, 26);
  assert.equal(tuesdayOnly.start, 6);
  assert.deepEqual(tuesdayOnly.drawn, [["tue-early@prev"], ["tue"]]);
});

test("an overnight event that stretches the grid does not duplicate next-morning events", () => {
  // Sleep 11 PM - 7 AM stretches the end to hour 30; "Day starts at" 6 AM. A 6:15 run on Tuesday used
  // to show under Monday and again in Tuesday's column.
  const week = [[ev("sleep", "23:00", "31:00")], [ev("run", "06:15", "07:00")]];
  const endHour = c.calendarLastHour(week.flat(), 23);
  assert.equal(endHour, 30);
  const { start, drawn } = columns(week, 6, endHour);
  assert.equal(start, 6);
  assert.deepEqual(drawn, [["sleep"], ["run"]]);
});
