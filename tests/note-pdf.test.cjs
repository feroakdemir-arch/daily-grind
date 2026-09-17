const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../note-pdf.js'), 'utf8'), context);
const pdf = context.window.notePdf;

test('PDF names are safe and recognizable', () => {
  assert.equal(pdf.cleanName(' My Class: Week 1 / Notes '), 'my-class-week-1-notes');
  assert.equal(pdf.cleanName(''), 'untitled-note');
});

test('light pen colors become visible on white PDF pages', () => {
  assert.equal(pdf.inkColor('#f8fafc'), '#111827');
  assert.equal(pdf.inkColor('#ffffff'), '#111827');
  assert.equal(pdf.inkColor('#7c3aed'), '#7c3aed');
  assert.equal(pdf.inkColor('invalid'), '#111827');
});

test('logical note positions continue onto following PDF pages', () => {
  assert.deepEqual({ ...pdf.pagePosition(0) }, { page: 0, y: 255 });
  assert.equal(pdf.pagePosition(1441).page, 1);
  assert.equal(pdf.pagePosition(1441).y, 90);
  assert.equal(pdf.pagePosition(3047).page, 2);
});

test('drawing lines are split at PDF page boundaries', () => {
  const points = pdf.splitLineAcrossPages(10, 1400, 30, 1500);
  assert.equal(points.length, 3);
  assert.equal(points[1].y, 1441);
  assert.ok(points[1].x > 10 && points[1].x < 30);
});
