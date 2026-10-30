const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8").replace(/\r\n/g, "\n");
const c = {};
vm.runInNewContext(html.slice(html.indexOf("    const VAULT_PREFIX = "), html.indexOf("    function _byteSize(")) +
  "; this.targets = _vaultTargets;", c);
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const ids = (now, safety) => c.targets(now, safety).map((t) => t.id);
const HOUR = 3600e3, DAY = 24 * HOUR;

test("an automatic backup writes latest plus an hourly, daily and weekly slot, each with its calendar twin", () => {
  const targets = c.targets(at(2026, 10, 29, 14, 5), false);
  assert.equal(JSON.stringify(targets.map((t) => t.kind)), JSON.stringify(["latest", "hourly", "daily", "weekly"]));
  for (const t of targets) assert.equal(t.calendarId, t.id.replace("dg-vault-main-", "dg-vault-calendar-"));
});

test("slots are reused: hourly after 2 days, daily after 30 days, weekly after 26 weeks", () => {
  const now = at(2026, 10, 29, 14, 5);
  const [, hourly, daily, weekly] = ids(now, false);
  assert.equal(ids(now + 2 * DAY, false)[1], hourly);
  assert.notEqual(ids(now + DAY, false)[1], hourly);
  assert.notEqual(ids(now + HOUR, false)[1], hourly);
  assert.equal(ids(now + 30 * DAY, false)[2], daily);
  assert.notEqual(ids(now + 29 * DAY, false)[2], daily);
  assert.equal(ids(now + 26 * 7 * DAY, false)[3], weekly);
  assert.notEqual(ids(now + 25 * 7 * DAY, false)[3], weekly);
});

test("a safety copy goes into one of 144 ten-minute slots of the day", () => {
  const now = at(2026, 10, 29, 9, 31);
  const [slot] = ids(now, true);
  assert.equal(c.targets(now, true)[0].kind, "safety");
  assert.equal(ids(now + 5 * 60e3, true)[0], slot);   // same ten minutes
  assert.notEqual(ids(now + 10 * 60e3, true)[0], slot);
  assert.equal(ids(now + DAY, true)[0], slot);        // kept for a day
});

test("however long the app runs, the vault never holds more than a fixed number of copies", () => {
  const seen = new Set();
  for (let t = at(2026, 1, 1, 0, 0); t < at(2027, 1, 1, 0, 0); t += 10 * 60e3) {
    ids(t, false).forEach((id) => seen.add(id));
    ids(t, true).forEach((id) => seen.add(id));
  }
  assert.equal(seen.size, 1 + 48 + 30 + 26 + 144);
});
