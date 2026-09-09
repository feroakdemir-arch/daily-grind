"use strict";
const { DateTime, IANAZone } = require("luxon");
const { createHash } = require("node:crypto");
const REMINDER_MINUTES = 10;
const LOOKBACK_MINUTES = 3;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const validZone = (zone) => typeof zone === "string" && IANAZone.isValidZone(zone);

function parseEvents(value) {
  const events = JSON.parse(value);
  if (!Array.isArray(events)) throw new Error("Invalid calendar");
  for (const e of events) {
    if (!e || typeof e.id !== "string" || !e.id || typeof e.title !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !DateTime.fromISO(e.date).isValid ||
        !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(e.start)) throw new Error("Invalid calendar event");
  }
  return events;
}

function occursOn(e, date) {
  if (date < e.date || e.exceptions?.includes(date)) return false;
  // Match the calendar UI: the original date is always a direct occurrence.
  if (date === e.date) return true;
  if (!e.repeat || (e.untilDate && date >= e.untilDate)) return false;
  const weekday = DateTime.fromISO(date, { zone: "UTC" }).weekday % 7;
  if (e.repeat === "daily") return true;
  if (e.repeat === "weekdays") return weekday >= 1 && weekday <= 5;
  if (e.repeat === "weekly") return DateTime.fromISO(e.date, { zone: "UTC" }).weekday % 7 === weekday;
  return e.repeat === "custom" && Array.isArray(e.repeatDays) && e.repeatDays.includes(weekday);
}

function dueReminders(events, zone, nowMs) {
  if (!validZone(zone)) throw new Error("Invalid calendar time zone");
  const now = DateTime.fromMillis(nowMs, { zone });
  const end = now.plus({ minutes: REMINDER_MINUTES });
  const begin = end.minus({ minutes: LOOKBACK_MINUTES });
  const dates = new Set([begin.toISODate(), end.toISODate()]);
  const result = [];
  for (const date of dates) for (const e of events) {
    if (!occursOn(e, date)) continue;
    const [hour, minute] = e.start.split(":").map(Number);
    let start = DateTime.fromObject({ ...DateTime.fromISO(date).toObject(), hour, minute }, { zone });
    // Skip nonexistent spring-forward times; choose the first fall-back occurrence.
    if (!start.isValid || start.hour !== hour || start.minute !== minute) continue;
    start = start.getPossibleOffsets().sort((a, b) => a.toMillis() - b.toMillis())[0];
    if (start < begin || start > end || start <= now) continue;
    result.push({ eventId: e.id, date, startMs: start.toMillis(), title: e.title.slice(0, 160),
      timeLabel: start.toFormat("h:mm a"), zone,
      key: hash(JSON.stringify([e.id, date, start.toMillis(), zone])) });
  }
  return result;
}

function validateSubscription(sub) {
  if (!sub || typeof sub.endpoint !== "string" || sub.endpoint.length > 2048) throw new Error("Invalid push subscription");
  const url = new URL(sub.endpoint);
  const host = url.hostname;
  const allowed = host === "fcm.googleapis.com" || host === "web.push.apple.com" ||
    host.endsWith(".push.apple.com") || host === "updates.push.services.mozilla.com" ||
    host.endsWith(".push.services.mozilla.com") || host.endsWith(".notify.windows.com");
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !allowed) {
    throw new Error("Unsupported push service");
  }
  const keys = sub.keys;
  if (!keys || !/^[A-Za-z0-9_-]{87}=?$/.test(keys.p256dh || "") ||
      !/^[A-Za-z0-9_-]{22}=?=?$/.test(keys.auth || "") ||
      Buffer.from(keys.p256dh, "base64url").length !== 65 ||
      Buffer.from(keys.auth, "base64url").length !== 16) throw new Error("Invalid push keys");
  return { endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function canClaim(receipt, now) {
  return !receipt || (receipt.state !== "sent" && receipt.state !== "failed" &&
    (receipt.attempts || 0) < 3 && (receipt.leaseUntil || 0) <= now);
}
module.exports = { REMINDER_MINUTES, dueReminders, parseEvents, occursOn, validZone, validateSubscription, hash, canClaim };
