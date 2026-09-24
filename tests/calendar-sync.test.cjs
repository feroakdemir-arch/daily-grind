// Several devices run the app's REAL storage layer and REAL calendar code (extracted from index.html)
// against a fake Firestore, to prove that a device which has not caught up can no longer erase,
// revert or resurrect calendar events.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8").replace(/\r\n/g, "\n");
const between = (from, to, fromIndex = 0) => {
  const start = html.indexOf(from, fromIndex);
  assert.ok(start >= 0, `missing ${from}`);
  const end = html.indexOf(to, start);
  assert.ok(end > start, `missing ${to}`);
  return html.slice(start, end);
};
const blockStart = html.indexOf("<script>\n    // Initialize Firebase");
const storageBlock = html.slice(blockStart + "<script>".length, html.indexOf("</script>", blockStart));
const calendarHelpers = between("function calendarTimeMinutes(", "function makeId(");
const calendarFunctions = between("  function saveCalEvents(nextOrUpdater) {", "  // The event disappears immediately");
const subscribeBody = between("    if (!window.storage.subscribe) return;\n    const unsubEvents", "\n  }, []);", html.indexOf("// Real-time cloud sync for calendar events and deletions"));
const loadBody = between("    if (calEventsLoaded) return;\n    calReadyRef.current = false;", "\n  }, [calEventsLoaded, calLoadAttempt]);");

// Values made inside a simulated device belong to another JS realm; copy them before deepEqual.
const host = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

