// Subtasks (Oct 9): a task can be broken down into steps (task.subtasks = [{ id, name, done }]).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require.resolve("../index.html"), "utf8").replace(/\r\n/g, "\n");
const c = {};
vm.runInNewContext(
  html.slice(html.indexOf("function _mainRichness("), html.indexOf("function _validStorageValue(")) +
  html.slice(html.indexOf("const DEFAULT_HABIT_SECTIONS ="), html.indexOf("function parseCalendarData(")) +
  html.slice(html.indexOf("function normalizeNoteSections("), html.indexOf("function localDateStr(")), c);
const merge = {};
vm.runInNewContext(html.slice(html.indexOf("    function _hasOwn(object, key)"), html.indexOf("    // Returns the merged document text")), merge);

const lists = () => [
  { id: "main", title: "Main", items: [{ id: "essay", name: "Essay", points: 30, done: false }, { id: "other", name: "Other", points: 5, done: false }] },
  { id: "today", title: "Today", resetsDaily: true, items: [{ id: "hw", name: "Problem set 3", points: 10, done: false, subtasks: [{ id: "s1", name: "Q1", done: true }] }] },
];
const plain = (value) => JSON.parse(JSON.stringify(value));
const task = (taskLists, id) => taskLists.flatMap((list) => list.items).find((item) => item.id === id);

test("steps are added, checked off, renamed and removed on the right task, wherever it is", () => {
  const start = lists();
  let next = c.editSubtasks(start, "essay", (steps) => [...steps, { id: "a", name: "Outline", done: false }, { id: "b", name: "Draft", done: false }]);
  assert.deepEqual(plain(task(next, "essay").subtasks), [{ id: "a", name: "Outline", done: false }, { id: "b", name: "Draft", done: false }]);
  assert.equal(next[1], start[1], "other lists are left untouched");
  assert.equal(next[0].items[1], start[0].items[1], "other tasks are left untouched");
  next = c.editSubtasks(next, "essay", (steps) => steps.map((s) => s.id === "a" ? { ...s, done: true, name: "Outline v2" } : s));
  assert.deepEqual(plain(c.subtaskProgress(task(next, "essay"))), { done: 1, total: 2 });
  assert.equal(task(next, "essay").subtasks[0].name, "Outline v2");
  next = c.editSubtasks(next, "essay", (steps) => steps.filter((s) => s.id !== "a"));
  next = c.editSubtasks(next, "essay", (steps) => steps.filter((s) => s.id !== "b"));
  assert.equal("subtasks" in task(next, "essay"), false, "a task with no steps left loses the field");
  assert.deepEqual(plain(c.subtaskProgress(task(next, "essay"))), { done: 0, total: 0 });
  assert.equal(task(next, "essay").points, 30, "steps never change the task's points");
});

test("broken step data is cleaned up and duplicates are dropped", () => {
  const steps = c.normalizeSubtasks([{ id: "a", name: "One", done: true }, { id: "a", name: "Dup" }, null, "text", { name: "no id" }, { id: "b", name: 7, done: "yes" }]);
  assert.deepEqual(plain(steps), [{ id: "a", name: "One", done: true }, { id: "b", name: "", done: false }]);
  assert.deepEqual(plain(c.normalizeSubtasks("nope")), []);
});

test("steps survive saving and loading the account; empty or broken step lists are dropped", () => {
  const data = { habitSections: [], log: {}, history: {}, taskLists: lists() };
  data.taskLists[0].items[1].subtasks = "broken";
  data.taskLists[0].items[0].subtasks = [];
  const loaded = c.parseMainData(JSON.stringify(data));
  assert.deepEqual(plain(task(loaded.taskLists, "hw").subtasks), [{ id: "s1", name: "Q1", done: true }]);
  assert.equal("subtasks" in task(loaded.taskLists, "essay"), false);
  assert.equal("subtasks" in task(loaded.taskLists, "other"), false);
});

test("a daily list's new day unchecks the steps but keeps them", () => {
  const reset = c.resetSubtasks(task(lists(), "hw"));
  assert.deepEqual(plain(reset.subtasks), [{ id: "s1", name: "Q1", done: false }]);
  const none = task(lists(), "essay");
  assert.equal(c.resetSubtasks(none), none);
});

test("two devices editing different steps of one task both keep their edits", () => {
  const base = lists();
  base[0].items[0].subtasks = [{ id: "a", name: "Outline", done: false }, { id: "b", name: "Draft", done: false }];
  const phone = c.editSubtasks(plain(base), "essay", (steps) => steps.map((s) => s.id === "a" ? { ...s, done: true } : s));
  const laptop = c.editSubtasks(plain(base), "essay", (steps) => [...steps, { id: "c", name: "Cite sources", done: false }]);
  const merged = merge._merge3(plain(base), phone, laptop, "taskLists");
  assert.deepEqual(plain(task(merged, "essay").subtasks), [
    { id: "a", name: "Outline", done: true },
    { id: "b", name: "Draft", done: false },
    { id: "c", name: "Cite sources", done: false },
  ]);
});
