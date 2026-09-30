// The pomodoro's task (Sep 30): which task list item "working on" points to, so checking it off in the
// pomodoro checks it off in the list too.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(require.resolve("../index.html"), "utf8").replace(/\r\n/g, "\n");
const storage = new Map();
const c = { localStorage: { getItem: (k) => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) } };
vm.runInNewContext(html.slice(html.indexOf("const POMO_FOCUS_KEY"), html.indexOf("// The account as this device last stored it")), c);

const lists = [
  { id: "main", title: "Main", items: [{ id: "t1", name: "Finish project check in", points: 10, done: false }, { id: "t2", name: "Essay", points: 20, done: true }] },
  { id: "daily", title: "Daily", items: [{ id: "t3", name: "Read", points: 5, done: false }, { id: "t4", name: "read", points: 5, done: false }] },
];
const hit = (result) => result && `${result.list.id}/${result.task.id}`;

test("a task sent from the list is found by its id, even after it moved or was renamed", () => {
  assert.equal(hit(c.findPomoTask(lists, { taskId: "t1" }, "anything")), "main/t1");
  const moved = [{ id: "main", title: "Main", items: [] }, { id: "daily", title: "Daily", items: [{ ...lists[0].items[0], name: "Renamed" }] }];
  assert.equal(hit(c.findPomoTask(moved, { taskId: "t1" }, "Finish project check in")), "daily/t1");
});

test("a typed name links to the one task with exactly that name", () => {
  assert.equal(hit(c.findPomoTask(lists, null, "  finish PROJECT check in ")), "main/t1");
  assert.equal(hit(c.findPomoTask(lists, null, "Essay")), "main/t2", "a finished task with that name still shows as done");
  assert.equal(c.findPomoTask(lists, null, "Read"), null, "two unfinished tasks with that name: not guessed");
  assert.equal(c.findPomoTask(lists, null, "Something else"), null);
  assert.equal(c.findPomoTask(lists, null, ""), null);
  assert.equal(hit(c.findPomoTask(lists, { taskId: "deleted" }, "Essay")), "main/t2", "a deleted link falls back to the name");
});

test("the pomodoro's task is remembered on this device", () => {
  assert.deepEqual({ ...c.readPomoFocus() }, { name: "", taskId: null });
  storage.set("dg-pomo-focus-v1", JSON.stringify({ name: "Essay", taskId: "t2" }));
  assert.deepEqual({ ...c.readPomoFocus() }, { name: "Essay", taskId: "t2" });
  storage.set("dg-pomo-focus-v1", "not json");
  assert.deepEqual({ ...c.readPomoFocus() }, { name: "", taskId: null });
});
