// Note ink / text boxes / screenshots are stored once (in the id maps), not twice. The compact form must
// load back to exactly the same notes, and must shrink handwritten pages.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const context = { TextEncoder };
vm.runInNewContext(
  html.slice(html.indexOf("function _mainRichness("), html.indexOf("function _validStorageValue(")) +
  html.slice(html.indexOf("const DEFAULT_HABIT_SECTIONS ="), html.indexOf("function parseCalendarData(")) +
  html.slice(html.indexOf("function normalizeNoteSections("), html.indexOf("function localDateStr(")) +
  html.slice(html.indexOf("function textByteSize("), html.indexOf("const accountSizeCache")), context);

const stroke = (id, n) => ({ id, color: "#ffffff", width: 2, points: Array.from({ length: n }, (_, i) => [i % 900 + 0.5, i % 690 + 0.5]) });
const account = () => context.parseMainData(JSON.stringify({
  habitSections: [], taskLists: [],
  notes: [
    { id: "ink", title: "Handwritten", body: "", drawing: [stroke("s1", 800), stroke("s2", 400)], textBoxes: [{ id: "b1", x: 10, y: 20, width: 120, pageWidth: 800, text: "label" }] },
    { id: "legacy", title: "Old page", body: "typed", drawing: [stroke("s3", 50)] }, // ink only on the note (older format)
    { id: "plain", title: "Plain", body: "just text" },
  ],
  noteDrawings: { ink: [stroke("s1", 800), stroke("s2", 400)], gone: [stroke("x", 500)] }, // "gone": note was deleted
}));
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the compact form loads back to the same notes", () => {
  const data = account();
  const reloaded = context.parseMainData(context.serializeMainData(data));
  assert.deepEqual(plain(reloaded.notes), plain(data.notes));
});

test("handwriting is stored once and orphaned ink of deleted pages is dropped", () => {
  const data = account();
  const compact = context.serializeMainData(data);
  const saved = JSON.parse(compact);
  assert.ok(saved.notes.every((note) => !("drawing" in note) && !("textBoxes" in note) && !("images" in note)));
  assert.deepEqual(Object.keys(saved.noteDrawings).sort(), ["ink", "legacy"]);
  assert.equal(saved.noteImages.plain, undefined);
  assert.ok(compact.length < JSON.stringify(data).length * 0.6, `${compact.length} vs ${JSON.stringify(data).length}`);
});

test("the size estimate for the open page matches the real saved size", () => {
  const data = account();
  const note = data.notes[0];
  const exact = context.textByteSize(context.serializeMainData(data));
  const others = { ...data, notes: data.notes.filter((entry) => entry.id !== note.id) };
  const estimate = context.textByteSize(context.serializeMainData(others)) + context.textByteSize(JSON.stringify(note)) + 64;
  assert.ok(estimate >= exact && estimate - exact < 200, `${estimate} vs ${exact}`);
});
