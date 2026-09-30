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

function makeServer() { return { docs: new Map(), listeners: new Set(), writes: [], queryListens: 0, openQueries: 0, failQueries: false }; }
// Firestore hands a document's map fields back in alphabetical order, whatever order they were written in.
const sortKeys = (value) => Array.isArray(value) ? value.map(sortKeys)
  : value && typeof value === "object" ? Object.keys(value).sort().reduce((out, key) => { out[key] = sortKeys(value[key]); return out; }, {}) : value;

function stamp(data) {
  const out = {};
  Object.entries(data).forEach(([key, value]) => { out[key] = value && value.__serverTimestamp ? Date.now() : clone(value); });
  return out;
}

function device(server, { uid = "u1", storage = new Map() } = {}) {
  const dev = { online: true, held: [], storage };
  const snap = (path) => {
    const data = server.docs.get(path);
    return { id: path.split("/").pop(), exists: data !== undefined, data: () => sortKeys(clone(data)), metadata: { hasPendingWrites: false, fromCache: false } };
  };
  const notify = (path) => {
    server.listeners.forEach((listener) => {
      if (listener.path === path && listener.dev.online && !listener.closed) setTimeout(() => !listener.closed && listener.cb(snap(path)), 2);
    });
  };
  const apply = (path, data) => { server.writes.push(path); server.docs.set(path, stamp(data)); notify(path); };
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
        // Counts live queries (each one re-reads every matching record), and can fail them like the cloud does.
        onSnapshot: (cb, onError) => {
          server.queryListens++;
          if (server.failQueries) { setTimeout(() => onError && onError(new Error("Quota exceeded.")), 2); return () => {}; }
          server.openQueries++;
          let open = true;
          setTimeout(() => open && cb(list()), 2);
          return () => { if (open) { open = false; server.openQueries--; } };
        },
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
    // Timers run fast, but a long wait (a timeout like "give the cloud 6 s to answer") must still end after
    // the short steps it waits for; squeezing it to 3 ms too let it expire before the fake cloud replied.
    setTimeout: (fn, ms) => setTimeout(fn, (ms || 0) >= 1000 ? 60 : Math.min(ms || 0, 3)), clearTimeout,
    setInterval: () => 0, clearInterval() {},
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    document: { addEventListener: (type, fn) => { (listeners["doc:" + type] = listeners["doc:" + type] || []).push(fn); }, visibilityState: "visible" },
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
  dev.setVisibility = (state) => { sandbox.document.visibilityState = state; (listeners["doc:visibilitychange"] || []).forEach((fn) => fn()); };
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

test("opening the app again rewrites no task records (the quota burner)", async () => {
  const server = makeServer();
  server.docs.set(`users/u1/data/${MAIN}`, { value: JSON.stringify(account()), localTs: 1000 });
  const first = device(server);
  const data = JSON.parse((await first.storageApi.get(MAIN)).value);
  await first.window.taskLedger.seed(data, await first.window.taskLedger.list());
  await settle();
  const recordWrites = () => server.writes.filter((path) => path.includes("/dg-task-item-")).length;
  assert.equal(recordWrites(), 1); // the one task gets its record once
  for (let open = 0; open < 3; open++) {
    const again = device(server);
    const loaded = JSON.parse((await again.storageApi.get(MAIN)).value);
    await again.window.taskLedger.seed(loaded, await again.window.taskLedger.list());
    await settle();
  }
  assert.equal(recordWrites(), 1);
});

test("a device that lost its merge base (storage full) never overwrites another device's edits", async () => {
  const server = makeServer();
  const event = (id, title) => ({ id, title, date: "2026-09-26", start: "09:00", end: "10:00" });
  server.docs.set(`users/u1/data/${CAL}`, { value: JSON.stringify([event("e1", "Class")]), localTs: 1000 });
  const laptop = device(server), phone = device(server);
  for (const dev of [laptop, phone]) { await dev.storageApi.get(CAL); dev.storageApi.subscribe(CAL, () => {}); }
  await settle();
  // Cloud refusing saves: the phone's edit stays on the phone.
  phone.goOffline();
  await phone.storageApi.set(CAL, JSON.stringify([event("e1", "Class"), event("p1", "Phone event")])).catch(() => {});
  // Meanwhile the laptop edits and saves.
  await laptop.storageApi.set(CAL, JSON.stringify([event("e1", "Class — moved"), event("l1", "Laptop event")]));
  await settle();
  // The phone's storage filled up, so it no longer knows which cloud version it was built on; it reopens.
  phone.storage.delete(CAL + "_base"); phone.storage.delete(CAL + "_basever");
  phone.storage.set(CAL + "_ts", String(Date.now() + 60000));
  const reopened = device(server, { storage: phone.storage });
  await reopened.storageApi.get(CAL); await settle();
  const cloud = JSON.parse(server.docs.get(`users/u1/data/${CAL}`).value);
  assert.deepEqual(cloud.map((e) => e.id).sort(), ["e1", "l1", "p1"]);
});

test("a stale calendar copy saved over a newer one can't drop events nobody deleted (Sep 28)", async () => {
  const server = makeServer();
  const event = (id) => ({ id, title: id, date: "2026-09-28", start: "09:00", end: "10:00" });
  const restored = ["e1", "e2", "r1", "r2", "r3", "r4"].map(event);
  server.docs.set(`users/u1/data/${CAL}`, { value: JSON.stringify(restored), localTs: 1000, rev: 7, writer: "laptop" });
  const phone = device(server);
  await phone.storageApi.get(CAL); await settle();
  // The phone's app still holds last night's calendar (before r1-r4 came back) and saves it whole, built on
  // the version it just received: without the guard this replaces the cloud copy outright.
  await phone.storageApi.set(CAL, JSON.stringify([event("e1"), event("e2"), event("p1")]));
  await settle();
  const cloud = JSON.parse(server.docs.get(`users/u1/data/${CAL}`).value);
  assert.deepEqual(cloud.map((e) => e.id).sort(), ["e1", "e2", "p1", "r1", "r2", "r3", "r4"]);
  assert.equal(server.docs.get(`users/u1/data/${CAL}`).client, 6, "saves say which sync code made them (the rules require it)");
  // The phone shows the kept events too.
  assert.deepEqual(phone.local(CAL).map((e) => e.id).sort(), ["e1", "e2", "p1", "r1", "r2", "r3", "r4"]);
});

test("deleting events and restoring a copy still remove events", async () => {
  const server = makeServer();
  const event = (id) => ({ id, title: id, date: "2026-09-28", start: "09:00", end: "10:00" });
  server.docs.set(`users/u1/data/${CAL}`, { value: JSON.stringify(["a", "b", "c", "d", "e"].map(event)), localTs: 1000, rev: 1, writer: "x" });
  const laptop = device(server);
  await laptop.storageApi.get(CAL); await settle();
  // "All events" delete of a series with three copies names the ids it removes.
  await laptop.storageApi.set(CAL, JSON.stringify(["a", "b"].map(event)), { removing: ["c", "d", "e"] });
  await settle();
  assert.deepEqual(JSON.parse(server.docs.get(`users/u1/data/${CAL}`).value).map((e) => e.id), ["a", "b"]);
  // A single delete (under the limit) needs no note, as with an offline delete retried later.
  await laptop.storageApi.set(CAL, JSON.stringify(["a"].map(event)));
  await settle();
  assert.deepEqual(JSON.parse(server.docs.get(`users/u1/data/${CAL}`).value).map((e) => e.id), ["a"]);
  // Replacing the calendar with a copy removes whatever the copy lacks.
  await laptop.storageApi.set(CAL, JSON.stringify(["a", "b", "c", "d", "e"].map(event)));
  await settle();
  await laptop.storageApi.set(CAL, JSON.stringify(["z"].map(event)), { removing: true });
  await settle();
  assert.deepEqual(JSON.parse(server.docs.get(`users/u1/data/${CAL}`).value).map((e) => e.id), ["z"]);
});

// Sep 28, 1:45 PM: a phone reopened with day-old unsynced calendar edits; on every event both devices had
// changed, the phone's older version won and undid the laptop's newer edits.
async function calendarPair() {
  const server = makeServer();
  const event = (id, start) => ({ id, title: id, date: "2026-09-28", start, end: "23:00" });
  server.docs.set(`users/u1/data/${CAL}`, { value: JSON.stringify([event("bus", "08:00"), event("gym", "12:00"), event("nap", "14:00")]), localTs: 1000, rev: 1, writer: "x" });
  const laptop = device(server), phone = device(server);
  for (const dev of [laptop, phone]) { await dev.storageApi.get(CAL); dev.storageApi.subscribe(CAL, () => {}); }
  await settle();
  const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
  const cloud = () => Object.fromEntries(JSON.parse(server.docs.get(`users/u1/data/${CAL}`).value).map((e) => [e.id, e.start]));
  return { server, event, laptop, phone, wait, cloud };
}

test("a phone reopening with old unsynced edits doesn't undo newer edits made on the laptop", async () => {
  const { server, event, laptop, phone, wait, cloud } = await calendarPair();
  phone.goOffline();
  // Yesterday on the phone: bus moved to 08:30, nap moved to 15:00; never uploaded.
  await phone.storageApi.set(CAL, JSON.stringify([event("bus", "08:30"), event("gym", "12:00"), event("nap", "15:00")])).catch(() => {});
  await wait();
  // Today on the laptop: bus moved to 09:00 (a newer edit of the same event).
  await laptop.storageApi.set(CAL, JSON.stringify([event("bus", "09:00"), event("gym", "12:00"), event("nap", "14:00")]));
  await settle();
  // The phone app is closed and opened again (new code, online).
  const reopened = device(server, { storage: phone.storage });
  await reopened.storageApi.get(CAL); await settle(60);
  assert.deepEqual(cloud(), { bus: "09:00", gym: "12:00", nap: "15:00" }, "laptop's newer bus time kept, phone's own nap edit kept");
});

test("a phone coming back online with old unsynced edits doesn't undo newer edits made on the laptop", async () => {
  const { event, laptop, phone, wait, cloud } = await calendarPair();
  phone.goOffline();
  await phone.storageApi.set(CAL, JSON.stringify([event("bus", "08:30"), event("gym", "12:00"), event("nap", "15:00")])).catch(() => {});
  await wait();
  await laptop.storageApi.set(CAL, JSON.stringify([event("bus", "09:00"), event("gym", "12:30"), event("nap", "14:00")]));
  await settle();
  phone.goOnline();
  await settle(80);
  assert.deepEqual(cloud(), { bus: "09:00", gym: "12:30", nap: "15:00" });
  assert.deepEqual(Object.fromEntries(phone.local(CAL).map((e) => [e.id, e.start])), { bus: "09:00", gym: "12:30", nap: "15:00" });
});

test("when the phone's edit of an event is the newer one, the phone's version wins", async () => {
  const { event, laptop, phone, wait, cloud } = await calendarPair();
  laptop.goOffline();
  await laptop.storageApi.set(CAL, JSON.stringify([event("bus", "09:00"), event("gym", "12:00"), event("nap", "14:00")])).catch(() => {});
  await wait();
  await phone.storageApi.set(CAL, JSON.stringify([event("bus", "08:30"), event("gym", "12:00"), event("nap", "14:00")]));
  await settle();
  laptop.goOnline();
  await settle(80);
  assert.deepEqual(cloud(), { bus: "08:30", gym: "12:00", nap: "14:00" });
});

// Sep 29: an app copy holding an old calendar (a second tab of the app, or the phone app waking up) saved
// it whole; it had seen the cloud's newest version, so the save replaced the cloud copy: every edit made
// since was undone and deleted events came back. The calendar now merges one event at a time.
async function calOpen(dev) {
  const loaded = await dev.storageApi.get(CAL);
  dev.cal = loaded && loaded.value;
  dev.storageApi.subscribe(CAL, (value) => { dev.cal = value; });
}
// What the app does: change its in-memory calendar, then save it whole.
const calEdit = (dev, change, options) => {
  dev.cal = JSON.stringify(change(JSON.parse(dev.cal)));
  return dev.storageApi.set(CAL, dev.cal, options);
};
const ev = (id, start, extra) => ({ id, title: id, date: "2026-09-29", start, end: "23:00", ...extra });
const cloudCal = (server) => Object.fromEntries(JSON.parse(server.docs.get(`users/u1/data/${CAL}`).value).map((e) => [e.id, e.start]));
function seededCalendar() {
  const server = makeServer();
  server.docs.set(`users/u1/data/${CAL}`, { value: JSON.stringify([ev("bus", "08:00"), ev("gym", "12:00"), ev("nap", "14:00"), ev("cad", "16:30")]), localTs: 1000, rev: 1, writer: "x" });
  return server;
}

test("a second tab that slept through the other tab's edits can't undo them (Sep 29)", async () => {
  const server = seededCalendar();
  const tabA = device(server);
  const shared = device(server, { storage: tabA.storage }); // same browser: one device storage, two copies of the app
  await calOpen(tabA); await calOpen(shared); await settle();
  shared.goOffline(); // asleep in the background
  await calEdit(tabA, (list) => list.map((e) => e.id === "gym" ? { ...e, start: "12:45" } : e).filter((e) => e.id !== "cad").concat([ev("fest", "07:30")]), { removing: ["cad"] });
  await settle();
  shared.goOnline(); await settle(60); // wakes up
  await calEdit(shared, (list) => list.map((e) => e.id === "nap" ? { ...e, start: "15:00" } : e));
  await settle(60);
  assert.deepEqual(cloudCal(server), { bus: "08:00", gym: "12:45", nap: "15:00", fest: "07:30" });
});

test("even an app copy that missed every update only changes the events edited in it", async () => {
  const server = seededCalendar();
  const laptop = device(server), phone = device(server);
  await calOpen(laptop); await settle();
  // The phone app loaded the calendar, then heard nothing more (asleep, or its updates never arrived).
  const loaded = await phone.storageApi.get(CAL);
  phone.cal = loaded.value;
  await calEdit(laptop, (list) => list.map((e) => e.id === "gym" ? { ...e, start: "12:45" } : e).filter((e) => e.id !== "cad").concat([ev("fest", "07:30")]), { removing: ["cad"] });
  await settle();
  await calEdit(phone, (list) => list.map((e) => e.id === "nap" ? { ...e, start: "15:00" } : e));
  await settle(60);
  assert.deepEqual(cloudCal(server), { bus: "08:00", gym: "12:45", nap: "15:00", fest: "07:30" });
  // Retry (the "sync failed → retry" button re-sends the app's whole calendar): still nothing undone.
  await phone.storageApi.set(CAL, phone.cal);
  await settle(60);
  assert.deepEqual(cloudCal(server), { bus: "08:00", gym: "12:45", nap: "15:00", fest: "07:30" });
});

test("a device holding a days-old copy doesn't bring back events deleted before delete markers existed", async () => {
  const server = seededCalendar();
  const laptop = device(server);
  await calOpen(laptop); await settle();
  // Last week's copy on the phone, with events the laptop (old app) has deleted since.
  const phoneStorage = new Map([[CAL, JSON.stringify([ev("bus", "07:00"), ev("gym", "12:00"), ev("nap", "14:00"), ev("cad", "16:30"), ev("old1", "10:00"), ev("old2", "11:00")])], [CAL + "_ts", String(Date.now() + 60000)]]);
  await calEdit(laptop, (list) => list.map((e) => e.id === "bus" ? { ...e, start: "08:15" } : e));
  await settle();
  const phone = device(server, { storage: phoneStorage });
  await calOpen(phone); await settle(60);
  assert.deepEqual(cloudCal(server), { bus: "08:15", gym: "12:00", nap: "14:00", cad: "16:30" });
  assert.deepEqual(Object.keys(Object.fromEntries(JSON.parse(phone.cal).map((e) => [e.id, 1]))).sort(), ["bus", "cad", "gym", "nap"]);
});

test("a delete made offline stays deleted, and a later edit on the other device survives it", async () => {
  const server = seededCalendar();
  const laptop = device(server), phone = device(server);
  await calOpen(laptop); await calOpen(phone); await settle();
  phone.goOffline();
  await calEdit(phone, (list) => list.filter((e) => e.id !== "nap"), { removing: ["nap"] }).catch(() => {});
  await calEdit(laptop, (list) => list.map((e) => e.id === "bus" ? { ...e, start: "09:00" } : e));
  await settle();
  phone.goOnline(); await settle(80);
  assert.deepEqual(cloudCal(server), { bus: "09:00", gym: "12:00", cad: "16:30" });
  // The laptop, still holding nap, edits something else: nap stays deleted.
  await calEdit(laptop, (list) => list.map((e) => e.id === "gym" ? { ...e, start: "13:00" } : e));
  await settle(60);
  assert.deepEqual(cloudCal(server), { bus: "09:00", gym: "13:00", cad: "16:30" });
});

test("an event deleted on one device but edited later on the other comes back with the edit", async () => {
  const server = seededCalendar();
  const laptop = device(server), phone = device(server);
  await calOpen(laptop); await calOpen(phone); await settle();
  phone.goOffline();
  await calEdit(laptop, (list) => list.filter((e) => e.id !== "cad"), { removing: ["cad"] });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await calEdit(phone, (list) => list.map((e) => e.id === "cad" ? { ...e, start: "17:00" } : e)).catch(() => {});
  phone.goOnline(); await settle(80);
  assert.equal(cloudCal(server).cad, "17:00");
});

// Sep 30: a copy of the app the cloud refused never reloaded into the new version, because a refused save
// always leaves "unsynced" changes. Only a change the device couldn't store may block a reload.
test("only a change the device couldn't store counts as one a reload would lose", async () => {
  const server = seededCalendar();
  const phone = device(server);
  await calOpen(phone); await settle();
  phone.goOffline();
  await calEdit(phone, (list) => list.concat([ev("gym2", "18:00")])).catch(() => {});
  assert.equal(phone.storageApi.hasUnsyncedChanges(), true);
  assert.equal(phone.storageApi.hasUnstoredChanges(), false, "stored on the device: a reload uploads it later");
  const store = phone.window.localStorage.setItem;
  phone.window.localStorage.setItem = (key, value) => { if (key === CAL) throw new Error("QuotaExceededError"); store(key, value); };
  await calEdit(phone, (list) => list.concat([ev("swim", "19:00")])).catch(() => {});
  assert.equal(phone.storageApi.hasUnstoredChanges(), true, "device storage full: only this page has it");
  phone.goOnline(); await settle(80);
  // Back online, the retry sends the change the device couldn't store, not its older copy.
  assert.equal(phone.storageApi.hasUnstoredChanges(), false, "the cloud has it now");
  assert.ok(["gym2", "swim"].every((id) => id in cloudCal(server)));
  assert.ok(JSON.parse(phone.cal).some((e) => e.id === "swim"), "an update from the cloud didn't take it out of the app");
  await calEdit(phone, (list) => list.concat([ev("yoga", "20:00")]));
  await settle(60);
  assert.ok(["gym2", "swim", "yoga"].every((id) => id in cloudCal(server)));
});

// Sep 30: overnight a copy of the app in the background re-read every task record about 100 times an
// hour and used up the free daily read limit. The live task-record query now pauses while hidden.
const pause = () => new Promise((resolve) => setTimeout(resolve, 150)); // longer than the 30 s pause (60 ms here)
test("a copy of the app in the background stops reading task records and picks up again when shown", async () => {
  const server = makeServer();
  server.docs.set(`users/u1/data/${MAIN}`, { value: JSON.stringify(account()), localTs: 1000 });
  const laptop = device(server);
  await laptop.open(); await laptop.window.taskLedger.list(); await settle();
  assert.equal(server.queryListens, 1);
  assert.equal(server.openQueries, 1);
  laptop.setVisibility("hidden"); await pause();
  assert.equal(server.openQueries, 0, "paused while hidden");
  for (let i = 0; i < 5; i++) await laptop.window.taskLedger.list();
  assert.equal(server.queryListens, 1, "using the records while hidden doesn't reopen the query");
  laptop.setVisibility("visible"); await settle();
  assert.equal(server.openQueries, 1, "live again when shown");
  assert.equal(server.queryListens, 2);
  laptop.setVisibility("hidden"); laptop.setVisibility("visible"); await pause();
  assert.equal(server.queryListens, 2, "hidden for a moment: nothing restarts");
  assert.equal(server.openQueries, 1);
});

test("a failing task-record query is retried on a slow timer, not every time the records are used", async () => {
  const server = makeServer();
  server.failQueries = true;
  server.docs.set(`users/u1/data/${MAIN}`, { value: JSON.stringify(account()), localTs: 1000 });
  const laptop = device(server);
  await laptop.open(); await settle();
  for (let i = 0; i < 10; i++) await laptop.window.taskLedger.list().catch(() => {});
  assert.equal(server.queryListens, 1);
  server.failQueries = false;
  await pause();
  assert.equal(server.queryListens, 2, "one retry after the wait");
  assert.equal(server.openQueries, 1);
  assert.ok(Array.isArray(await laptop.window.taskLedger.list()));
});
