// Two devices (separate localStorage, separate running copies of the real sync code from index.html)
// sharing one fake Firestore server. Proves edits from both devices survive: concurrent saves, offline
// edits, reloads with unsynced changes, deletions, and signing in on a device with signed-out data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const html = fs.readFileSync(require.resolve("../index.html"), "utf8").replace(/\r\n/g, "\n");
const scriptStart = html.indexOf("<script>\n    // Initialize Firebase");
const source = html.slice(html.indexOf("\n", scriptStart), html.indexOf("</script>", scriptStart));
const MAIN = "daily-grind-v13", CAL = "dg-cal-events";
const settle = async (rounds = 30) => { for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 1)); };
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function makeServer() { return { docs: new Map(), listeners: new Set() }; }

function stamp(data) {
  const out = {};
  Object.entries(data).forEach(([key, value]) => { out[key] = value && value.__serverTimestamp ? Date.now() : clone(value); });
  return out;
}

function device(server, { uid = "u1", storage = new Map() } = {}) {
  const dev = { online: true, held: [], storage };
  const snap = (path) => {
    const data = server.docs.get(path);
    return { id: path.split("/").pop(), exists: data !== undefined, data: () => clone(data), metadata: { hasPendingWrites: false, fromCache: false } };
  };
  const notify = (path) => {
    server.listeners.forEach((listener) => {
      if (listener.path === path && listener.dev.online && !listener.closed) setTimeout(() => !listener.closed && listener.cb(snap(path)), 2);
    });
  };
  const apply = (path, data) => { server.docs.set(path, stamp(data)); notify(path); };
  function docRef(path) {
    return {
      path,
      collection: (name) => collectionRef(path + "/" + name),
      get: () => dev.online ? Promise.resolve(snap(path)) : Promise.reject(new Error("client is offline")),
      set: (data) => {
        if (dev.online) { apply(path, data); return Promise.resolve(); }
        return new Promise((resolve) => dev.held.push(() => { apply(path, data); resolve(); })); // like Firestore's offline queue
      },
      onSnapshot: (cb) => {
        const listener = { dev, path, cb, closed: false };
        server.listeners.add(listener);
        if (dev.online && server.docs.has(path)) setTimeout(() => cb(snap(path)), 2);
        return () => { listener.closed = true; server.listeners.delete(listener); };
      },
    };
  }
  function collectionRef(path) {
    const query = (filter) => {
      const list = () => {
        const docs = [...server.docs.entries()].filter(([p, d]) => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/") && (!filter || d[filter[0]] === filter[1]))
          .map(([p]) => snap(p));
        return { docs, forEach: (fn) => docs.forEach(fn), size: docs.length };
      };
      return {
        where: (field, op, value) => query([field, value]),
        orderBy: () => query(filter), startAt: () => query(filter), endAt: () => query(filter),
        get: () => dev.online ? Promise.resolve(list()) : Promise.reject(new Error("client is offline")),
        onSnapshot: (cb) => { setTimeout(() => cb(list()), 2); return () => {}; },
      };
    };
    return { ...query(null), doc: (id) => docRef(path + "/" + id) };
  }
  const firestore = () => ({
    enablePersistence: () => Promise.resolve(),
    collection: (name) => collectionRef(name),
    // Like Firestore: if a document read inside the transaction changed before commit, run it again.
    runTransaction: async (fn) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (!dev.online) throw new Error("client is offline");
        const writes = [], reads = new Map();
        const result = await fn({
          get: (ref) => { reads.set(ref.path, JSON.stringify(server.docs.get(ref.path) ?? null)); return Promise.resolve(snap(ref.path)); },
          set: (ref, data) => writes.push([ref.path, data]),
        });
        if (!dev.online) throw new Error("client is offline");
        if ([...reads].some(([path, seen]) => JSON.stringify(server.docs.get(path) ?? null) !== seen)) continue;
        writes.forEach(([path, data]) => apply(path, data));
        return result;
      }
      throw new Error("transaction contention");
    },
  });
  firestore.FieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }) };
  firestore.FieldPath = { documentId: () => "__name__" };
  const auth = () => ({
    onAuthStateChanged: (cb) => setTimeout(() => cb({ uid, isAnonymous: false }), 0),
    signInAnonymously: () => Promise.resolve(), signOut: () => Promise.resolve(), signInWithPopup: () => Promise.resolve({}),
  });
  auth.GoogleAuthProvider = function () {};
  const listeners = {};
  const sandbox = {
    firebase: { initializeApp() {}, auth, firestore },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => { storage.set(key, String(value)); },
      removeItem: (key) => { storage.delete(key); },
    },
    navigator: {},
    TextEncoder, console: { ...console, warn() {}, log() {} },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 3)), clearTimeout,
    setInterval: () => 0, clearInterval() {},
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    document: { addEventListener() {}, visibilityState: "visible" },
    location: { pathname: "/" },
    fetch: () => Promise.reject(new Error("no network in tests")),
  };
  Object.defineProperty(sandbox.navigator, "onLine", { get: () => dev.online });
  sandbox.window = sandbox;
  sandbox.crypto = webcrypto;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  dev.window = sandbox;
  dev.storageApi = sandbox.storage;
  dev.local = (key = MAIN) => JSON.parse(storage.get(key));
  dev.goOffline = () => { dev.online = false; };
  dev.goOnline = () => {
    dev.online = true;
    dev.held.splice(0).forEach((run) => run());
    server.listeners.forEach((listener) => { if (listener.dev === dev && server.docs.has(listener.path)) setTimeout(() => listener.cb(snap(listener.path)), 2); });
    (listeners.online || []).forEach((fn) => fn());
  };
  // What the app does: load, then follow live updates.
  dev.open = async () => {
    const loaded = await sandbox.storage.get(MAIN);
    dev.appValue = loaded && loaded.value;
    dev.unsubscribe = sandbox.storage.subscribe(MAIN, (value) => { dev.appValue = value; });
    return loaded;
  };
  dev.edit = (change) => {
    const data = JSON.parse(dev.appValue);
    change(data);
    dev.appValue = JSON.stringify(data);
    return sandbox.storage.set(MAIN, dev.appValue);
  };
  return dev;
}

