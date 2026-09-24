const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const c = {};
vm.runInNewContext(html.slice(html.indexOf("function calendarTimeMinutes("), html.indexOf("function makeId(")), c);
const ev = (id, start, end = "23:00") => ({ id, start, end });

test("an event before \"Day starts at\" pulls the grid start up so it is visible", () => {
  assert.equal(c.calendarFirstHour([[ev("a", "09:00")], [ev("fajr", "05:30", "06:00")]], 6), 5);
  assert.equal(c.calendarFirstHour([[ev("a", "09:00")], []], 6), 6);          // nothing early: keep the setting
  assert.equal(c.calendarFirstHour([[ev("late", "00:15", "01:00")]], 8), 0);
});

test("past-midnight mode: a day's early events belong to the previous column, except in the first column", () => {
  const week = [[ev("mon-early", "01:00", "01:30")], [ev("tue-early", "01:00", "01:30"), ev("tue", "09:00")]];
  // Day ends at 2 AM (hour 26): Tuesday 1 AM is drawn under Monday, so Tuesday's own column drops it.
  assert.deepEqual(c.calendarOwnColumnEvents(week[1], 1, 26).map(e => e.id), ["tue"]);
  assert.deepEqual(c.calendarOwnColumnEvents(week[0], 0, 26).map(e => e.id), ["mon-early"]);
  // Without past-midnight hours nothing is handed to another column.
  assert.deepEqual(c.calendarOwnColumnEvents(week[1], 1, 23).map(e => e.id), ["tue-early", "tue"]);
  // Only Monday's own early event moves the grid start; Tuesday's is already shown under Monday.
  assert.equal(c.calendarFirstHour([week[0], c.calendarOwnColumnEvents(week[1], 1, 26)], 6), 1);
  assert.equal(c.calendarFirstHour([[], c.calendarOwnColumnEvents(week[1], 1, 26)], 6), 6);
});
