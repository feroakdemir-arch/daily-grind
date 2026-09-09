"use strict";
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString, defineSecret } = require("firebase-functions/params");
const webpush = require("web-push");
const { randomUUID } = require("node:crypto");
const { dueReminders, parseEvents, validZone, validateSubscription, hash, canClaim } = require("./calendar");
initializeApp();
const db = getFirestore();
const publicKey = defineString("CALENDAR_PUSH_PUBLIC_KEY");
const contact = defineString("CALENDAR_PUSH_CONTACT");
const privateKey = defineSecret("CALENDAR_PUSH_PRIVATE_KEY");
const SITE = "https://feroakdemir-arch.github.io/daily-grind/";
const options = { region: "us-central1", maxInstances: 3, timeoutSeconds: 30,
  cors: ["https://feroakdemir-arch.github.io"] };
const devices = db.collection("calendarPushDevices");
const accounts = db.collection("calendarPushAccounts");
const receipts = db.collection("calendarPushDeliveries");

function userId(req) {
  if (!req.auth || req.auth.token.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", "Sign in to enable calendar reminders.");
  }
  return req.auth.uid;
}
function deviceId(data) {
  if (!/^[a-f0-9]{64}$/.test(data?.deviceId || "")) throw new HttpsError("invalid-argument", "Invalid device.");
  return data.deviceId;
}
function sendPush(device, payload, ttl) {
  return webpush.sendNotification(device.subscription, JSON.stringify({ ...payload, owner: device.uid }), {
    TTL: ttl, urgency: "high", timeout: 10000,
    vapidDetails: { subject: contact.value(), publicKey: publicKey.value(), privateKey: privateKey.value() }
  });
}

exports.calendarPushConfig = onCall(options, async (req) => {
  const uid = userId(req);
  const account = (await accounts.doc(uid).get()).data();
  return { publicKey: publicKey.value(), timeZone: account?.timeZone || null, minutesBefore: 10 };
});

exports.calendarPushRegister = onCall(options, async (req) => {
  const uid = userId(req);
  let subscription;
  try { subscription = validateSubscription(req.data?.subscription); }
  catch { throw new HttpsError("invalid-argument", "This browser did not supply a valid push subscription."); }
  if (!validZone(req.data?.timeZone)) throw new HttpsError("invalid-argument", "Invalid time zone.");
  const id = hash(subscription.endpoint);
  const result = await db.runTransaction(async (tx) => {
    const accountRef = accounts.doc(uid);
    const account = (await tx.get(accountRef)).data();
    const currentDevice = (await tx.get(devices.doc(id))).data();
    // Endpoints are bearer secrets. Possession permits reassignment on shared devices.
    const existing = await tx.get(devices.where("uid", "==", uid));
    if (existing.docs.filter(d => d.data().enabled && d.id !== id).length >= 20) {
      throw new HttpsError("resource-exhausted", "You have reached the limit of 20 reminder devices.");
    }
    const timeZone = account?.timeZone || req.data.timeZone;
    tx.set(accountRef, { enabled: true, timeZone, updatedAt: Timestamp.now() }, { merge: true });
    tx.set(devices.doc(id), { uid, subscription, enabled: true,
      // Refreshes preserve test rate limiting; changing accounts resets it.
      lastTestAt: currentDevice?.uid === uid ? currentDevice.lastTestAt || 0 : 0,
      enabledAt: currentDevice?.uid === uid && currentDevice.enabled ? currentDevice.enabledAt : Date.now(),
      updatedAt: Timestamp.now() });
    return { deviceId: id, timeZone, enabled: true };
  });
  return result;
});

exports.calendarPushDisable = onCall(options, async (req) => {
  const uid = userId(req), id = deviceId(req.data);
  await db.runTransaction(async (tx) => {
    const ref = devices.doc(id), device = (await tx.get(ref)).data();
    if (device?.uid === uid) tx.update(ref, { enabled: false, updatedAt: Timestamp.now() });
  });
  return { enabled: false };
});

exports.calendarPushStatus = onCall(options, async (req) => {
  const uid = userId(req), id = deviceId(req.data);
  const device = (await devices.doc(id).get()).data();
  const account = (await accounts.doc(uid).get()).data();
  return { enabled: device?.uid === uid && device.enabled === true, timeZone: account?.timeZone || null };
});

