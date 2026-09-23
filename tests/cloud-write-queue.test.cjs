const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8").replace(/\r\n/g, "\n");
const start = html.indexOf("    function _queueCloudWrite(");
const source = html.slice(start, html.indexOf("\n    }\n", start) + 6);
const tick = () => new Promise(resolve => setImmediate(resolve));

function fakeServer(path = "users/u1/data/daily-grind-v13") {
  const sent = [], pending = [];
  return { sent, pending, ref: { path, set: payload => { sent.push(payload); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } } };
}
function queue() {
  const ctx = { _cloudWriteQueues: {} };
  vm.runInNewContext(source + "; this.q = _queueCloudWrite;", ctx);
  return ctx;
}

test("saves made while an upload is in flight collapse into one upload of the newest data", async () => {
  const { q, _cloudWriteQueues } = queue(), server = fakeServer();
  const results = [1, 2, 3, 4, 5].map(n => q("main", server.ref, { value: n }).then(() => n));
  await tick();
  assert.deepEqual(server.sent.map(p => p.value), [1]);       // first goes out immediately
  server.pending.shift().resolve(); await tick();
  assert.deepEqual(server.sent.map(p => p.value), [1, 5]);    // 2,3,4 skipped: 5 contains them
  server.pending.shift().resolve();
  assert.deepEqual(await Promise.all(results), [1, 2, 3, 4, 5]); // every caller confirmed
  await tick();
  assert.equal(Object.keys(_cloudWriteQueues).length, 0);
});

test("a failed upload rejects its callers and the queue keeps going", async () => {
  const { q } = queue(), server = fakeServer();
  const first = q("main", server.ref, { value: 1 });
  const second = q("main", server.ref, { value: 2 });
  await tick();
  server.pending.shift().reject(new Error("offline"));
  await assert.rejects(first, /offline/);
  await tick();
  assert.deepEqual(server.sent.map(p => p.value), [1, 2]);
  server.pending.shift().resolve();
  await second;
});

test("writes for different documents or accounts are never merged", async () => {
  const { q } = queue(), a = fakeServer("users/u1/data/x"), b = fakeServer("users/u2/data/x");
  q("x", a.ref, { value: "a1" }); q("x", b.ref, { value: "b1" }); q("x", a.ref, { value: "a2" });
  await tick();
  assert.deepEqual(a.sent.map(p => p.value), ["a1"]);
  assert.deepEqual(b.sent.map(p => p.value), ["b1"]);
  a.pending.shift().resolve(); await tick();
  assert.deepEqual(a.sent.map(p => p.value), ["a1", "a2"]);
});
