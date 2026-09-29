/* Shows the running task or habit timer as a notification, so it sits on the phone's lock screen.
   On an iPhone Home Screen app the notification can't tick by itself; the phone shows how long ago it
   arrived ("now", "5m ago", "25m ago"), and it arrives when the timer starts, so that is the elapsed time.
   Uses the calendar reminders' notification worker; nothing leaves the device. */
(() => {
  const TAG = "dailygrind-timer";
  const KEY = "dg-timer-notified-v1";
  const FRESH_MS = 2 * 60 * 1000;
  const workerUrl = () => new URL("calendar-push-sw.js", location.href);
  const supported = () => {
    try { return isSecureContext && "serviceWorker" in navigator && "Notification" in window; } catch (e) { return false; }
  };
  let current = null, lastKey = null;

  async function registration() {
    let reg = await navigator.serviceWorker.getRegistration(workerUrl());
    if (!reg) reg = await navigator.serviceWorker.register(workerUrl(), { scope: "./" });
    if (reg.active) return reg;
    const worker = reg.installing || reg.waiting;
    if (!worker) return null;
    await new Promise((resolve) => {
      const done = setTimeout(resolve, 10000);
      worker.addEventListener("statechange", () => { if (worker.state === "activated" || worker.state === "redundant") { clearTimeout(done); resolve(); } });
    });
    return reg.active ? reg : null;
  }
  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  async function clear() {
    const reg = await navigator.serviceWorker.getRegistration(workerUrl());
    if (!reg || !reg.getNotifications) return;
    (await reg.getNotifications({ tag: TAG })).forEach((notification) => notification.close());
  }
  async function show(timer) {
    const reg = await registration();
    if (!reg) return false;
    await reg.showNotification(`⏱ ${timer.name}`, {
      body: `Timer running since ${clock(timer.startedAt)}`,
      tag: TAG,
      timestamp: timer.startedAt,
      data: { url: new URL("?timer=1", location.href).href },
      icon: new URL("icon-192.png?v=classic-g", location.href).href,
    });
    return true;
  }

  // The app calls this whenever its data changes, with the running timer ({ kind, id, name, startedAt })
  // or null. A timer that was just started gets a notification; stopping it removes the notification.
  // A timer found already running when the app opens doesn't get a new one (it may have been swiped away).
  // Updates run one after another, each for the newest timer, so two can't post the same notification.
  let queue = Promise.resolve();
  function sync(timer) {
    current = timer || null;
    queue = queue.then(apply, apply);
    return queue;
  }
  async function apply() {
    if (!supported()) return;
    const timer = current;
    const key = timer ? `${timer.kind}:${timer.id}:${timer.startedAt}` : "";
    if (key === lastKey) return;
    lastKey = key;
    let posted = "";
    try { posted = localStorage.getItem(KEY) || ""; } catch (e) {}
    if (key === posted) return;
    try {
      await clear();
      try { localStorage.removeItem(KEY); } catch (e) {}
      if (!timer || Notification.permission !== "granted" || Date.now() - timer.startedAt > FRESH_MS) return;
      if (await show(timer)) { try { localStorage.setItem(KEY, key); } catch (e) {} }
    } catch (error) {
      console.warn("Timer notification failed:", error);
    }
  }

  // Asked when a timer is started (the tap is what lets the phone show the question). Once allowed,
  // the timer that was just started gets its notification.
  function askPermission() {
    if (!supported() || Notification.permission !== "default") return;
    try {
      Promise.resolve(Notification.requestPermission()).then((permission) => {
        if (permission === "granted") { lastKey = null; sync(current); }
      }).catch(() => {});
    } catch (e) {}
  }

  window.timerNotify = { sync, askPermission };
})();
