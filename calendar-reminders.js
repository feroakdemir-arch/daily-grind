/* Device subscription API. Calendar edits continue through the existing storage API. */
(() => {
  const KEY = "dg-calendar-push-device-v1";
  const BASE = "https://us-central1-daily-grind-370cd.cloudfunctions.net/";
  let config = null;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  function support() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios && !(navigator.standalone || matchMedia("(display-mode: standalone)").matches)) return "install";
    if (!isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
    return Notification.permission === "denied" ? "blocked" : "supported";
  }
  function user() {
    const current = firebase.auth().currentUser;
    if (!current || current.isAnonymous) throw new Error("Sign in with Google to enable calendar reminders.");
    return current;
  }
  async function call(name, data = {}) {
    const current = user();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const token = await current.getIdToken();
      const response = await fetch(BASE + name, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ data }), signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.error) throw new Error(body.error?.message || "The reminder service is not available yet. Try again later.");
      if (firebase.auth().currentUser?.uid !== current.uid) throw new Error("Your account changed. Try again.");
      return body.result;
    } catch (error) {
      if (error instanceof TypeError || error.name === "AbortError") throw new Error("Cannot reach the reminder service. Check your connection or try again after setup is complete.");
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function registration(create = false) {
    const url = new URL("calendar-push-sw.js", location.href);
    if (!create) return navigator.serviceWorker.getRegistration(url);
    const reg = await navigator.serviceWorker.register(url, { scope: "./" });
    if (reg.active) return reg;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Notification setup timed out. Try again.")), 10000);
      const worker = reg.installing || reg.waiting;
      if (!worker) { clearTimeout(timer); reject(new Error("Notification worker unavailable.")); return; }
      worker.addEventListener("statechange", () => {
        if (worker.state === "activated") { clearTimeout(timer); resolve(); }
        if (worker.state === "redundant") { clearTimeout(timer); reject(new Error("Notification setup failed.")); }
      });
    });
    return reg;
  }
  async function setOwner(reg, uid) {
    if (!reg?.active) return;
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error("Notification setup timed out.")); }, 5000);
      channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve(); };
      reg.active.postMessage({ type: "SET_PUSH_OWNER", uid }, [channel.port2]);
    });
  }
  function publicBytes(key) {
    return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - key.length % 4) % 4)), c => c.charCodeAt(0));
  }
  async function status() {
    const capability = support();
    if (capability !== "supported") return { state: capability };
    const current = user(), saved = read();
    config = await call("calendarPushConfig");
    if (saved?.uid !== current.uid) return { state: "off", timeZone: config.timeZone };
    const reg = await registration(), sub = await reg?.pushManager.getSubscription();
    if (!sub || Notification.permission !== "granted") return { state: "off", timeZone: config.timeZone };
    const server = await call("calendarPushStatus", { deviceId: saved.deviceId });
    if (server.enabled) {
      await setOwner(reg, current.uid);
      await call("calendarPushRegister", { subscription: sub.toJSON(), timeZone: server.timeZone });
    }
    return { state: server.enabled ? "on" : "off", timeZone: server.timeZone };
  }
  async function enable() {
    const current = user();
    if (support() !== "supported") throw new Error("Open this app in a supported browser and allow notifications first.");
    // Must run directly inside the button's click handler on iOS, before any await.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notifications were not allowed. You can enable them in your device settings.");
    if (!config) config = await call("calendarPushConfig");
    const reg = await registration(true);
    let sub = await reg.pushManager.getSubscription();
    const key = publicBytes(config.publicKey);
    if (sub && String(new Uint8Array(sub.options.applicationServerKey || [])) !== String(key)) {
      await sub.unsubscribe(); sub = null;
    }
    sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    // Persist account ownership in the worker before registering for remote delivery.
    await setOwner(reg, current.uid);
    const result = await call("calendarPushRegister", { subscription: sub.toJSON(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (firebase.auth().currentUser?.uid !== current.uid) { await setOwner(reg, ""); await sub.unsubscribe(); throw new Error("Account changed during setup."); }
    localStorage.setItem(KEY, JSON.stringify({ uid: current.uid, deviceId: result.deviceId }));
    return { state: "on", timeZone: result.timeZone };
  }
  async function disable() {
    const saved = read();
    const reg = "serviceWorker" in navigator ? await registration() : null;
    // Clear local ownership before network calls to suppress any queued old pushes.
    await setOwner(reg, "");
    const sub = await reg?.pushManager.getSubscription();
    let unsubscribed = !sub;
    try { if (sub) unsubscribed = await sub.unsubscribe(); } catch { /* Try server disable too. */ }
    let remoteDisabled = !saved;
    if (saved && firebase.auth().currentUser?.uid === saved.uid) {
      try { await call("calendarPushDisable", { deviceId: saved.deviceId }); remoteDisabled = true; }
      catch (error) { if (!unsubscribed) throw error; }
    }
    if (!unsubscribed && !remoteDisabled) throw new Error("Could not disable notifications. Reconnect and try again.");
    localStorage.removeItem(KEY);
    return { state: "off", timeZone: config?.timeZone };
  }
  async function test() {
    const saved = read();
    if (!saved || saved.uid !== user().uid) throw new Error("Enable reminders on this device first.");
    await call("calendarPushTest", { deviceId: saved.deviceId });
  }
  window.calendarReminders = { status, enable, disable, test, support };
  // Covers sign-out/account changes in another tab. Never subscribe automatically.
  firebase.auth().onAuthStateChanged(async current => {
    config = null;
    const saved = read();
    if (saved && saved.uid !== current?.uid) {
      try { await disable(); } catch { /* Owner was cleared before the network work. */ }
    }
  });
})();
