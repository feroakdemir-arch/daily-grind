// Steps are reordered by dragging their handle, in the task list and in the Pomodoro (one editor, one list of steps).
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const code = html.slice(html.indexOf("function moveItemById("), html.indexOf("function HabitCard("));
function target() {
  const listeners = new Map();
  return { listeners, addEventListener(n, f) { if (!listeners.has(n)) listeners.set(n, new Set()); listeners.get(n).add(f); },
    removeEventListener(n, f) { listeners.get(n)?.delete(f); }, emit(n, e = {}) { for (const f of [...(listeners.get(n) || [])]) f(e); } };
}
function setup() {
  const document = target(), window = { ...target(), scrollY: 0 }, handle = target(), previews = [], drops = [];
  const rows = ["s1", "s2", "s3", "s4"].map((id, i) => ({ dataset: { stepId: id }, getBoundingClientRect: () => ({ top: i * 40, height: 40 }) }));
  let asked = "";
  Object.assign(handle, { closest: (sel) => { asked = sel; return { querySelectorAll: (rowSel) => rowSel === "[data-step-id]" ? rows : [] }; },
    setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} });
  const c = { document, window, startDragAutoScroll: () => () => {} };
  vm.runInNewContext(code, c);
  const event = (extra = {}) => ({ pointerId: 1, isPrimary: true, button: 0, currentTarget: handle, clientY: 20, preventDefault() {}, stopPropagation() {}, ...extra });
  const options = { sessionRef: { current: null }, groupId: "biz", itemId: "s1", containerSelector: "[data-task-steps]", rowSelector: "[data-step-id]",
    rowId: (row) => row.dataset.stepId, onPreview: (p) => previews.push(p), onDrop: (...args) => drops.push(args) };
  return { c, document, previews, drops, event, options, asked: () => asked };
}

test("dragging a step's handle down past two steps drops it after the third", () => {
  const h = setup();
  h.c.startRowPointerDrag(h.event(), h.options);
  assert.equal(h.asked(), "[data-task-steps]");
  h.document.emit("pointermove", h.event({ clientY: 100 }));
  assert.equal(h.previews.at(-1).itemId, "s1");
  assert.equal(h.previews.at(-1).dropId, "s3");
  h.document.emit("pointerup", h.event());
  assert.equal(JSON.stringify(h.drops), JSON.stringify([["biz", "s1", "s3", true]]));
  assert.equal(h.previews.at(-1), null);
});

test("a tap on the handle without moving reorders nothing", () => {
  const h = setup();
  h.c.startRowPointerDrag(h.event(), h.options);
  h.document.emit("pointerup", h.event());
  assert.equal(h.drops.length, 0);
});

test("the step list is reordered by id, wherever the steps are", () => {
  const steps = [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }];
  assert.equal(h2(steps, "s1", "s3", true), "s2,s3,s1,s4");
  assert.equal(h2(steps, "s4", "s1", false), "s4,s1,s2,s3");
  function h2(items, id, targetId, after) { return setup().c.moveItemById(items, id, targetId, after).map((s) => s.id).join(","); }
});
