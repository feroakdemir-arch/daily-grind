const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const code=html.slice(html.indexOf('function moveHabitById('),html.indexOf('function HabitCard('));
function target(){const listeners=new Map();return {listeners,addEventListener(n,f){if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(f);},removeEventListener(n,f){listeners.get(n)?.delete(f);},emit(n,e={}){for(const f of [...(listeners.get(n)||[])])f(e);},count(){return [...listeners.values()].reduce((n,s)=>n+s.size,0);}};}
function setup(){
 const document=target(),window={...target(),scrollY:0},handle=target(),sessionRef={current:null},previews=[],drops=[];let stopped=0,scroll;
 const rows=['a','b','c'].map((id,i)=>({dataset:{habitId:id},getBoundingClientRect:()=>({top:i*100,height:100})}));
 Object.assign(handle,{closest:()=>({querySelectorAll:()=>rows}),setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}});
 const c={document,window,startDragAutoScroll:(getY,callback)=>{scroll=callback;return()=>stopped++;}};vm.runInNewContext(code,c);
 const event=(id=1,extra={})=>({pointerId:id,isPrimary:true,button:0,currentTarget:handle,clientY:50,preventDefault(){},stopPropagation(){},...extra});
 const options={sessionRef,sectionId:'s',habitId:'a',onPreview:p=>previews.push(p),onDrop:(...args)=>drops.push(args)};
 return {c,document,window,handle,sessionRef,previews,drops,event,options,stopped:()=>stopped,scroll:()=>scroll()};
}
test('only one habit and pointer can own a drag; duplicate releases commit once',()=>{
 const h=setup();h.c.startHabitPointerDrag(h.event(),h.options);
 assert.equal(h.c.startHabitPointerDrag(h.event(2),{...h.options,habitId:'b'}),null);
 h.document.emit('pointermove',h.event(2,{clientY:250}));assert.equal(h.previews.at(-1).offset,0);
 h.document.emit('pointermove',h.event(1,{clientY:250}));assert.equal(h.previews.at(-1).habitId,'a');
 h.document.emit('pointerup',h.event(2));assert.equal(h.drops.length,0);
 h.document.emit('pointerup',h.event());h.document.emit('pointerup',h.event());
 assert.deepEqual(h.drops,[['s','a','c',true]]);assert.equal(h.sessionRef.current,null);assert.equal(h.document.count(),0);assert.equal(h.handle.count(),0);assert.equal(h.window.count(),0);assert.equal(h.stopped(),1);
});
test('cancel, lost capture, hidden tab, blur and unmount all release without reordering',()=>{
 for(const reason of ['pointercancel','lostpointercapture','hidden','blur','unmount']){
  const h=setup(),cancel=h.c.startHabitPointerDrag(h.event(),h.options);
  h.document.emit('pointermove',h.event(1,{clientY:250}));
  if(reason==='hidden'){h.document.visibilityState='hidden';h.document.emit('visibilitychange');}
  else if(reason==='blur')h.window.emit('blur');else if(reason==='unmount')cancel();else (reason==='lostpointercapture'?h.handle:h.document).emit(reason,h.event());
  assert.equal(h.drops.length,0,reason);assert.equal(h.sessionRef.current,null);assert.equal(h.document.count()+h.window.count()+h.handle.count(),0);
  assert.equal(typeof h.c.startHabitPointerDrag(h.event(3),h.options),'function');
 }
});
test('a tap and secondary touch do not reorder; auto-scroll keeps the original habit',()=>{
 const h=setup();assert.equal(h.c.startHabitPointerDrag(h.event(2,{isPrimary:false}),h.options),null);
 h.c.startHabitPointerDrag(h.event(),h.options);h.document.emit('pointerup',h.event());assert.equal(h.drops.length,0);
 h.c.startHabitPointerDrag(h.event(),h.options);h.window.scrollY=200;h.scroll();assert.equal(h.previews.at(-1).offset,200);h.document.emit('pointerup',h.event());assert.equal(h.drops.length,1);
});
test('reordering uses IDs against the latest list and preserves all habit data',()=>{
 const {c}=setup();const items=[{id:'new'},{id:'a',name:'A',points:20},{id:'b'},{id:'c'}];
 const result=c.moveHabitById(items,'a','c',true);assert.equal(result.map(i=>i.id).join(','),'new,b,c,a');assert.equal(result[3],items[1]);assert.equal(items[1].id,'a');
 assert.equal(c.moveHabitById(items,'missing','c',true),items);assert.equal(c.moveHabitById(items,'a','missing',true),items);
});
