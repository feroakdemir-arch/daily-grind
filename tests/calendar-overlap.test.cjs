const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const source = html.slice(html.indexOf("function layoutDayEvents("), html.indexOf("function taskElapsedSeconds("));
const context = {};
vm.runInNewContext(source + "; this.layoutDayEvents = layoutDayEvents;", context);
const layout = items => Object.fromEntries([...context.layoutDayEvents(items)].map(([key, value]) => [key, { ...value }]));
const at = (h, m = 0) => h * 60 + m;

test("events at the same time split the column side by side", () => {
  assert.deepEqual(layout([{ key: "a", start: at(19), end: at(21) }, { key: "b", start: at(19), end: at(21) }]),
    { a: { col: 0, cols: 2 }, b: { col: 1, cols: 2 } });
});

test("back-to-back and separate events keep the full width", () => {
  assert.deepEqual(layout([{ key: "cad", start: at(19), end: at(21) }, { key: "sohbet", start: at(21), end: at(21, 45) }, { key: "sleep", start: at(22), end: at(26) }]),
    { cad: { col: 0, cols: 1 }, sohbet: { col: 0, cols: 1 }, sleep: { col: 0, cols: 1 } });
});

test("a chain of overlaps shares one column count and reuses freed columns", () => {
  const result = layout([
    { key: "long", start: at(9), end: at(12) },
    { key: "first", start: at(9, 30), end: at(10) },
    { key: "second", start: at(10), end: at(11) },
    { key: "third", start: at(10, 30), end: at(11, 30) },
  ]);
  assert.deepEqual(result.long, { col: 0, cols: 3 });
  assert.deepEqual(result.first, { col: 1, cols: 3 });
  assert.deepEqual(result.second, { col: 1, cols: 3 });
  assert.deepEqual(result.third, { col: 2, cols: 3 });
});

test("three events at once get thirds; a later event starts a new full-width cluster", () => {
  const result = layout([
    { key: "x", start: at(8), end: at(9) }, { key: "y", start: at(8), end: at(9) }, { key: "z", start: at(8, 15), end: at(8, 45) },
    { key: "later", start: at(13), end: at(14) },
  ]);
  assert.deepEqual([result.x.cols, result.y.cols, result.z.cols], [3, 3, 3]);
  assert.deepEqual(new Set([result.x.col, result.y.col, result.z.col]), new Set([0, 1, 2]));
  assert.deepEqual(result.later, { col: 0, cols: 1 });
});
