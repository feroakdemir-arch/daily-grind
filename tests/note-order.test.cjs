// Page order in Notes: starred first, then the order pages were dragged into, new (unplaced) pages on top.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const context = {};
vm.runInNewContext(html.slice(html.indexOf("function sortNotes("), html.indexOf("function parseMainData(")), context);
const ids = (notes) => [...notes].map((note) => note.id);
const notes = [
  { id: "a", updatedAt: 1 }, { id: "b", updatedAt: 3 }, { id: "c", updatedAt: 2, pinned: true }, { id: "new", updatedAt: 9 },
];

test("without a saved order: starred first, then newest", () => {
  assert.deepEqual(ids(context.sortNotes(notes)), ["c", "new", "b", "a"]);
});

test("a dragged order holds even when a page is edited later; new pages go on top", () => {
  const edited = notes.map((note) => note.id === "a" ? { ...note, updatedAt: 50 } : note);
  assert.deepEqual(ids(context.sortNotes(edited, ["b", "a", "c"])), ["c", "new", "b", "a"]);
  assert.deepEqual(ids(context.sortNotes(edited, ["a", "b", "c", "new"])), ["c", "a", "b", "new"]);
});
