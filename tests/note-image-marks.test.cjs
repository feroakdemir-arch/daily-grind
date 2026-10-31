// Pen strokes and text boxes drawn on (or beside) a screenshot. In the app they sit in the page's drawing and
// textBoxes with the screenshot's imageId; saved, they live in their own noteImageMarks map so an older app
// copy, which rewrites noteDrawings / noteTextBoxes without them, carries them through untouched.
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

const plain = (value) => JSON.parse(JSON.stringify(value));
const ASSET = "a".repeat(64);
const shot = { id: "img1", assetId: ASSET, name: "robot.png", width: 817, height: 300 };
const paperInk = { id: "s-paper", color: "#ffffff", width: 3, space: "page", pageWidth: 900, points: [[10, 20], [40, 60.5]] };
const imageInk = { id: "s-image", color: "#ff922b", width: 3, space: "page", pageWidth: 817, imageId: "img1", points: [[100, 50], [900.5, 120]] };
const paperBox = { id: "b-paper", text: "for robots", x: 0, y: 40, width: 120, pageWidth: 900 };
const imageBox = { id: "b-image", text: "this is the eye", x: 830, y: 80, width: 140, pageWidth: 817, imageId: "img1" };
const account = (note = {}) => context.parseMainData(JSON.stringify({
  habitSections: [], taskLists: [],
  notes: [{ id: "page", title: "Robots", body: "", images: [shot], drawing: [paperInk, imageInk], textBoxes: [paperBox, imageBox], ...note }],
}));

test("marks on a screenshot load back onto the same page after saving", () => {
  const data = account();
  assert.deepEqual(plain(data.notes[0].drawing), [paperInk, imageInk]);
  assert.deepEqual(plain(data.notes[0].textBoxes), [paperBox, imageBox]);
  const reloaded = context.parseMainData(context.serializeMainData(data));
  assert.deepEqual(plain(reloaded.notes), plain(data.notes));
});

test("screenshot marks are saved apart from the page's own ink and text boxes", () => {
  const saved = JSON.parse(context.serializeMainData(account()));
  assert.deepEqual(saved.noteDrawings.page.map((stroke) => stroke.id), ["s-paper"]);
  assert.deepEqual(saved.noteTextBoxes.page.map((box) => box.id), ["b-paper"]);
  assert.deepEqual(saved.noteImageMarks.page.drawing.map((stroke) => stroke.id), ["s-image"]);
  assert.equal(typeof saved.noteImageMarks.page.drawing[0].points, "string"); // packed like other handwriting
  assert.deepEqual(saved.noteImageMarks.page.textBoxes, [imageBox]);
});

test("an older app copy that edits the page keeps the screenshot marks", () => {
  // An old copy reads the saved account, rewrites the maps it knows (here: the page ink erased, the title
  // edited) and spreads every other field through, as compactMainData and parseMainData always have.
  const old = JSON.parse(context.serializeMainData(account()));
  old.notes[0].title = "Robots, edited on the old copy";
  old.noteDrawings.page = [];
  const reloaded = context.parseMainData(JSON.stringify(old));
  assert.equal(reloaded.notes[0].title, "Robots, edited on the old copy");
  assert.deepEqual(plain(reloaded.notes[0].drawing), [imageInk]);
  assert.deepEqual(plain(reloaded.notes[0].textBoxes), [paperBox, imageBox]);
});

test("reading the in-app form again does not double the marks", () => {
  // The last-chance save and the task-ledger repair re-read the in-app data through JSON.
  const data = account();
  const again = context.parseMainData(JSON.stringify(data));
  assert.deepEqual(plain(again.notes[0].drawing), [paperInk, imageInk]);
  assert.deepEqual(plain(context.parseMainData(context.serializeMainData(again)).notes), plain(data.notes));
});

test("pages with no screenshot marks save no marks map", () => {
  const saved = JSON.parse(context.serializeMainData(account({ drawing: [paperInk], textBoxes: [paperBox] })));
  assert.equal(saved.noteImageMarks, undefined);
});

test("marks of a screenshot that is no longer on the page are dropped", () => {
  const data = account({ images: [] });
  assert.deepEqual(plain(data.notes[0].drawing), [paperInk]);
  assert.deepEqual(plain(data.notes[0].textBoxes), [paperBox]);
});

test("a screenshot mark must be anchored and name its screenshot", () => {
  const { space, pageWidth, ...unanchored } = imageInk;
  assert.throws(() => context.normalizeNoteDrawing([unanchored]), /invalid/);
  assert.throws(() => context.normalizeNoteDrawing([{ ...imageInk, imageId: "" }]), /invalid/);
  assert.throws(() => context.normalizeNoteTextBoxes([{ ...imageBox, imageId: 7 }]), /invalid/);
});

test("the PDF shrinks a screenshot so marks in the space beside it still fit", () => {
  const pdfContext = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../note-pdf.js"), "utf8"), pdfContext);
  const { markReach } = pdfContext.window.notePdf;
  assert.equal(markReach([], []), 1);
  // imageInk reaches x = 900.5 (+1.5 half width) on an image shown 817 wide; imageBox ends at 830 + 140 = 970.
  assert.equal(markReach([imageInk], []), 902 / 817);
  assert.equal(markReach([imageInk], [imageBox]), 970 / 817);
});

test("a screenshot is shown narrow enough for the marks beside it to stay in its row", () => {
  const reachContext = {};
  vm.runInNewContext(html.slice(html.indexOf("function noteMarkScale("), html.indexOf("function noteStrokeShape(")), reachContext);
  const reach = (drawing, boxes) => reachContext.noteMarkReach(drawing, boxes, "img1");
  assert.equal(reach([], []), 1);
  assert.equal(reach([{ ...paperInk, points: [[5000, 1]] }], []), 1); // the paper's ink doesn't count
  assert.equal(reach([imageInk], []), 900.5 / 817); // drawn out to x = 900.5 beside an image shown 817 wide
  // A text box counts by its first 40px: one placed at the row's edge (x <= row - 40) never shrinks the image.
  assert.equal(reach([], [imageBox]), (830 + 40) / 817);
});

test("a mark drawn on the screenshot on another device joins the open page", () => {
  const data = account();
  const open = data.notes[0];
  const savedSignature = context.noteSignature(open);
  const fromOtherDevice = { ...open, drawing: [...open.drawing, { ...imageInk, id: "s-remote", points: [[5, 5], [9, 9]] }] };
  const merged = context.mergeLiveNote({ ...open, drawing: [...open.drawing] }, fromOtherDevice, savedSignature, new Set());
  assert.deepEqual(plain(merged.drawing.map((stroke) => stroke.id)), ["s-paper", "s-image", "s-remote"]);
});