function world() {
  const server = { docs: new Map(), listeners: new Map(), writes: 0 };
  let clock = 1000;
  const snapshotOf = (path) => { const d = server.docs.get(path); return { exists: !!d, data: () => d && { ...d } }; };
  const deliver = (entry, path) => {
    if (entry.device.suspended || entry.device.offline) { entry.device.missed.set(entry, path); return; }
    entry.cb(snapshotOf(path));
  };
  const notify = (path) => (server.listeners.get(path) || new Set()).forEach((entry) => deliver(entry, path));
  const commit = (path, payload) => { server.writes += 1; server.docs.set(path, { value: payload.value, localTs: payload.localTs }); notify(path); };

  function device(name, store = new Map()) {
    const d = { name, store, suspended: false, offline: false, missed: new Map(), outbox: [], shown: [], errors: [] };
    const ref = (path) => ({
      path,
      async get() { return snapshotOf(path); },
      set(payload) {
        if (!d.offline) { commit(path, payload); return Promise.resolve(); }
        return new Promise((resolve) => d.outbox.push(() => { commit(path, payload); resolve(); }));
      },
      onSnapshot(cb) {
        const entry = { device: d, cb };
        if (!server.listeners.has(path)) server.listeners.set(path, new Set());
        server.listeners.get(path).add(entry);
        deliver(entry, path);
        return () => server.listeners.get(path).delete(entry);
      },
      collection: (sub) => collection(`${path}/${sub}`),
    });
    const collection = (path) => ({ doc: (id) => ref(`${path}/${id}`), where: () => ({ get: async () => ({ forEach() {} }), onSnapshot: () => () => {} }) });
    const firestore = () => ({ enablePersistence: () => Promise.resolve(), collection });
    firestore.FieldValue = { serverTimestamp: () => "SERVER_TS" };
    firestore.FieldPath = { documentId: () => "__id__" };
    const auth = () => ({ onAuthStateChanged: (cb) => cb({ uid: "u1", isAnonymous: false }), signInAnonymously: async () => {}, signInWithPopup: async () => ({}), signOut: async () => {} });
    auth.GoogleAuthProvider = function GoogleAuthProvider() {};
    let loaded;
    const ctx = {
      console, TextEncoder, crypto: globalThis.crypto, unescape, encodeURIComponent, setTimeout, clearTimeout,
      localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
      firebase: { initializeApp: () => {}, auth, firestore },
      addEventListener: () => {}, removeEventListener: () => {},
      __clock: () => clock,
      // What React provides the calendar code in the app.
      calEventsRef: { current: [] }, calTombstonesRef: { current: {} }, calReadyRef: { current: false },
      calLoadError: false, calEventsLoaded: false, MAX_SAFE_DOC_BYTES: 900000,
      textByteSize: (text) => Buffer.byteLength(text), makeId: (prefix) => `${prefix}_${name}_${clock}`, CAL_DEFAULT_COLOR: "#1e88e5",
      setCalEvents: (events) => { d.shown = events; }, setCalLoadError: () => {}, setSaveInfo: (info) => d.errors.push(info.error),
      setCalEventsLoaded: () => { ctx.calEventsLoaded = true; loaded(); },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext("Date.now = () => __clock();", ctx);
    vm.runInContext(storageBlock, ctx);
    ctx.window.dataVault = { schedule() {}, capture: async () => {} };
    vm.runInContext(`${calendarHelpers}\n${calendarFunctions}\nthis.subscribeCalendar = function () {\n${subscribeBody}\n};\nthis.loadCalendar = function () {\n${loadBody}\n};`, ctx);
    d.ctx = ctx;
    d.open = async () => { const done = new Promise((resolve) => { loaded = resolve; }); ctx.subscribeCalendar(); ctx.loadCalendar(); await done; await settle(); };
    d.titles = () => host(ctx.calEventsRef.current.map((e) => e.title)).sort();
    d.add = async (title, date = "2026-09-25") => { ctx.addCalEvent(date, title, "10:00", "11:00"); await settle(); };
    d.remove = async (title) => { const e = ctx.calEventsRef.current.find((x) => x.title === title); ctx.saveCalEvents(ctx.calDeleteTransform(e.id)); await settle(); };
    d.edit = async (title, updates) => { const e = ctx.calEventsRef.current.find((x) => x.title === title); ctx.editCalEvent(e.id, updates); await settle(); };
    d.wake = async () => { d.suspended = false; const missed = [...d.missed]; d.missed.clear(); missed.forEach(([entry, path]) => entry.cb(snapshotOf(path))); await settle(); };
    d.reconnect = async () => { d.offline = false; d.outbox.splice(0).forEach((send) => send()); await d.wake(); };
    return d;
  }
  const cloudTitles = () => JSON.parse(server.docs.get("users/u1/data/dg-cal-events").value).map((e) => e.title).sort();
  return { server, device, cloudTitles, tick: (ms) => { clock += ms; } };
}

function seeded() {
  const w = world();
  // An event saved before this update: no updatedAt stamp, no tombstones anywhere.
  w.server.docs.set("users/u1/data/dg-cal-events", { value: JSON.stringify([{ id: "lift", date: "2026-09-21", title: "lift", start: "19:30", end: "22:00" }]), localTs: 1000 });
  return w;
}

test("a phone that has not caught up no longer erases an event added on the laptop", async () => {
  const w = seeded();
  const laptop = w.device("laptop"), phone = w.device("phone");
  await laptop.open(); await phone.open();
  phone.suspended = true;                                   // in a pocket: not hearing cloud updates
  w.tick(1000); await laptop.add("Dentist");
  w.tick(1000); await phone.add("Study group");             // added before it caught up
  await phone.wake();
  const all = ["Dentist", "Study group", "lift"];
  assert.deepEqual(w.cloudTitles(), all);
  assert.deepEqual(laptop.titles(), all);
  assert.deepEqual(phone.titles(), all);
  const writes = w.server.writes;                           // the devices agree and stop uploading
  await settle(); await phone.wake(); await settle();
  assert.equal(w.server.writes, writes);
});

test("an offline phone's queued save that lands late does not erase newer events", async () => {
  const w = seeded();
  const laptop = w.device("laptop"), phone = w.device("phone");
  await laptop.open(); await phone.open();
  phone.offline = true;
  w.tick(1000); await phone.add("Gym");                     // queued on the phone
  w.tick(1000); await laptop.add("Dentist");                // newer, reaches the cloud first
  w.tick(1000); await phone.reconnect();                    // the older queued upload replaces the cloud copy...
  await settle();
  const all = ["Dentist", "Gym", "lift"];                   // ...and is merged back instead of winning
  assert.deepEqual(w.cloudTitles(), all);
  assert.deepEqual(laptop.titles(), all);
  assert.deepEqual(phone.titles(), all);
});

test("a delete wins over an out-of-date copy, even for an event saved before this update", async () => {
  const w = seeded();
  const laptop = w.device("laptop"), phone = w.device("phone");
  await laptop.open(); await phone.open();
  phone.suspended = true;
  w.tick(1000); await laptop.remove("lift");
  w.tick(1000); await phone.add("Study group");             // the phone's list still has "lift"
  await phone.wake();
  assert.deepEqual(w.cloudTitles(), ["Study group"]);
  assert.deepEqual(laptop.titles(), ["Study group"]);
  assert.deepEqual(phone.titles(), ["Study group"]);
});

test("an edit is not reverted by a device that saves its older copy of the event", async () => {
  const w = seeded();
  const laptop = w.device("laptop"), phone = w.device("phone");
  await laptop.open(); await phone.open();
  phone.suspended = true;
  w.tick(1000); await laptop.edit("lift", { start: "18:00", end: "20:00" });
  w.tick(1000); await phone.add("Study group");
  await phone.wake();
  for (const d of [laptop, phone]) assert.equal(d.ctx.calEventsRef.current.find((e) => e.title === "lift").start, "18:00");
  assert.equal(JSON.parse(w.server.docs.get("users/u1/data/dg-cal-events").value).find((e) => e.title === "lift").start, "18:00");
});

test("restoring a backup brings deleted events back and they stay", async () => {
  const w = seeded();
  const laptop = w.device("laptop"), phone = w.device("phone");
  await laptop.open(); await phone.open();
  const backup = JSON.parse(JSON.stringify(laptop.ctx.calEventsRef.current));
  w.tick(1000); await laptop.remove("lift");
  assert.deepEqual(phone.titles(), []);
  w.tick(1000); laptop.ctx.saveCalEvents(backup); await settle();   // what restoreCloudBackup does
  assert.deepEqual(w.cloudTitles(), ["lift"]);
  assert.deepEqual(phone.titles(), ["lift"]);
});

test("opening the app merges events saved on this device that never reached the cloud", async () => {
  const w = seeded();
  const phoneStorage = new Map();
  const laptop = w.device("laptop"), phone = w.device("phone", phoneStorage);
  await laptop.open(); await phone.open();
  phone.offline = true;
  w.tick(1000); await phone.add("Gym");                     // saved on the phone, upload never sent
  phone.outbox.length = 0;                                  // e.g. the app was killed
  w.tick(1000); await laptop.add("Dentist");
  w.tick(1000);
  const reopened = w.device("phone", phoneStorage);         // same phone storage, fresh app
  await reopened.open();
  const all = ["Dentist", "Gym", "lift"];
  assert.deepEqual(reopened.titles(), all);
  assert.deepEqual(w.cloudTitles(), all);
  assert.deepEqual(laptop.titles(), all);
});

test("an old device copy does not bring back events deleted before this update", async () => {
  const w = seeded();
  const store = new Map([
    ["dg-owner", "uid:u1"], ["dg-cal-events_ts", "900"],
    ["dg-cal-events", JSON.stringify([{ id: "lift", date: "2026-09-21", title: "lift", start: "19:30", end: "22:00" }, { id: "old", date: "2026-09-01", title: "Old", start: "09:00", end: "10:00" }])],
  ]);
  const phone = w.device("phone", store);
  await phone.open();
  assert.deepEqual(phone.titles(), ["lift"]);
  assert.deepEqual(w.cloudTitles(), ["lift"]);
});

test("nothing is saved before the calendar has loaded (it used to replace the whole calendar)", async () => {
  const w = seeded();
  const tablet = w.device("tablet");
  const result = await tablet.ctx.saveCalEvents((events) => [...events, { id: "x", date: "2026-09-27", title: "Call mom", start: "12:00", end: "12:30" }]);
  assert.equal(result, null);
  assert.deepEqual(w.cloudTitles(), ["lift"]);
  assert.match(tablet.errors[0], /still loading/);
});

test("merge rules: newest version wins, deletes beat older versions, ties resolve the same everywhere", () => {
  const c = {};
  vm.runInNewContext(calendarHelpers, c);
  const e = (id, updatedAt, title = id) => ({ id, title, updatedAt });
  const merge = (...args) => host(c.mergeCalendarEvents(...args));
  assert.deepEqual(merge([e("a", 5, "new")], [e("a", 3, "old")], {}).map((x) => x.title), ["new"]);
  assert.deepEqual(merge([e("a", 5)], [], { a: 6 }), []);
  assert.deepEqual(merge([e("a", 7)], [], { a: 6 }).map((x) => x.id), ["a"]);  // re-added after the delete
  const x = { id: "t", title: "one" }, y = { id: "t", title: "two" };
  assert.deepEqual(merge([x], [y], {}), merge([y], [x], {}));
  const { events, removedIds } = host(c.stampCalendarChanges([e("keep", 1), e("edit", 1), e("gone", 1)], [e("keep", 1), { ...e("edit", 1), title: "changed" }, { id: "new", title: "n" }], 99));
  assert.deepEqual(events.map((v) => [v.id, v.updatedAt]), [["keep", 1], ["edit", 99], ["new", 99]]);
  assert.deepEqual(removedIds, ["gone"]);
});
