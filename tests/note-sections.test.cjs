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