exports.calendarPushTest = onCall({ ...options, secrets: [privateKey] }, async (req) => {
  const uid = userId(req), id = deviceId(req.data);
  const device = await db.runTransaction(async (tx) => {
    const ref = devices.doc(id), d = (await tx.get(ref)).data();
    if (!d?.enabled || d.uid !== uid) throw new HttpsError("failed-precondition", "Enable reminders on this device first.");
    if (Date.now() - (d.lastTestAt || 0) < 30000) throw new HttpsError("resource-exhausted", "Wait 30 seconds before sending another test.");
    tx.update(ref, { lastTestAt: Date.now() });
    return d;
  });
  try {
    await sendPush(device, { title: "Organized Me reminders are ready", body: "Calendar events will remind you 10 minutes before they start.",
      tag: "dailygrind-test", url: SITE + "?calendar=1" }, 60);
  } catch (error) {
    if ([404, 410].includes(error.statusCode)) await disableExpired(id, device.subscription);
    throw new HttpsError("unavailable", "The test could not be delivered. Try enabling reminders again.");
  }
  return { sent: true };
});

async function disableExpired(id, subscription) {
  await db.runTransaction(async tx => {
    const ref = devices.doc(id), current = (await tx.get(ref)).data();
    if (JSON.stringify(current?.subscription) === JSON.stringify(subscription)) tx.update(ref, { enabled: false });
  });
}

async function deliver(uid, deviceId, reminder) {
  const key = hash(JSON.stringify([uid, deviceId, reminder.key]));
  const ref = receipts.doc(key), claimId = randomUUID();
  const claimed = await db.runTransaction(async (tx) => {
    const now = Date.now();
    const [receiptSnap, deviceSnap, calendarSnap, accountSnap] = await Promise.all([
      tx.get(ref), tx.get(devices.doc(deviceId)), tx.get(db.doc(`users/${uid}/data/dg-cal-events`)), tx.get(accounts.doc(uid))
    ]);
    const receipt = receiptSnap.data(), device = deviceSnap.data(), account = accountSnap.data();
    if (!canClaim(receipt, now) || !device?.enabled || device.uid !== uid || !account?.enabled) return null;
    // Read the authoritative calendar again inside the claim. Edits/deletions, repeat
    // exceptions and changed times invalidate stale work before sending.
    const fresh = dueReminders(parseEvents(calendarSnap.data()?.value || "[]"), account.timeZone, now)
      .find(r => r.key === reminder.key);
    if (!fresh || device.enabledAt > fresh.startMs - 10 * 60000) return null;
    tx.set(ref, { uid, state: "sending", attempts: (receipt?.attempts || 0) + 1,
      claimId, leaseUntil: now + 45000, expiresAt: Timestamp.fromMillis(now + 7 * 86400000) });
    return { device, reminder: fresh };
  });
  if (!claimed) return;
  let state = "sent";
  try {
    const r = claimed.reminder;
    const ttl = Math.max(1, Math.floor((r.startMs - Date.now()) / 1000));
    await sendPush(claimed.device, { title: "Calendar reminder", body: `${r.title} starts at ${r.timeLabel}.`,
      tag: "dailygrind-" + key, url: SITE + "?calendar=1&date=" + r.date }, ttl);
  } catch (error) {
    if ([404, 410].includes(error.statusCode)) {
      await disableExpired(deviceId, claimed.device.subscription);
      state = "failed";
    } else {
      state = "retry";
      console.warn("Calendar push delivery failed", { code: error.statusCode || "network" });
    }
  }
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.claimId === claimId) tx.update(ref, { state, leaseUntil: 0, updatedAt: Timestamp.now() });
  });
}

exports.sendCalendarReminders = onSchedule({ schedule: "* * * * *", timeZone: "UTC", region: "us-central1",
  timeoutSeconds: 120, maxInstances: 1, retryCount: 0, secrets: [privateKey] }, async () => {
  let cursor;
  do {
    let query = accounts.where("enabled", "==", true).orderBy("__name__").limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const account of page.docs) {
      try {
        const calendar = await db.doc(`users/${account.id}/data/dg-cal-events`).get();
        const due = dueReminders(parseEvents(calendar.data()?.value || "[]"), account.data().timeZone, Date.now());
        if (!due.length) continue;
        const targets = await devices.where("uid", "==", account.id).get();
        for (const r of due) {
          await Promise.all(targets.docs.filter(d => d.data().enabled).map(d => deliver(account.id, d.id, r)));
        }
      } catch (error) {
        // Avoid event titles, endpoints, or keys in logs. A broken account must not
        // prevent unrelated users from receiving their reminders.
        console.error("Calendar reminder account failed", { account: hash(account.id).slice(0, 12), code: error.code || "invalid-calendar-or-delivery" });
      }
    }
    cursor = page.size === 100 ? page.docs[page.docs.length - 1] : null;
  } while (cursor);
});
