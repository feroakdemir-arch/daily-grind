const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const c = {};
vm.runInNewContext(html.slice(html.indexOf('function splitDoneTasks('), html.indexOf('function TodaysFinishedTasks(')), c);
test('switching a daily list to one-time gives finished tasks their check back and drops their archive rows', () => {
  const list = { id: 'tl_today', title: "Today's Tasks", resetsDaily: true,
    items: [{ id: 'hw_a', name: 'discrete hw', done: false }, { id: 'never', name: 'python hw', done: false },
      { id: 'now', name: 'econ', done: true, doneDate: '2026-10-28' }],
    completedLog: [{ id: 'c_hw_a_2026-10-26', name: 'discrete hw', date: '2026-10-26' }, { id: 'c_hw_a_2026-10-27', name: 'discrete hw', date: '2026-10-27' },
      { id: 'c_gone_2026-10-27', name: 'deleted task', date: '2026-10-27' }] };
  const before = JSON.stringify(list);
  const next = c.setListRepeats(list, false);
  assert.equal(next.resetsDaily, false);
  assert.deepEqual(next.items.map((t) => [t.id, t.done, t.doneDate]), [['hw_a', true, '2026-10-27'], ['never', false, undefined], ['now', true, '2026-10-28']]);
  // The restored task now stands for its latest finish, so only that archive row would double it; older days stay.
  assert.deepEqual(next.completedLog.map((e) => e.id), ['c_hw_a_2026-10-26', 'c_gone_2026-10-27']);
  assert.equal(JSON.stringify(list), before);
});
test("the built-in Today's Tasks list turns one-time once, and a later choice of Daily sticks", () => {
  const data = { taskLists: [
    { id: 'tl_today', resetsDaily: true, items: [{ id: 'a', done: false }], completedLog: [{ id: 'c_a_2026-10-27', date: '2026-10-27' }] },
    { id: 'videos', resetsDaily: true, items: [{ id: 'v', done: false }], completedLog: [{ id: 'c_v_2026-10-27', date: '2026-10-27' }] }] };
  const once = c.migrateTodayListOneTime(data);
  assert.equal(once.todayListOneTime, true);
  assert.deepEqual(once.taskLists.map((l) => [l.id, l.resetsDaily, l.items[0].done]), [['tl_today', false, true], ['videos', true, false]]);
  const choseDaily = { ...once, taskLists: once.taskLists.map((l) => ({ ...l, resetsDaily: true })) };
  assert.equal(c.migrateTodayListOneTime(choseDaily), null);
});
test('switching a one-time list to daily only flips the flag', () => {
  const list = { id: 'l', resetsDaily: false, items: [{ id: 'a', done: true, doneDate: '2026-10-20' }], completedLog: [] };
  const next = c.setListRepeats(list, true);
  assert.equal(next.resetsDaily, true);
  assert.deepEqual(next.items, list.items);
});
