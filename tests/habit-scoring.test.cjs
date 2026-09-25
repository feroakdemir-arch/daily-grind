// Required habits cost their points when marked ✗ (from HABIT_PENALTY_FROM on); optional habits only add.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const context = {};
vm.runInNewContext(
  html.slice(html.indexOf("const DEFAULT_HABIT_SECTIONS ="), html.indexOf("function parseCalendarData(")) +
  html.slice(html.indexOf("function allHabits("), html.indexOf("function taskScore(")), context);

const sections = [
  { id: "night", title: "NIGHT", items: [{ id: "h1", points: 12 }, { id: "h2", points: 4 }] },
  { id: "optional", title: "OPTIONAL", optional: true, items: [{ id: "o1", points: 10 }, { id: "o2", points: 5 }] },
];
const day = "2026-09-26";

test("done adds, a required ✗ subtracts its points, an optional ✗ costs nothing", () => {
  assert.equal(context.habitScore({ h1: "done", h2: "skip", o1: "done", o2: "skip" }, sections, day), 12 - 4 + 10);
});

test("neutral and unmarked habits are worth zero", () => {
  assert.equal(context.habitScore({ h1: "neutral" }, sections, day), 0);
});

test("days before the rule started keep their old scores", () => {
  assert.equal(context.habitScore({ h1: "skip", h2: "done" }, sections, "2026-09-24"), 4);
  assert.equal(context.habitScore({ h1: "skip", h2: "done" }, sections, "2026-09-25"), -8);
});

test("the day can go negative", () => {
  assert.equal(context.habitScore({ h1: "skip", h2: "skip" }, sections, day), -16);
});

test("only required habits get stamped at the end of the day", () => {
  assert.deepEqual([...context.requiredHabits(sections).map((h) => h.id)], ["h1", "h2"]);
});

test("the optional section always sits last", () => {
  const order = [...context.orderedHabitSections([sections[1], { id: "morning", items: [] }, sections[0]]).map((s) => s.id)];
  assert.deepEqual(order, ["morning", "night", "optional"]);
});
