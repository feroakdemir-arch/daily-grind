const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), crypto = require('node:crypto');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function setup(shared = new Map()) {
  const auth = { currentUser: { uid: 'owner', isAnonymous: false }, onAuthStateChanged(fn) { this.notify = fn; } };
  let writes = 0, fail = false, switchOnRead = false;
  const ref = path => ({ collection: id => ref(path + '/' + id), doc: id => ref(path + '/' + id),
    set: async data => { if (fail) throw new Error('offline'); writes++; shared.set(path, structuredClone(data)); },
    get: async () => { if (switchOnRead) auth.currentUser = { uid: 'other' }; return { exists: shared.has(path), data: () => shared.get(path) }; }
  });
  const c = { window: {}, firebase: { auth: () => auth, firestore: () => ({ collection: name => ref(name) }) }, crypto: crypto.webcrypto, TextEncoder, setTimeout, clearTimeout, console };
  vm.runInNewContext(fs.readFileSync(require.resolve('../note-images.js'), 'utf8'), c);
  return { api: c.window.noteImageStore, shared, auth, writes: () => writes, fail: () => { fail = true; }, switchOnRead: () => { switchOnRead = true; } };
}
test('image uploads are private to their owner, deduplicated, and load in a fresh session', async () => {
  const h = setup(); const id = await h.api.put(png);
  assert.equal(id, digest(png)); assert.ok(h.shared.has('users/owner/noteImages/' + id));
  assert.equal(await h.api.put(png), id); assert.equal(h.writes(), 1);
  assert.equal(await setup(h.shared).api.load(id), png);
  const other = setup(h.shared); other.auth.currentUser.uid = 'other';
  await assert.rejects(other.api.load(id), /missing/);
});
test('anonymous upload, invalid MIME, oversized data and changed owner are rejected', async () => {
  const h = setup(); h.auth.currentUser.isAnonymous = true; await assert.rejects(h.api.put(png), /Sign in/);
  h.auth.currentUser.isAnonymous = false;
  await assert.rejects(h.api.put('data:image/svg+xml;base64,AAAA'), /Invalid/);
  await assert.rejects(h.api.put('data:image/png;base64,' + 'A'.repeat(800001)), /Invalid/);
  await assert.rejects(h.api.put(png, undefined, 'other'), /account changed/);
  assert.equal(h.writes(), 0);
});
test('failed upload cannot claim success or enter the successful cache', async () => {
  const h = setup(); h.fail(); await assert.rejects(h.api.put(png), /offline/);
  await assert.rejects(h.api.load(digest(png)), /missing/); assert.equal(h.writes(), 0);
});
test('corrupt assets and account changes during read fail closed', async () => {
  const h = setup(); const id = await h.api.put(png);
  h.shared.get('users/owner/noteImages/' + id).data = 'data:image/png;base64,AAAA';
  await assert.rejects(setup(h.shared).api.load(id), /integrity/);
  const race = setup(h.shared); race.switchOnRead(); await assert.rejects(race.api.load(id), /account changed/);
});
test('image-inclusive backup round trips into another account with checksum validation', async () => {
  const h = setup(), id = await h.api.put(png), main = { noteImages: { page: [{assetId:id}] }, notes: [{images:[{assetId:id}]}] };
  const assets = await h.api.exportAssets(main); assert.equal(Object.keys(assets).length, 1);
  const restored = setup(); restored.auth.currentUser.uid = 'restored';
  await restored.api.importAssets(assets, main); assert.equal(await restored.api.load(id), png);
  await assert.rejects(restored.api.validateAssets({}, main), /missing or damaged/);
  await assert.rejects(restored.api.importAssets({[id]:'data:image/png;base64,AAAA'}, main), /missing or damaged/);
  assert.equal(restored.writes(), 1);
});