const account = () => ({
  habitSections: [{ id: "morning", title: "MORNING", items: [{ id: "h_read", name: "Read", points: 10 }, { id: "h_run", name: "Run", points: 20 }] }],
  taskLists: [{ id: "tl_main", title: "Main", resetsDaily: false, items: [{ id: "t_a", name: "Essay", points: 30, done: false }] }],
  notes: [{ id: "n1", title: "Bio", body: "cells" }],
  log: { "2026-09-23": { h_read: "done" } },
  history: {}, walletSpent: 0, dailyGoal: 250,
});

async function seededPair() {
  const server = makeServer();
  server.docs.set(`users/u1/data/${MAIN}`, { value: JSON.stringify(account()), localTs: 1000 });
  const a = device(server), b = device(server);
  await a.open(); await b.open(); await settle();
  return { server, a, b, cloud: () => JSON.parse(server.docs.get(`users/u1/data/${MAIN}`).value) };
}
const habitNames = (data) => data.habitSections[0].items.map((item) => item.name);

test("two devices saving at the same moment both keep their edits", async () => {
  const { a, b, cloud } = await seededPair();
  const saves = [
    a.edit((d) => d.habitSections[0].items.push({ id: "h_a", name: "Stretch", points: 5 })),
    b.edit((d) => d.notes.push({ id: "n2", title: "Chem", body: "moles" })),
  ];
  await Promise.all(saves); await settle();
  assert.deepEqual(habitNames(cloud()), ["Read", "Run", "Stretch"]);
  assert.deepEqual(cloud().notes.map((n) => n.id), ["n1", "n2"]);
  for (const dev of [a, b]) {
    const seen = JSON.parse(dev.appValue);
    assert.deepEqual(habitNames(seen), ["Read", "Run", "Stretch"]);
    assert.deepEqual(seen.notes.map((n) => n.id), ["n1", "n2"]);
    assert.equal(dev.storage.get(MAIN), dev.appValue);
  }
});

