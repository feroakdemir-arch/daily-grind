const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const helper = html.slice(html.indexOf("function taskDeadlinesForDate("), html.indexOf("function deadlineChip("));
const context = {};
vm.runInNewContext(helper, context);
const forDate = (lists, date = "2026-09-09") => context.taskDeadlinesForDate(lists, date);
const task = (id, deadline, extras = {}) => ({ id, name: id, deadline, ...extras });
test("date-only and timed deadlines appear on their exact dates across task lists", () => {
  const lists = [{ id: "a", items: [task("essay", "2026-09-09")] }, { id: "b", items: [task("study", "2026-09-09T13:30"), task("later", "2026-09-10")] }];
  const items = forDate(lists);
  assert.equal(items.length, 2); assert.equal(items[0].time, ""); assert.equal(items[1].time, "13:30");
  assert.equal(items[1].listId, "b"); assert.equal(forDate(lists, "2026-09-10")[0].task.id, "later");
});
test("completed tasks, completed history, missing and malformed deadlines stay out", () => {
  const lists = [{ id: "a", items: [task("done", "2026-09-09", { done: true }), task("none"), task("bad", "2026-09-09T25:30"), task("bad2", "2026-09-09T13:60"), task("text", "tomorrow")], completedLog: [task("history", "2026-09-09")] }];
  assert.equal(forDate(lists).length, 0);
  assert.equal(forDate([{ items: [task("bad-date", "2026-02-30")] }], "2026-02-30").length, 0);
});
test("editing or clearing a deadline moves or removes the card without copied calendar records", () => {
  const t = task("essay", "2026-09-09"); const lists = [{ id: "a", items: [t] }];
  assert.equal(forDate(lists).length, 1);
  t.deadline = "2026-09-10T23:59";
  assert.equal(forDate(lists).length, 0); assert.equal(forDate(lists, "2026-09-10")[0].time, "23:59");
  delete t.deadline; assert.equal(forDate(lists, "2026-09-10").length, 0);
});
test("completion, deletion, and reopening follow the current task state", () => {
  const t = task("essay", "2026-09-09"); const lists = [{ id: "a", items: [t] }];
  t.done = true; assert.equal(forDate(lists).length, 0);
  t.done = false; assert.equal(forDate(lists).length, 1);
  lists[0].items = []; assert.equal(forDate(lists).length, 0);
});
test("moving a task links to its new list and rendering never mutates persisted data", () => {
  const t = task("essay", "2026-09-09"); const lists = [{ id: "old", items: [] }, { id: "new", items: [t] }];
  const before = JSON.stringify(lists); const items = forDate(lists);
  assert.equal(items[0].listId, "new"); assert.equal(items[0].task, t); assert.equal(JSON.stringify(lists), before);
  assert.equal(forDate(JSON.parse(before)).length, 1);
});
