const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../note-markdown.js'), 'utf8'), context);
const md = context.window.noteMarkdown;

test('headings, bold, italic and code render', () => {
  assert.equal(md.render('# Title'), '<h1>Title</h1>');
  assert.equal(md.render('## Why **I** go'), '<h2>Why <strong>I</strong> go</h2>');
  assert.equal(md.render('a *b* `c<d>`'), '<p>a <em>b</em> <code>c&lt;d&gt;</code></p>');
});

test('HTML in a note is escaped, never injected', () => {
  const html = md.render('<script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('only http, https and mailto links become links', () => {
  assert.equal(md.render('[go](https://a.com/x?y=1&z=2)'), '<p><a href="https://a.com/x?y=1&amp;z=2" target="_blank" rel="noopener noreferrer">go</a></p>');
  assert.equal(md.render('[bad](javascript:alert(1))'), '<p>[bad](javascript:alert(1))</p>');
});

test('single line breaks inside a paragraph are kept', () => {
  assert.equal(md.render('one\ntwo\n\nthree'), '<p>one<br>two</p><p>three</p>');
});

test('lists nest by indentation and keep numbering', () => {
  assert.equal(md.render('- a\n  - b\n- c'), '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
  assert.equal(md.render('3. x\n4. y'), '<ol start="3"><li>x</li><li>y</li></ol>');
  assert.equal(md.render('- [ ] todo\n- [x] done'), '<ul><li><span class="note-md-check">☐</span> todo</li><li><span class="note-md-check">☑</span> done</li></ul>');
});

test('tables render with alignment and a scroll wrapper', () => {
  const html = md.render('| A | B |\n|:---|---:|\n| **1** | 2 |');
  assert.equal(html, '<div class="note-md-table"><table><thead><tr><th>A</th><th style="text-align:right">B</th></tr></thead><tbody><tr><td><strong>1</strong></td><td style="text-align:right">2</td></tr></tbody></table></div>');
});

test('blockquotes can hold headings and paragraphs', () => {
  assert.equal(md.render('> ## Big\n> small'), '<blockquote><h2>Big</h2><p>small</p></blockquote>');
});

test('horizontal rules', () => {
  assert.equal(md.render('a\n\n---\n\nb'), '<p>a</p><hr><p>b</p>');
});

test('markdown pages are detected, plain notes are not', () => {
  assert.equal(md.looksLikeMarkdown('# My Mission\ntext'), true);
  assert.equal(md.looksLikeMarkdown('| a | b |\n|---|---|\n| 1 | 2 |'), true);
  assert.equal(md.looksLikeMarkdown('-meal prep\n-stop showering so long'), false);
  assert.equal(md.looksLikeMarkdown('• bullet\n☐ task\n──────────'), false);
});

test('imported pages are titled from their first heading or file name', () => {
  assert.equal(md.titleFor('# **My** Mission\nbody', 'x.md'), 'My Mission');
  assert.equal(md.titleFor('no heading here', 'mission-and-goals.md'), 'mission-and-goals');
});

test('a long real document renders without losing text', () => {
  const doc = '# Goals\n\n> ## Mission\n\n| By | Revenue |\n|---|---|\n| Oct | first |\n\n1. **Religion**\n2. Business\n\n- a\n  - b\n\n---\n\n**Bismillah. Go.**';
  const html = md.render(doc);
  for (const piece of ['Goals', 'Mission', 'Revenue', 'first', 'Religion', 'Business', 'Bismillah. Go.']) assert.ok(html.includes(piece), piece);
});
