const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const context = {};
vm.runInNewContext(
  html.slice(html.indexOf("function _mainRichness("), html.indexOf("function _validStorageValue(")) +
  html.slice(html.indexOf("const DEFAULT_HABIT_SECTIONS ="), html.indexOf("function parseCalendarData(")) +
  html.slice(html.indexOf("function normalizeNoteSections("), html.indexOf("function localDateStr(")), context);
const base = () => ({ habitSections: [], taskLists: [], notes: [] });
const reload = value => context.parseMainData(JSON.stringify(value));
test("an empty section survives save and reload without a placeholder page", () => {
  const saved = reload(context.addNoteSection(base(), "School", null));
  assert.equal(saved.noteSections[0], "School"); assert.equal(saved.notes.length, 0);
  assert.equal(context.noteSectionNames(saved)[0], "School");
});
test("legacy note tags remain visible alongside explicit empty sections", () => {
  const saved = reload({ ...base(), notes: [{ id: "old", tag: "Task Notes", title: "Page" }], noteSections: ["School"] });
  assert.equal(context.noteSectionNames(saved).join(","), "School,Task Notes");
  assert.equal(saved.notes[0].title, "Page");
});
test("creating a section preserves unsaved writing from the open page", () => {
  const draft = { id: "draft", title: "Essay", body: "Latest unsaved paragraph", tag: "School", pinned: false, createdAt: 1 };
  const current = base(); const before = JSON.stringify(current);
  const saved = reload(context.addNoteSection(current, "Research", draft));
  assert.equal(saved.notes.length, 1); assert.equal(saved.notes[0].body, draft.body);
  assert.equal(saved.notes[0].tag, "School"); assert.equal(JSON.stringify(current), before);
  const updated = context.addNoteSection(saved, "Research", { ...draft, body: "Newest version" });
  assert.equal(updated.notes.length, 1); assert.equal(updated.notes[0].body, "Newest version");
});
test("duplicate sections normalize once; blank drafts do not create phantom pages", () => {
  const saved = reload(context.addNoteSection({ ...base(), noteSections: [" School ", "School", 12, null, ""] }, "School", { title: "", body: "", tag: "School" }));
  assert.equal(saved.noteSections.length, 1); assert.equal(saved.notes.length, 0);
});
test("removing the last page does not remove an explicitly created section", () => {
  const saved = reload(context.addNoteSection(base(), "School", null));
  saved.notes = [{ id: "p", title: "Page", tag: "School" }];
  const withoutPage = reload({ ...saved, notes: [] });
  assert.equal(context.noteSectionNames(withoutPage)[0], "School");
});
test("empty sections count as real account data for the anti-clobber guard", () => {
  const blank = base(); const sectionOnly = context.addNoteSection(blank, "School", null);
  assert.equal(context._mainRichness(JSON.stringify(blank)), 0);
  assert.equal(context._mainRichness(JSON.stringify(sectionOnly)), 3);
  assert.equal(reload(JSON.parse(JSON.stringify(sectionOnly))).noteSections[0], "School");
});
test("deleting a section alone moves its pages to Quick Notes and preserves task links", () => {
  const current = { ...base(), noteSections: ["Classes", "Work"], notes: [{ id: "p", title: "Math", body: "Keep this", tag: "Classes" }, { id: "q", tag: "Work" }], taskLists: [{ id: "tasks", items: [{ id: "t", noteId: "p" }] }] };
  const before = JSON.stringify(current);
  const next = context.removeNoteSection(current, "Classes", false, 123);
  assert.equal(next.notes.length, 2); assert.equal(next.notes[0].tag, "");
  assert.equal(next.notes[0].body, "Keep this"); assert.equal(next.notes[0].updatedAt, 123);
  assert.equal(next.taskLists[0].items[0].noteId, "p");
  assert.equal(context.noteSectionNames(next).join(","), "Work"); assert.equal(JSON.stringify(current), before);
});
test("deleting section and pages removes only matching pages and unlinks active and completed tasks", () => {
  const current = { ...base(), noteSections: ["Classes", "Work"], notes: [{ id: "p", tag: "Classes" }, { id: "q", tag: "Work" }], taskLists: [{ id: "tasks", items: [{ id: "t", noteId: "p", name: "Keep task" }, { id: "u", noteId: "q" }], completedLog: [{ id: "v", noteId: "p" }] }] };
  const next = reload(context.removeNoteSection(current, "Classes", true));
  assert.equal(next.notes.length, 1); assert.equal(next.notes[0].id, "q");
  assert.equal(next.taskLists[0].items[0].name, "Keep task");
  assert.equal(next.taskLists[0].items[0].noteId, undefined);
  assert.equal(next.taskLists[0].completedLog[0].noteId, undefined);
  assert.equal(next.taskLists[0].items[1].noteId, "q");
  assert.equal(context.noteSectionNames(next).join(","), "Work");
});
test("empty and legacy tag-only sections can be removed without reappearing", () => {
  const empty = context.removeNoteSection({ ...base(), noteSections: ["Empty"] }, "Empty", false);
  assert.equal(context.noteSectionNames(reload(empty)).length, 0);
  const legacy = context.removeNoteSection({ ...base(), notes: [{ id: "p", tag: "Legacy" }] }, "Legacy", false);
  assert.equal(context.noteSectionNames(reload(legacy)).length, 0);
  assert.equal(legacy.notes[0].tag, "");
});
const sampleDrawing = () => [{ id: "stroke-1", color: "#a78bfa", width: 3, points: [[10, 20], [200, 100], [450, 300]] }];
test("drawing-only pages save and survive JSON backup/reload", () => {
  const draft = { id: "sketch", title: "", body: "", tag: "School", drawing: sampleDrawing() };
  assert.equal(context.noteCanSave(draft, base()), true);
  const saved = reload(context.addNoteSection(base(), "School", draft));
  assert.equal(saved.notes[0].drawing[0].points.length, 3);
  assert.equal(saved.noteDrawings.sketch[0].color, "#a78bfa");
  const reloaded = reload(saved);
  assert.equal(reloaded.notes[0].drawing[0].points[2][0], 450);
});
test("drawing map survives older clients that omit drawing fields from note objects", () => {
  const oldClient = { ...base(), notes: [{ id: "sketch", title: "Title edited elsewhere", body: "Text" }], noteDrawings: { sketch: sampleDrawing() } };
  const loaded = reload(oldClient);
  assert.equal(loaded.notes[0].drawing.length, 1);
  assert.equal(loaded.notes[0].title, "Title edited elsewhere");
});
test("erasing the last stroke can save an existing page and changes its save signature", () => {
  const previous = { id: "sketch", title: "", body: "", drawing: sampleDrawing() };
  const erased = { ...previous, drawing: [] };
  assert.equal(context.noteCanSave(erased, { notes: [previous] }), true);
  assert.notEqual(context.noteSignature(previous), context.noteSignature(erased));
  const saved = reload({ ...base(), notes: [erased], noteDrawings: { sketch: [] } });
  assert.equal(saved.notes[0].drawing.length, 0);
});
test("invalid or oversized drawings fail closed and eraser checks line segments", () => {
  assert.throws(() => context.normalizeNoteDrawing([{ ...sampleDrawing()[0], points: [[NaN, 2]] }]));
  assert.throws(() => context.normalizeNoteDrawing([{ ...sampleDrawing()[0], points: Array.from({length:6001}, () => [1, 2]) }]));
  assert.equal(context.drawingStrokeHit({ width: 3, points: [[0, 0], [100, 100]] }, [50, 50]), true);
  assert.equal(context.drawingStrokeHit({ width: 3, points: [[0, 0], [100, 100]] }, [200, 10]), false);
});
test("section deletion preserves drawings when keeping pages and removes them when deleting pages", () => {
  const data = { ...base(), notes: [{ id: "sketch", tag: "School", drawing: sampleDrawing() }], noteDrawings: { sketch: sampleDrawing() } };
  assert.equal(context.removeNoteSection(data, "School", false).noteDrawings.sketch.length, 1);
  assert.equal(context.removeNoteSection(data, "School", true).noteDrawings.sketch, undefined);
});
test("legacy drawings are anchored once and never rescaled by later page growth", () => {
  const old = sampleDrawing();
  const fixed = context.anchorNoteDrawing(old, 800, 350);
  assert.equal(fixed[0].space, "page"); assert.equal(fixed[0].pageWidth, 800);
  assert.equal(fixed[0].points[2][0], 360); assert.equal(fixed[0].points[2][1], 150);
  assert.equal(context.anchorNoteDrawing(fixed, 400, 2000), fixed);
  assert.equal(old[0].points[2][1], 300);
});
test("page expansion changes only page height, not drawing coordinates", () => {
  const drawing = context.anchorNoteDrawing(sampleDrawing(), 800, 350);
  const before = JSON.stringify(drawing);
  assert.equal(context.notePaperHeight(100, drawing), 360);
  assert.equal(context.notePaperHeight(1500, drawing), 1548);
  assert.equal(JSON.stringify(drawing), before);
});
test("pixel positions and paper width survive saving, reopening and points below the old canvas", () => {
  const drawing = [{ ...sampleDrawing()[0], space: "page", pageWidth: 800, points: [[400, 100], [500, 1800]] }];
  const saved = reload({ ...base(), notes: [{ id: "sketch", title: "Page", body: "Long text" }], noteDrawings: { sketch: drawing } });
  assert.equal(saved.notes[0].drawing[0].points[1][1], 1800);
  assert.equal(saved.noteDrawings.sketch[0].space, "page");
  assert.equal(saved.noteDrawings.sketch[0].pageWidth, 800);
  assert.equal(context.notePaperHeight(100, saved.notes[0].drawing), 1848);
});
test("an open clean note adopts remote drawing updates", () => {
  const draft = { id: "page", title: "Page", body: "Text", tag: "", pinned: false, drawing: [] };
  const incoming = { ...draft, drawing: sampleDrawing() };
  const merged = context.mergeLiveNote(draft, incoming, context.noteSignature(draft));
  assert.equal(merged.drawing.length, 1);
  assert.equal(context.noteSignature(merged), context.noteSignature(incoming));
});
test("incoming ink preserves unsaved local text and incoming text preserves local ink", () => {
  const base = { id: "page", title: "Page", body: "Old", tag: "", pinned: false, drawing: [] };
  const signature = context.noteSignature(base);
  const merged = context.mergeLiveNote({ ...base, body: "Typing on desktop" }, { ...base, drawing: sampleDrawing() }, signature);
  assert.equal(merged.body, "Typing on desktop"); assert.equal(merged.drawing.length, 1);
  const reverse = context.mergeLiveNote({ ...base, drawing: sampleDrawing() }, { ...base, body: "New remote text" }, signature);
  assert.equal(reverse.body, "New remote text"); assert.equal(reverse.drawing.length, 1);
});
test("new strokes merge by ID, erasures apply, and a growing local stroke is not truncated", () => {
  const base = { id: "page", title: "Page", body: "", tag: "", pinned: false, drawing: sampleDrawing() };
  const signature = context.noteSignature(base);
  const localStroke = { ...sampleDrawing()[0], id: "local" }, remoteStroke = { ...sampleDrawing()[0], id: "remote" };
  const merged = context.mergeLiveNote({ ...base, drawing: [...base.drawing, localStroke] }, { ...base, drawing: [...base.drawing, remoteStroke] }, signature);
  assert.equal(merged.drawing.length, 3);
  assert.equal(context.mergeLiveNote(base, { ...base, drawing: [] }, signature).drawing.length, 0);
  const growing = { ...base, drawing: [{ ...base.drawing[0], points: [...base.drawing[0].points, [500, 400]] }] };
  assert.equal(context.mergeLiveNote(growing, base, signature).drawing[0].points.length, 4);
});
const textBox = () => ({ id: "box-1", text: "XOR gate", x: 420, y: 800, width: 200, pageWidth: 900 });
test("positioned text saves on a text-only page and keeps its exact coordinates after reload", () => {
  const draft = { id: "page", title: "", body: "", tag: "", textBoxes: [textBox()] };
  assert.equal(context.noteCanSave(draft, base()), true);
  const saved = reload(context.addNoteSection(base(), "School", draft));
  assert.equal(saved.notes[0].textBoxes[0].x, 420); assert.equal(saved.notes[0].textBoxes[0].y, 800);
  assert.equal(saved.noteTextBoxes.page[0].text, "XOR gate");
  assert.equal(context.noteTextContent(saved.notes[0]), "XOR gate");
});
test("text boxes remain recoverable when older clients omit them from note objects", () => {
  const saved = reload({ ...base(), notes: [{ id: "page", body: "Existing text" }], noteTextBoxes: { page: [textBox()] } });
  assert.equal(saved.notes[0].textBoxes[0].text, "XOR gate");
  assert.equal(context.noteTextContent(saved.notes[0]), "Existing text\nXOR gate");
});
test("text and drawing content are both retained through saves and section removal", () => {
  const draft = { id: "page", title: "Page", body: "Original paragraph", tag: "School", drawing: sampleDrawing(), textBoxes: [textBox()] };
  const saved = reload(context.addNoteSection(base(), "School", draft));
  const kept = context.removeNoteSection(saved, "School", false);
  assert.equal(kept.noteTextBoxes.page[0].text, "XOR gate"); assert.equal(kept.noteDrawings.page.length, 1);
  const removed = context.removeNoteSection(saved, "School", true);
  assert.equal(removed.noteTextBoxes.page, undefined);
});
test("remote text boxes merge with unsaved text and drawing changes", () => {
  const initial = { id: "page", title: "Page", body: "", tag: "", pinned: false, drawing: [], textBoxes: [] };
  const merged = context.mergeLiveNote({ ...initial, body: "Local writing", drawing: sampleDrawing() }, { ...initial, textBoxes: [textBox()] }, context.noteSignature(initial));
  assert.equal(merged.body, "Local writing"); assert.equal(merged.drawing.length, 1); assert.equal(merged.textBoxes[0].text, "XOR gate");
});
test("malformed text boxes fail closed and an empty click does not count as content", () => {
  assert.throws(() => context.normalizeNoteTextBoxes([{ ...textBox(), x: NaN }]));
  assert.throws(() => context.normalizeNoteTextBoxes([{ ...textBox(), width: -1 }]));
  assert.equal(context.noteCanSave({ id: "new", title: "", body: "", textBoxes: [{ ...textBox(), text: "" }] }, base()), false);
});
const screenshot = () => ({ id: "image-1", assetId: "a".repeat(64), name: "Screenshot.png", width: 800, height: 600 });
test("screenshots save on image-only notes and survive older client normalization", () => {
  const draft = { id: "page", title: "", body: "", tag: "School", images: [screenshot()] };
  assert.equal(context.noteCanSave(draft, base()), true);
  const saved = reload(context.addNoteSection(base(), "School", draft));
  assert.equal(saved.notes[0].images[0].assetId, screenshot().assetId);
  delete saved.notes[0].images;
  assert.equal(reload(saved).notes[0].images[0].width, 800);
});
test("image references merge live and section removal preserves or removes references appropriately", () => {
  const initial = { id: "page", title: "Page", body: "", tag: "School", pinned: false, images: [] };
  const merged = context.mergeLiveNote({ ...initial, body: "Local text" }, { ...initial, images: [screenshot()] }, context.noteSignature(initial));
  assert.equal(merged.body, "Local text"); assert.equal(merged.images.length, 1);
  const saved = reload(context.addNoteSection(base(), "School", merged));
  assert.equal(context.removeNoteSection(saved, "School", false).noteImages.page.length, 1);
  assert.equal(context.removeNoteSection(saved, "School", true).noteImages.page, undefined);
});
test("invalid screenshot references fail closed", () => {
  assert.throws(() => context.normalizeNoteImages([{...screenshot(),assetId:'https://outside.example/image'}]));
  assert.throws(() => context.normalizeNoteImages([{...screenshot(),width:NaN}]));
  assert.throws(() => context.normalizeNoteImages([screenshot(),screenshot()]));
});