test("habits checked on an offline phone survive edits made meanwhile on the laptop", async () => {
  const { a: phone, b: laptop, cloud } = await seededPair();
  phone.goOffline();
  await phone.edit((d) => { d.log["2026-09-24"] = { h_run: "done" }; }).catch(() => {});
  await laptop.edit((d) => { d.notes[0].body = "cells and mitochondria"; });
  await settle();
  assert.equal(cloud().log["2026-09-24"], undefined); // phone still offline
  phone.goOnline(); await settle(60);
  assert.deepEqual(cloud().log["2026-09-24"], { h_run: "done" });
  assert.equal(cloud().notes[0].body, "cells and mitochondria");
  assert.deepEqual(JSON.parse(phone.appValue).log["2026-09-24"], { h_run: "done" });
  assert.equal(JSON.parse(phone.appValue).notes[0].body, "cells and mitochondria");
  assert.deepEqual(JSON.parse(laptop.appValue).log["2026-09-24"], { h_run: "done" });
});

test("unsynced edits left on a closed phone merge with the laptop's newer edits on the next open", async () => {
  const { server, a: phone, b: laptop, cloud } = await seededPair();
  phone.goOffline();
  await phone.edit((d) => { d.taskLists[0].items.push({ id: "t_b", name: "Lab", points: 15, done: false }); }).catch(() => {});
  phone.unsubscribe();
  await laptop.edit((d) => { d.habitSections[0].items[0].points = 15; });
  await settle();
  const reopened = device(server, { storage: phone.storage }); // same browser storage, fresh page
  await reopened.open(); await settle();
  assert.deepEqual(cloud().taskLists[0].items.map((t) => t.id), ["t_a", "t_b"]);
  assert.equal(cloud().habitSections[0].items[0].points, 15);
  assert.deepEqual(JSON.parse(reopened.appValue), cloud());
});

test("a delete on one device stays deleted while the other device edits something else", async () => {
  const { a, b, cloud } = await seededPair();
  await Promise.all([
    a.edit((d) => { d.habitSections[0].items = d.habitSections[0].items.filter((h) => h.id !== "h_run"); }),
    b.edit((d) => { d.habitSections[0].items[0].name = "Read 20 pages"; }),
  ]);
  await settle();
  assert.deepEqual(habitNames(cloud()), ["Read 20 pages"]);
});

test("an item deleted on one device but edited on the other is kept, never silently lost", async () => {
  const { a, b, cloud } = await seededPair();
  await Promise.all([
    a.edit((d) => { d.notes = []; }),
    b.edit((d) => { d.notes[0].body = "important new text"; }),
  ]);
  await settle();
  assert.deepEqual(cloud().notes.map((n) => n.body), ["important new text"]);
});

test("store purchases on two devices both count", async () => {
  const { a, b, cloud } = await seededPair();
  await Promise.all([a.edit((d) => { d.walletSpent = 100; }), b.edit((d) => { d.walletSpent = 40; })]);
  await settle();
  assert.equal(cloud().walletSpent, 140);
});

test("an empty starter from another device never wipes real data", async () => {
  const { server, a, cloud } = await seededPair();
  const starter = { habitSections: [{ id: "morning", title: "MORNING", items: [] }], taskLists: [] };
  server.docs.set(`users/u1/data/${MAIN}`, { value: JSON.stringify(starter), localTs: 99999999999999, rev: 50, writer: "bad-tab" });
  server.listeners.forEach((l) => l.path.endsWith(MAIN) && l.cb({ exists: true, data: () => clone(server.docs.get(l.path)), metadata: {} }));
  await settle();
  assert.deepEqual(habitNames(JSON.parse(a.appValue)), ["Read", "Run"]);
  await a.edit((d) => { d.dailyGoal = 300; }); await settle();
  assert.deepEqual(habitNames(cloud()), ["Read", "Run"]);
});

