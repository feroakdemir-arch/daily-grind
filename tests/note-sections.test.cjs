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
