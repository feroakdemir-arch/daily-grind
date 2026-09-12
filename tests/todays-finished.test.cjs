const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const c = {};
vm.runInNewContext(html.slice(html.indexOf('function finishedTasksForDay('), html.indexOf('function TodaysFinishedTasks(')), c);
test('today combines completed tasks across lists and excludes pending, older and undated items', () => {
  const lists = [{id:'one',title:'School',items:[{id:'a',name:'Homework',done:true,doneDate:'2026-09-11',points:10},{id:'b',done:false,doneDate:'2026-09-11'},{id:'c',done:true,doneDate:'2026-09-10'},{id:'legacy',done:true}]},{id:'two',title:'Daily',items:[{id:'d',name:'Study',done:true,doneDate:'2026-09-11',points:20,trackedSeconds:120}]}];
  const before = JSON.stringify(lists), result = c.finishedTasksForDay(lists,'2026-09-11');
  assert.equal(result.length,2); assert.equal(result[1].trackedSeconds,120);
  assert.equal(result.reduce((sum,t)=>sum+t.points,0),30);
  assert.equal(c.finishedTasksForDay(lists,'2026-09-12').length,0);
  assert.equal(JSON.stringify(lists),before);
});
test('archived completions remain available without double-counting their live task', () => {
  const lists=[{id:'a',title:'Daily',items:[{id:'t_with_underscores',name:'Task',done:true,doneDate:'2026-09-11'}],completedLog:[{id:'c_t_with_underscores_2026-09-11',name:'Task',date:'2026-09-11'},{id:'archived',name:'Earlier completion',date:'2026-09-11'}]}];
  assert.equal(c.finishedTasksForDay(lists,'2026-09-11').length,2);
  lists[0].items[0].done=false;delete lists[0].items[0].doneDate;
  assert.equal(c.finishedTasksForDay(lists,'2026-09-11').length,2);
  assert.equal(lists[0].completedLog.length,2);
});
test('refresh schedules the next local reset rather than assuming a fixed 24-hour day', () => {
  assert.equal(c.nextFinishedTasksReset(0,new Date(2026,8,11,23,59,59)),1050);
  assert.equal(c.nextFinishedTasksReset(3,new Date(2026,8,12,2,59,59)),1050);
  assert.equal(c.nextFinishedTasksReset(3,new Date(2026,8,12,0,0,0)),3*3600000+50);
});