test('the paper keeps a viewport of blank space below the lowest content', () => {
  const drawing = [{ id: 's', color: '#fff', width: 3, space: 'page', pageWidth: 900, points: [[10, 700], [20, 1200]] }];
  assert.equal(context.notePaperHeight(100, [], 800), 900);
  assert.equal(context.notePaperHeight(100, drawing, 800), 2000);
  assert.equal(context.notePaperHeight(100, [], 0), 360);
});

test('a hand-sized text box keeps its width flag; automatic boxes stay unflagged', () => {
  const base = { id: 'tb', text: 'T\nF', x: 10, y: 20, width: 90, pageWidth: 900 };
  assert.equal(context.normalizeNoteTextBoxes([{ ...base, sized: true }])[0].sized, true);
  assert.equal('sized' in context.normalizeNoteTextBoxes([base])[0], false);
  assert.equal('sized' in context.normalizeNoteTextBoxes([{ ...base, sized: false }])[0], false);
  assert.throws(() => context.normalizeNoteTextBoxes([{ ...base, sized: 'yes' }]));
});

test('a text box deleted before its save is confirmed does not come back from the save echo', () => {
  const page = { id: 'page', title: 'Page', body: '', tag: '', pinned: false, drawing: [], textBoxes: [], images: [] };
  const signature = context.noteSignature(page); // last confirmed save: no box yet
  const box = { id: 'textbox-new', text: 'T  F', x: 10, y: 20, width: 280, pageWidth: 900 };
  const typed = { ...page, textBoxes: [box] }, deleted = { ...page, textBoxes: [] };
  const removed = new Set(context.removedNoteItemIds(typed, deleted));
  assert.deepEqual([...removed], ['textbox-new']);
  // The echo of the pre-delete save still carries the box.
  assert.equal(context.mergeLiveNote(deleted, typed, signature, removed).textBoxes.length, 0);
  // A box another device added (never deleted here) still arrives.
  assert.equal(context.mergeLiveNote(deleted, typed, signature, new Set()).textBoxes.length, 1);
  assert.equal(context.mergeLiveNote(deleted, typed, signature).textBoxes.length, 1);
});

test('erased strokes and removed screenshots are remembered the same way', () => {
  const stroke = { id: 'stroke-1', color: '#fff', width: 3, space: 'page', pageWidth: 900, points: [[1, 1], [5, 5]] };
  const image = { id: 'image-1', assetId: 'a'.repeat(64), name: 'Screenshot', width: 10, height: 10 };
  const before = { id: 'page', drawing: [stroke], textBoxes: [], images: [image] };
  assert.deepEqual([...context.removedNoteItemIds(before, { id: 'page', drawing: [], textBoxes: [], images: [] })].sort(), ['image-1', 'stroke-1']);
  assert.deepEqual([...context.removedNoteItemIds(before, before)], []);
});
