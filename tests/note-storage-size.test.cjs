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
  const estimate = context.textByteSize(context.serializeMainData(others)) + context.textByteSize(JSON.stringify({ ...note, drawing: context.packNoteDrawing(note.drawing) })) + 64;
  assert.ok(estimate >= exact && estimate - exact < 200, `${estimate} vs ${exact}`);
});

// Packed ink: each stroke's points are saved as one short string and must come back exactly.
const ink = (points) => [{ id: "s", color: "#ff00aa", width: 2, space: "page", pageWidth: 800, points }];
const roundTrip = (points) => context.normalizeNoteDrawing(context.packNoteDrawing(ink(points)))[0].points;

test("packed points come back as exactly the same numbers", () => {
  const points = [[296, 563.8], [296.1, 563.7], [0, 0], [799.9, 1250.3], [300, 0.1], [10.5, 199999.9]];
  assert.ok(typeof context.packNoteDrawing(ink(points))[0].points === "string");
  assert.deepEqual(plain(roundTrip(points)), points);
  assert.deepEqual(plain(roundTrip([[5, 6]])), [[5, 6]]); // a dot
  const wobble = Array.from({ length: 2000 }, (_, i) => [Math.round(((i * 7919) % 8000)) / 10, Math.round(((i * 104729) % 100000)) / 10]);
  assert.deepEqual(plain(roundTrip(wobble)), wobble);
});

test("a stroke finer than a tenth is left as plain pairs, never rounded", () => {
  const points = [[1.25, 2], [3, 4]];
  assert.deepEqual(plain(context.packNoteDrawing(ink(points))[0].points), points);
  assert.deepEqual(plain(roundTrip(points)), points);
});

test("packed ink is much smaller, and unpacked and packed saves both load", () => {
  const data = account();
  const packed = context.serializeMainData(data);
  // The same save the way it was written before packing: every stroke's points as [x,y] pairs.
  const saved = JSON.parse(packed);
  const unpacked = JSON.stringify({ ...saved, noteDrawings: Object.fromEntries(Object.entries(saved.noteDrawings).map(([id, strokes]) => [id, context.normalizeNoteDrawing(strokes)])) });
  assert.ok(packed.length < unpacked.length * 0.7, `${packed.length} vs ${unpacked.length}`);
  assert.deepEqual(plain(context.parseMainData(packed).notes), plain(context.parseMainData(unpacked).notes));
  // Saving what was just loaded changes nothing (same content; compared as data, not as key order).
  const again = JSON.parse(context.serializeMainData(context.parseMainData(packed)));
  assert.ok(JSON.stringify(plain(again.noteDrawings)) === JSON.stringify(saved.noteDrawings) && again.notes.length === saved.notes.length, "saving again changed the ink");
});

test("damaged packed points are refused instead of loading wrong ink", () => {
  for (const points of ["d1:", "d1:5", "d1:1,2,3", "x1:1,2", "d1:1,zz!,3,4", "d1:1,,3,4"]) {
    assert.throws(() => context.normalizeNoteDrawing(ink(points)), /invalid/i, points);
  }
});
