# Calendar reminders

Sends a Web Push notification to each opted-in device 10 minutes before a calendar event. Enable separately from Calendar → Settings on iPhone and computer. On iPhone (iOS 16.4+), add the site to the Home Screen and open that icon first. Sign into the same Google account on both devices. The first device establishes the account's reminder time zone, displayed in Calendar Settings.

Released September 8, 2026 (New York): all six Firebase functions are deployed, Blaze billing is enabled on the owner's existing billing account, and GitHub Pages published merge `eba6286`. The scheduler is enabled and a live invocation returned HTTP 200. The authenticated setup endpoint works; unauthenticated requests return HTTP 401. Active Firestore rules deny client access to the new top-level notification collections. Physical-device opt-in and delivery checks are still required.

## How it works

- `calendar-reminders.js` requests permission only from an explicit click, subscribes using the browser's Push API, and registers the device through authenticated Firebase callable functions.
- `calendar-push-sw.js` receives notifications in the background, checks the active account, displays the event title/time, and opens the correct calendar week. It never caches or intercepts app pages. Clicking a notification messages an already-open app rather than reloading unsaved drafts.
- `functions/index.js` checks calendars every minute, reads `users/{uid}/data/dg-cal-events` as the source of truth, and sends using the Web Push protocol. Existing calendar writes and backup code are unchanged.
- `calendarPushAccounts/{uid}` stores the reminder time zone; `calendarPushDevices/{endpointHash}` stores account-owned device subscriptions; `calendarPushDeliveries/{deliveryHash}` stores delivery claims/receipts. These top-level collections are server-only under the repository's existing Firestore rules. Verify the active rules also deny client access before deploying. No security-rule deployment is bundled into this change.
- Repeating events match the calendar's daily, weekly, weekday, custom-day, exception-date and end-date behavior. Missing spring-forward times are skipped; ambiguous fall-back times use the first occurrence.
- Before sending, a Firestore transaction rechecks the calendar, subscription ownership, enabled status, and receipt. Concurrent runs share a 45-second lease, with at most three attempts and a three-minute catch-up window. Notification tags also collapse matching notifications on the device. Provider success followed by a failed receipt write can still produce an at-least-once retry; exactly-once delivery is not promised.
- Late messages expire at event start. OS notification settings, connectivity, Focus modes, and push-service delays can affect arrival time. A scheduler outage longer than the catch-up window can miss reminders. Devices enabled after an event's reminder time do not receive a retroactive reminder.
- Disabling affects only the current device. Sign-out clears the worker's active owner and unsubscribes locally, including when the server is unreachable. Other devices continue receiving reminders.

## Activate

Use Node 22. Run from the repository root, with the Firebase owner account. Cloud Functions, Cloud Scheduler and Secret Manager require Firebase Blaze billing; verify the project's current billing plan before provisioning. Do not create a billing account or upgrade the plan without the owner's authorization.

```powershell
npm.cmd ci --prefix functions
npx.cmd firebase-tools login
npx.cmd firebase-tools projects:list
node functions/setup-keys.js mailto:YOUR_EMAIL
npx.cmd firebase-tools functions:secrets:set CALENDAR_PUSH_PRIVATE_KEY --data-file functions/.secret.calendar-push-private-key --project daily-grind-370cd
npx.cmd firebase-tools deploy --only functions:calendar-reminders --project daily-grind-370cd
```

`setup-keys.js` refuses to overwrite existing key files. It writes the public key/contact to ignored `functions/.env.daily-grind-370cd`; the private key goes to an ignored file and then Secret Manager. Never publish either generated file or regenerate keys for an existing installation. `firebase.json` explicitly excludes `.env*`, `.secret*`, and the setup script from uploaded source. The worker/browser use the public key obtained from `calendarPushConfig`; private keys never reach the browser.

Deploy the backend first, verify the named functions and once-per-minute scheduler, then merge the frontend branch into `main` to publish through GitHub Pages. Review the resulting function count and scope; this uses the isolated `calendar-reminders` functions codebase. The source-controlled Firebase config intentionally excludes Firestore rules and Hosting.

Delivery receipts include `expiresAt` seven days in the future. Optionally enable Firestore TTL for the `calendarPushDeliveries` collection group after reviewing its cost. TTL is not required for deduplication and must never be applied to calendar, account-data, task-ledger, or recovery-vault collections.

## Verification

```powershell
npm.cmd test --prefix functions
```

21 automated tests cover scheduling, midnight, time zones/DST, repeat exceptions, rescheduling/deletion, malformed data, endpoint validation, authenticated device ownership, retry/expired endpoints, concurrent delivery, permission denial, reload status, offline disable, and notification click handling. Firestore transactions and push providers are simulated in these tests. The isolated browser preview uses synthetic calendar data and mocked notification-service responses; it is not evidence of production push delivery.

Production verification:

1. Confirmed: active Firestore rules deny client access to all three new top-level collections; all six functions deployed; unauthenticated setup requests return HTTP 401; scheduler invocation returned HTTP 200; Pages deployment `34300317865` succeeded. Function build images are retained for seven days through an Artifact Registry cleanup policy.
2. On iPhone Home Screen and desktop, enable reminders and receive the test notification on each.
3. Create an event at least 12 minutes ahead; close the app/tab; confirm both devices receive the reminder approximately 10 minutes before it starts.
4. Tap the notification; confirm the correct week opens. Check event edits, canceled recurring occurrences, and disabling one device.
5. Confirm the same event has one successful delivery receipt per device and inspect scheduler logs for failures without exposing subscription endpoints/keys.

References: [Firebase scheduled functions](https://firebase.google.com/docs/functions/schedule-functions), [Firebase secrets](https://firebase.google.com/docs/functions/config-env), [Web Push library](https://github.com/web-push-libs/web-push), [Apple Home Screen push support](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
