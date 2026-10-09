// "Done unless I slip" habits (Oct 9, item.autoDone): count as ✓ until marked ✗, and close the day as ✓.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require.resolve("../index.html"), "utf8").replace(/\r\n/g, "\n");
const c = {};
vm.runInNewContext(
  html.slice(html.indexOf("function _mainRichness("), html.indexOf("function _validStorageValue(")) +
  html.slice(html.indexOf("const DEFAULT_HABIT_SECTIONS ="), html.indexOf("function parseCalendarData(")) +
  html.slice(html.indexOf("function normalizeNoteSections("), html.indexOf("function localDateStr(")) +
  html.slice(html.indexOf("function allHabits("), html.indexOf("function taskScore(")), c);

const plain = (value) => JSON.parse(JSON.stringify(value));
const sections = [
  { id: "night", title: "NIGHT", items: [{ id: "quit", points: 12, autoDone: true }, { id: "plan", points: 10 }] },
  { id: "optional", title: "OPTIONAL", optional: true, items: [{ id: "bonusQuit", points: 5, autoDone: true }, { id: "course", points: 10 }] },
];
const day = "2026-10-09";

test("an unmarked auto-✓ habit counts as done today; a ✗ is the only way it fails", () => {
  assert.deepEqual(plain(c.withAutoDone({}, sections)), { quit: "done", bonusQuit: "done" });
  assert.equal(c.habitScore(c.withAutoDone({}, sections), sections, day), 12 + 5);
  const slipped = c.withAutoDone({ quit: "skip" }, sections);
  assert.equal(slipped.quit, "skip");
  assert.equal(c.habitScore(slipped, sections, day), -12 + 5, "a slip costs its points like any required ✗");
  assert.equal(c.withAutoDone({ quit: "neutral" }, sections).quit, "neutral");
});

test("the saved day is never changed and nothing is copied when there's nothing to add", () => {
  const saved = { plan: "done" };
  const shown = c.withAutoDone(saved, sections);
  assert.deepEqual(plain(saved), { plan: "done" });
  assert.equal(shown.plan, "done");
  const full = { quit: "done", bonusQuit: "skip" };
  assert.equal(c.withAutoDone(full, sections), full);
  assert.deepEqual(plain(c.withAutoDone(undefined, sections)), { quit: "done", bonusQuit: "done" });
});

test("closing a day stamps auto-✓ habits done, other required ones ✗, and leaves optional ones alone", () => {
  assert.deepEqual(plain(c.stampClosedDay({}, sections)), { quit: "done", plan: "skip", bonusQuit: "done" });
  assert.deepEqual(plain(c.stampClosedDay({ quit: "skip", course: "done" }, sections)), { quit: "skip", course: "done", plan: "skip", bonusQuit: "done" });
  const plainSections = [{ id: "m", title: "M", items: [{ id: "a", points: 1 }] }];
  assert.deepEqual(plain(c.stampClosedDay({}, plainSections)), { a: "skip" }, "habits without the switch close as ✗ like before");
});

test("the switch survives saving and loading the account", () => {
  const loaded = c.parseMainData(JSON.stringify({ habitSections: sections, taskLists: [], log: {}, history: {} }));
  const items = loaded.habitSections.flatMap((s) => s.items);
  assert.equal(items.find((h) => h.id === "quit").autoDone, true);
  assert.equal("autoDone" in items.find((h) => h.id === "plan"), false);
});
