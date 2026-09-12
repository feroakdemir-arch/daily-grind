const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const html = fs.readFileSync(require.resolve('../index.html'),'utf8');
const code = html.slice(html.indexOf('function watchCalendarClock('),html.indexOf('function nextFinishedTasksReset('));
function harness() {
  const listeners=new Map(), timers=new Map(), ticks=[];let now=65000,id=0;
  const target={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  class ClockDate extends Date { static now(){return now;} }
  const c={window:target,document:target,Date:ClockDate,setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),localDateStr:d=>`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`};
  vm.runInNewContext(code,c);
  return {c,listeners,timers,ticks,setNow:value=>{now=value;}};
}
test('clock advances automatically and recomputes actual time after a long suspension',()=>{
  const h=harness(),stop=h.c.watchCalendarClock(now=>h.ticks.push(now));
  assert.equal(h.ticks[0],65000);assert.equal([...h.timers.values()][0].delay,55020);
  h.setNow(4*3600000);[...h.timers.values()][0].fn();
  assert.equal(h.ticks.at(-1),4*3600000);assert.equal(h.timers.size,1);stop();
});
test('focus, visibility and page restoration refresh immediately and listeners clean up',()=>{
  const h=harness(),stop=h.c.watchCalendarClock(now=>h.ticks.push(now));
  for(const name of ['focus','visibilitychange','pageshow']) { h.setNow(h.ticks.at(-1)+3600000);h.listeners.get(name)(); }
  assert.equal(h.ticks.length,4);stop();assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
});
test('the line moves forward with clock time and never appears on an unrelated week',()=>{
  const {c}=harness(),dates=Array.from({length:7},(_,i)=>new Date(2026,8,7+i));
  assert.equal(c.calendarNowPosition(new Date(2026,8,11,9,15),dates,6,23).offset,195);
  assert.equal(c.calendarNowPosition(new Date(2026,8,11,12,45),dates,6,23).offset,405);
  assert.equal(c.calendarNowPosition(new Date(2026,8,21,12),dates,6,23),null);
});
test('Monday after midnight belongs to the preceding Sunday in an overnight view',()=>{
  const {c}=harness(),previous=Array.from({length:7},(_,i)=>new Date(2026,8,7+i)),current=Array.from({length:7},(_,i)=>new Date(2026,8,14+i));
  const now=new Date(2026,8,14,1,30);
  assert.equal(c.calendarNowPosition(now,previous,6,28).dayIndex,6);
  assert.equal(c.calendarNowPosition(now,current,6,28),null);
});
