const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const c = {};
vm.runInNewContext(html.slice(html.indexOf("function calendarTimeMinutes("), html.indexOf("function makeId(")), c);
const event = (end = "00:59") => ({ id: "overnight", date: "2026-09-09", title: "Task", start: "22:30", end });
test("a 10:30 PM to 12:59 AM event lasts 149 minutes and survives reload", () => {
  const parsed = c.parseCalendarData([event()]);
  assert.equal(parsed[0].end, "24:59");
  assert.equal(c.calendarEndMinutes(parsed[0].start, parsed[0].end) - c.calendarTimeMinutes(parsed[0].start), 149);
  assert.equal(c.parseCalendarData(JSON.stringify(parsed))[0].end, "24:59");
  assert.equal(parsed[0].date, "2026-09-09");
});
test("extended stored hours show valid time inputs and correct AM/PM labels", () => {
  assert.equal(c.calendarClockTime("24:59"), "00:59");
  assert.equal(c.calendarTimeLabel("24:59"), "12:59 AM (+1 day)");
  assert.equal(c.calendarTimeLabel("25:30"), "1:30 AM (+1 day)");
  assert.equal(c.calendarTimeLabel("12:59"), "12:59 PM");
  assert.equal(c.calendarTimeLabel("36:59"), "12:59 PM (+1 day)");
});
test("midnight, same-day events and explicit next-day values preserve duration", () => {
  assert.equal(c.parseCalendarData([event("00:00")])[0].end, "24:00");
  assert.equal(c.parseCalendarData([event("23:45")])[0].end, "23:45");
  assert.equal(c.parseCalendarData([event("25:30")])[0].end, "25:30");
  assert.equal(c.parseCalendarData([event("12:59")])[0].end, "36:59");
  assert.throws(() => c.parseCalendarData([event("")]));
});
test("grid extends to cover overnight events and preserves a later configured end", () => {
  assert.equal(c.calendarLastHour([event()], 23), 24);
  assert.equal(c.calendarLastHour([event("04:15")], 23), 28);
  assert.equal(c.calendarLastHour([event()], 28), 28);
  assert.equal(c.calendarLastHour([], 23), 23);
});
test("normalization keeps recurring-event identities and exceptions intact", () => {
  const original = { ...event(), repeat: "weekly", exceptions: ["2026-09-16"], untilDate: "2026-10-01" };
  const result = c.parseCalendarData([original])[0];
  assert.equal(result.id, original.id); assert.equal(result.repeat, "weekly");
  assert.equal(result.exceptions[0], "2026-09-16"); assert.equal(result.untilDate, original.untilDate);
  assert.equal(original.end, "00:59");
});