test("signing in on a device holding signed-out data keeps the account's cloud data", async () => {
  const server = makeServer();
  server.docs.set(`users/u1/data/${MAIN}`, { value: JSON.stringify(account()), localTs: 1000 });
  const storage = new Map();
  const guest = { ...account(), habitSections: [{ id: "g", title: "G", items: [{ id: "h1", name: "Guest habit", points: 1 }, { id: "h2", name: "x", points: 1 }, { id: "h3", name: "y", points: 1 }] }], notes: [] };
  storage.set(MAIN, JSON.stringify(guest)); storage.set(MAIN + "_ts", String(Date.now() + 100000));
  const dev = device(server, { storage });
  await dev.open(); await settle();
  const cloud = JSON.parse(server.docs.get(`users/u1/data/${MAIN}`).value);
  assert.deepEqual(habitNames(cloud), ["Read", "Run"]);
  assert.deepEqual(habitNames(JSON.parse(dev.appValue)), ["Read", "Run"]);
  assert.equal(JSON.parse(JSON.parse(storage.get("dg-vault-local-safety")).value).habitSections[0].items[0].name, "Guest habit");
});

test("calendar events added on two devices at once are both kept", async () => {
  const server = makeServer();
  const event = (id, title) => ({ id, title, date: "2026-09-25", start: "09:00", end: "10:00" });
  server.docs.set(`users/u1/data/${CAL}`, { value: JSON.stringify([event("e1", "Class")]), localTs: 1000 });
  const a = device(server), b = device(server);
  for (const dev of [a, b]) { await dev.storageApi.get(CAL); dev.storageApi.subscribe(CAL, () => {}); }
  await settle();
  await Promise.all([
    a.storageApi.set(CAL, JSON.stringify([event("e1", "Class"), event("e2", "Gym")])),
    b.storageApi.set(CAL, JSON.stringify([event("e1", "Class"), event("e3", "Work")])),
  ]);
  await settle();
  const cloud = JSON.parse(server.docs.get(`users/u1/data/${CAL}`).value);
  assert.deepEqual(cloud.map((e) => e.id).sort(), ["e1", "e2", "e3"]);
  assert.deepEqual(JSON.parse(a.storage.get(CAL)).map((e) => e.id).sort(), ["e1", "e2", "e3"]);
});

test("reordering on one device and adding on the other keeps both", async () => {
  const { a, b, cloud } = await seededPair();
  await Promise.all([
    a.edit((d) => { d.habitSections[0].items.reverse(); }),
    b.edit((d) => { d.habitSections[0].items.push({ id: "h_new", name: "Journal", points: 5 }); }),
  ]);
  await settle();
  assert.deepEqual(habitNames(cloud()), ["Run", "Read", "Journal"]);
});

test("an event deleted on one device stays deleted even if the other device's copy lists its fields in another order", () => {
  const ctx = {};
  vm.runInNewContext(source.slice(source.indexOf("    function _hasOwn("), source.indexOf("    // Returns the merged document text")), ctx);
  const base = [{ id: "e1", title: "Gym", start: "09:00" }, { id: "e2", title: "Class", start: "10:00" }];
  const local = [{ start: "09:00", title: "Gym", id: "e1" }, { title: "Class", id: "e2", start: "10:00" }, { id: "e3", title: "New", start: "12:00" }];
  const remote = [{ id: "e2", title: "Class", start: "10:00" }]; // e1 deleted on the other device
  assert.deepEqual(JSON.parse(JSON.stringify(ctx._merge3(base, local, remote, ""))).map((e) => e.id), ["e2", "e3"]);
});

test("taking another device's calendar keeps that version's timestamp", async () => {
  const server = makeServer();
  const event = (id, title) => ({ id, title, date: "2026-09-25", start: "09:00", end: "10:00" });
  server.docs.set(`users/u1/data/${CAL}`, { value: JSON.stringify([event("e1", "Class")]), localTs: 1000 });
  const a = device(server), b = device(server);
  for (const dev of [a, b]) { await dev.storageApi.get(CAL); dev.storageApi.subscribe(CAL, () => {}); }
  await settle();
  await a.storageApi.set(CAL, JSON.stringify([]));
  await settle();
  assert.equal(b.storage.get(CAL), "[]");
  assert.equal(b.storage.get(CAL + "_ts"), String(server.docs.get(`users/u1/data/${CAL}`).localTs));
});
