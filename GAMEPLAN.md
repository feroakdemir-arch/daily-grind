# DAILY GRIND — Master Gameplan & Session Handoff
*Last updated: September 2026. This file is the source of truth for continuing work in any session.*

---

## 1. WHAT THIS IS

The user's own product: a habit tracker + task lists + synced notes + time-blocked calendar + pomodoro
that scores your day in points. Hit your daily goal → win the day → streaks → XP → levels
→ ranks (ROOKIE → GRINDER → OPERATOR → MACHINE → RELENTLESS → UNSTOPPABLE → LEGEND → GOAT).
Plus a **Store**: spend earned points on real-life rewards (cheat day, rest day, sleep in).

- **Live:** https://feroakdemir-arch.github.io/daily-grind/
- **Code:** ONE file — `index.html` in this repo (`daily-grind-deploy`). React 18 + Babel standalone, inline styles object `S` at bottom. NOT the old Vite project (`Videos/Claude/daily-grind/daily-grind` is stale/abandoned).
- **Deploy:** push to `main` → GitHub Pages, live in ~60s. User must hard-refresh (Ctrl+Shift+R).
- **Backend:** Firebase project `daily-grind-370cd` — anonymous + Google auth, Firestore.
- **Owner:** feroakdemir@gmail.com (GitHub: feroakdemir-arch). Owner's daily goal: 250.

## 2. CURRENT PRODUCT STATE (all shipped & verified)

- **Accounts:** Google sign-in required for new visitors (welcome gate). Cloud data is account-only at `users/{uid}/data/`; the legacy sync-code client is retired. Existing device data remains usable locally and migrates into an account when the user signs in.
- **Security rules:** target policy is versioned in `firestore.rules`: users can only access their own tree and the retained legacy `/sync` archive is denied to all clients. The console rule must be published after explicit owner confirmation.
- **Data safety stack:** richness guard (empty starter can NEVER overwrite real data, in get() AND the live-sync listener), authentication resolves before choosing local vs cloud data, corrupt/failed loads are blocked instead of showing a writable empty starter, no auto-save while on a fresh starter, monotonic timestamps + serialized cloud writes prevent rapid edits arriving out of order, visible save/sync status with manual retry, account-owned local caches are isolated and cleared on sign-out, and `resetStamp` propagates intentional resets. Cross-device wipe paths are guarded. Firestore's durable multi-tab cache retains queued writes across browser sessions, and same-browser tabs broadcast new snapshots immediately instead of waiting for the cloud round trip. Every task is also mirrored to an independent per-task recovery record with deletion tombstones; these records are merged into startup and live-sync snapshots so a stale whole-app write cannot erase an added task. Every successful main-data or calendar edit is debounced into paired latest/hourly/daily/weekly Firestore recovery copies with SHA-256 integrity checks and monthly metadata indexes; DailyGrind never auto-deletes those copies. All destructive habit/task/list/history/note/store/calendar actions, full reset, and every restore create a unique pre-action safety copy first and abort if a signed-in cloud copy cannot be made. Main and calendar payloads are deeply normalized and shape-validated before rendering, saving, or restoring. Notes make a synchronous on-device last-chance save when the tab hides or closes; new task text is also journaled on every keystroke and promoted into the task list on blur, tab hide, close, or recovery after an interrupted session. Settings includes paired recovery history/restore and a checksummed full JSON download/import for an off-platform copy.
- **XP system:** goal-normalized (100% of goal = 100 XP, cap 150/day) so point inflation can't buy levels. Curve: L2=100 XP, L5≈700, L10≈2700, L20≈10.4k.
- **Store:** wallet = lifetime raw points − spent. Defaults priced off dailyGoal (Sleep In 0.75×, Skip Gym 1×, Friends 1×, Rest Day 1.5×, Cheat Day 2×). Custom rewards, inline edit (✎), purchase log, buy overlay. Spending NEVER touches XP/level/history.
- **Tasks:** per-list completed history w/ dates and tracked work time, paginated 10 + Load More; daily lists archive completions before reset. New-task rows save through Enter, an explicit Add button, or clicking away, and unfinished text survives an abrupt close without duplicating the recovered task. The input shows a saving state until both the main account copy and the independent task recovery record confirm; closing during that window is guarded. Each pending task has a persistent cumulative Start/Stop timer; starting a different task stops the current one, and completing a running task stops it automatically. Drag reorder everywhere (habits/tasks/lists) with auto-scroll; task handles can also move tasks directly between lists with highlighted/empty-list drop targets. Task editor: points, deadlines (+chips), move between lists, send to pomodoro, or create/reopen a linked Task Notes page where the timer, completion control, and task editor stay available. **Steps / subtasks (Oct 9):** a task can be broken down into steps (`task.subtasks = [{ id, name, done }]`, helpers `normalizeSubtasks` / `editSubtasks` / `resetSubtasks` before `parseMainData`). "+ Break down" (or tapping the task name) opens a full-width step list under the task: check off, tap to rename, remove, add. The pill shows `2/5 steps`; when every step is done the pill and the task circle turn green, but the task itself is NOT auto-completed (checking it off still earns its points; steps carry no points). Daily lists uncheck steps at reset. Steps have ids, so `_merge3` merges them step by step across devices. Tests: tests/subtasks.test.cjs.
- **Notes:** dedicated edge-to-edge, full-viewport OneNote-style workspace with a notebook/section rail, searchable page list, full writing canvas, quick formatting helpers, auto-save through the main account data, pinning, editing, and confirmed deletion. Desktop fills all space between the app header and bottom navigation with independently scrolling columns; mobile stays stacked and scrollable. Existing tags act as notebook sections so older notes migrate without data changes. **Read view + Import (Sep 26):** `note-markdown.js` renders a page's markdown (headings, bold/italic, lists, tables, quotes, rules, safe links) as formatted HTML; it escapes all text and emits only a fixed tag set, so the `dangerouslySetInnerHTML` in the module-level `NoteMarkdownView` is safe. Pages that look like markdown open in the read view; a "◉ Read view / ✎ Edit" toolbar toggle switches (not saved per page, the editor paper and NOTE_FONT_STACK are untouched). The IMPORT button beside "+" turns a .md/.txt file (≤200 KB) into a new page titled from its first heading. Tested in `tests/note-markdown.test.cjs`.
- **Habits:** past-day editing (weekly dots + monthly calendar, both), auto-skip (red ✗) for unmarked days at rollover incl. multi-day gaps, history score recomputes on past edits. **Habit timers (Sep 29):** each habit has the same Start/Stop pill as tasks (`WorkTimerPill`); time is kept per day in `data.habitTime[date][habitId]`, a running timer sits on the habit as `timerStartedAt` + `timerDate` (the day it counts toward). One timer runs at a time across tasks and habits (`stopTimers`), and checking a habit ✓ stops its timer. **Auto ✓ habits (Oct 9):** `item.autoDone` ("Auto ✓: done unless I slip" switch in the add/edit habit form, "AUTO ✓" pill on the card) for things being quit. Today an unmarked one reads as done everywhere through `getTL()` = `withAutoDone(log[today], sections)` (score, counts, card dots/streak/% via the card-local `log`); the saved log stays unmarked, so turning the switch off undoes it. At day close `stampClosedDay` stamps it "done" (other required habits "skip", optional untouched). Only a ✗ makes it fail, and a required ✗ still costs its points. Tests: tests/habit-autodone.test.cjs.
- **Running timer on the lock screen (Sep 29):** `timer-notify.js` posts "⏱ <name> · Timer running since 2:15 PM" (tag `dailygrind-timer`, through the calendar push worker) when a task/habit timer starts on this device or arrives within 2 minutes of starting, and removes it when the timer stops anywhere. iPhone web apps can't show a ticking clock; the phone's "25m ago" on the notification is the elapsed time. Permission is asked on the first Start tap. Tapping it opens the timer's page (`OPEN_TIMER` / `?timer=1`). Not yet verified on the owner's iPhone.
- **Calendar:** custom repeat days, 3-option recurring delete (this/following/all), configurable day window incl. past-midnight spillover, drag-safe on mobile. The grid starts early enough for events before "Day starts at" and draws every event exactly once (`calendarGridStartHour` / `calendarSpillCutoffMin`: a next-day event goes under the previous column only if its own column cannot show it); the calendar shows a loading state until its events arrive; Add/Edit refuse a blank time or Custom with no days; Repeat None keeps the event on the edited day; repeating events are changed through Edit, not dragged.
- **Pomodoro:** looping alarm until Start/Reset, tab-title countdown + 🔔. **Check off (Sep 30):** the "Working on" line has a check circle. "Send to Pomodoro" remembers the task (`pomoLink.taskId`; kept on the device in `dg-pomo-focus-v1`), and `findPomoTask` also links a typed name that exactly matches one task; checking it here runs `toggleTask` (points, done date, stops its timer) and unchecking undoes it; checking it in the list shows DONE here. A typed task that isn't in any list is only ticked locally.
- **Design:** full dark system (#0b0b14 shell), tactile buttons, XP shimmer, dark popups. Feels dialed, not vibecoded.

### ⚠️ Technical landmines (do not step on)
- **Babel/React CDN versions are PINNED** (`@babel/standalone@7.29.7`, react 18.3.1). Babel 8 broke the app once (white screen). NEVER unpin.
- **Components must stay module-level** (HabitCard, TaskListCard). Defining components inside DailyGrind causes remount-on-every-keystroke bugs (hit us twice: FW focus bug, HabitCard).
- Syntax-check before pushing: extract babel script → esbuild → node --check.
- **Persistence rule:** all main-data edits must go through `save(current => next)` so rapid actions compose against `dataRef`; calendar edits must go through `saveCalEvents(events => next)`. Never call Firestore directly from a component or put storage side effects inside a React state updater.
- **Type system (Sep 23):** interface = Archivo (expanded width via `.display` for the score, headings and clocks), numbers = IBM Plex Mono via `.num`, both from Google Fonts; body uses tabular digits so timers never jiggle. The note paper is pinned to `NOTE_FONT_STACK` ('SF Mono','Fira Code','JetBrains Mono',monospace) because pen strokes and the PDF are pixel-aligned to it: never change that stack and never load a webfont with one of those names, or every existing note's ink drifts.
- **Two-device merge (Sep 24):** `daily-grind-v13` and `dg-cal-events` upload through `_upload` → a Firestore **transaction** (`_mergingWrite`). Each device keeps the cloud version its data came from in `<key>_base` / `<key>_basever` (`rev:localTs:writer`). If the cloud moved on since that base, `_merge3(base, local, remote)` merges field-by-field and list-items-by-`id` (delete on one side + edit on the other keeps the edit; `walletSpent` adds up; a new `resetStamp` wins outright), so offline/concurrent edits on two devices both survive. Never go back to a blind `ref.set` for these two keys. A device without a base (storage full) must MERGE with no base (keeps everything), never overwrite (Sep 27: that overwrite lost a whole evening of calendar edits). Offline uploads fail fast and retry on `online` / every 60 s; on the next open `get()` uploads unsynced device edits (merged). Tested end to end in `tests/two-device-sync.test.cjs` (two simulated devices, one fake server).
- **Stale calendar guard + client lock (Sep 28):** a phone saved its day-old calendar over the new one (a stale value sent with an up-to-date base replaces outright). Now (1) a calendar save can't remove 3+ of the cloud's events unless it names them: deletes pass `saveCalEvents(fn, { removing: "diff" })`, restores `{ removing: true }` (since Sep 29 this decides which removals get delete markers in `_stampCalendarSave`); (2) merged saves carry `client: _SYNC_CLIENT` and firestore.rules require it (`>= 6` since Sep 29). When a sync fix must reach every device, raise both numbers, push the app FIRST, then deploy the rules (the other order locks out the current app).
- **Newer edit wins (Sep 28 PM):** a field changed on both devices used to keep the UPLOADING device's value, so a phone reopening with day-old unsynced edits undid the laptop's newer ones. Now `_merge3(..., localWins)` keeps the side edited later: each save records its real edit time (`editedAt` in the payload and the cloud doc; `<key>_edited` on the device), and a re-send of the value the device already holds (retry, reopen) keeps its original edit time.
- **Calendar merges one event at a time (Sep 29, client 6):** the same Sep 27 morning calendar kept coming back (Sep 28 9:46 AM, 1:45 PM, Sep 29 7:28 AM, 9:34 AM). Cause: tabs of one browser share `<key>_base` in localStorage, but each tab has its own in-memory calendar; a tab that slept saw the base already at the newest version, skipped the update, and its next save (sent with that newest base) replaced the cloud outright. Now: (1) `set()` stamps `edited` on the events a save really changed, compared with `_tabCopy` (per tab: what this tab's app last received or saved, compared in `parseCalendarData` form), and deletes leave markers (`removed` id→time in the cloud doc and `dg-cal-events_removed` on the device; unnamed removals of 3+ get no marker); (2) the transaction, `get()` and `_receiveRemote` all use `_mergeCalendar`: newest `edited` wins per event, a tie keeps the cloud's, a marker beats older versions, and once the cloud doc has `stampedSince` an unstamped event only the device has is dropped (deleted before markers existed); the base is no longer used for the calendar; (3) `_receiveRemote` delivers a version to a tab whose `_tabCopy` is behind even when the shared base already matches, and tabs re-check localStorage when they become visible. Re-sends (`value === localStorage`) and merges (`{ merged: true }`) never stamp. Tests: the Sep 29 cases at the end of `tests/two-device-sync.test.cjs` (they fail on the old code).
- **Free-plan read limit (Sep 30):** the project is on Spark (50k reads/day, resets midnight Pacific = 3 AM Eastern). Sep 29 11 PM → Sep 30 7 AM an idle background copy read ~100k task records (QUERY reads, 10–18k/hour, almost no writes: the task-record query re-ran ~100×/hour; the app's own code doesn't loop, verified by counting in the preview, so it's the SDK re-listening in a background page). Quota ran out at ~10:26 AM → every save failed. Now the task-record listener (`_ledgerConnection`) pauses after 30 s hidden and resumes on visible, a failed listener retries on a 1→10 min backoff instead of on every `list()`, and quota errors show "SAVED ON DEVICE · CLOUD DAILY LIMIT REACHED". Check reads with Cloud Monitoring `firestore.googleapis.com/document/read_count` (type QUERY vs LOOKUP) after changes that touch listeners. Blaze (pay-as-you-go) would remove the hard stop for cents; owner's decision. **Daily read budget (Sep 30 PM):** normal days use 1–10k reads, nearly all task-record QUERY reads (every fresh listen re-read all ~146). Now each device keeps `dg-task-ledger-copy-v1` (per account, cleared on sign-out) and listens only to `kind == task && updatedAt > syncedTo − 2 min` (composite index in `firestore.indexes.json`; without it the query errors failed-precondition and falls back to the full read). A per-device ceiling (`_ledgerBudget`, `dg-cloud-reads-v1`: 1,200/hour, 5,000/day, day = UTC−8) stops live task sync until it resets; Settings shows the count. Drawing live-sync runs every 4 s (was 1 s; each save = 1 read + writes).
- **Locked-out copies must be able to update (Sep 30):** after the client-6 rules, an old laptop copy showed "cloud sync failed" forever: it only auto-reloaded with no unsynced changes, and every refused save IS an unsynced change. Now `safeToReload()` only blocks on typing, an open note, another view, or `storage.hasUnstoredChanges()` (a change the device couldn't store, storage full); unsynced changes are on the device and upload after the reload. A refusal keeps its reason (save()'s catch appends it), the banner then reads "APP OUT OF DATE · TAP TO UPDATE" (tap = flush + reload), and a refused copy reloads by itself as soon as a new version is live. Before raising `_SYNC_CLIENT` again, remember copies older than this one still have the old rule: they need a manual reload.
- **Account size (Sep 24):** the account doc is capped at `MAX_SAFE_DOC_BYTES` (900 KB). Note ink/text boxes/images are serialized ONCE via `serializeMainData` (maps only; `parseMainData` rebuilds each note's copy) — always write the account with `serializeMainData`, never `JSON.stringify(data)`. Settings shows an account-storage meter; the header warns at 70%. Next growth fix if needed: archive old `log`/`history`/`completedLog` out of the main doc (check XP/level math first).
- **Rules (Sep 24, repo only until deployed):** `firestore.rules` now denies anonymous sessions and ALL client deletes under `users/` (the app never deletes docs). Deploy with `firebase deploy --only firestore:rules` after owner OK.
- **Notes PDF mirrors the editor:** `note-pdf.js` lays text out with the editor's exact metrics (monospace font stack, 14px, line-height 1.8, tabs at 8-character stops, wrap at the locked `pageWidth`) and scales text + ink by ONE factor so strokes stay on their characters. If the note textarea font/line-height/tab-size ever changes, change the `NOTE_*` constants in `note-pdf.js` too. The paper fills the editor (`minWidth: pageWidth`), but body text keeps wrapping at `pageWidth` — never let the wrap width follow the window or anchored strokes drift.
- **Recovery vault:** paired backup documents live beside account data using `dg-vault-main-*` and `dg-vault-calendar-*`; month-sharded metadata uses `dg-vault-index-YYYY-MM`. Never reuse those prefixes for normal storage keys, never auto-delete vault documents, and always validate/checksum a vault copy before restore. `window.dataVault` is the only supported vault API.

## 3. MARKETING FOUNDATION (in progress — foundation skill, steps confirmed so far)

### Avatar (LOCKED)
16–26, ~70/30 male, Gen Z students / young hustlers, "lock in" culture (gymtok, studytok,
monk mode). Native language: ranked games/XP, gym PRs, W/L records, Duolingo streaks.
NEVER: corporate productivity-speak.
**Lived pains:** 1am scroll-guilt ("did nothing today"), app graveyard (perfect Notion setup
abandoned day 4), Habitica = kids' costume, knows the routine/can't stay consistent,
watching peers pull ahead, REST GUILT (can't rest without feeling like a fraud).
**Identity:** wants to be "that guy" — operator, not gamer.
**Persuasion:** show don't lecture (screen recordings w/ real numbers), builder story,
gaming language native IF aesthetic stays dark/serious, free-first buyers, enemy = childish
gamification (Habitica) on one side / sterile checklists (Notion) on the other.

### Audience strategy decision (LOCKED after debate)
- User does AI/faceless content, $50k TikTok Shop revenue — avatar-agnostic content machine.
- So: **test 3 angles, let data pick the wedge** (~3 weeks):
  - A: 16–26 lock-in kid — "POV: proof you locked in today" (screen-recorded W days, LEVEL UP)
  - B: 25–40 side-hustle/discipline — "You track your business numbers. Why not track you?" (zero slang)
  - C: Rest-guilt (spans both) — **"You don't take cheat days. You earn them."** (store demo — most differentiated angle, nobody else has it)
- Young users pay at student prices: **$4.99/mo or $29.99/yr** (Cal AI/Duolingo playbook).
  Free users = growth engine (viral loop, social proof). 30–50 founders rejected as wedge:
  unreachable via his channels, already served by Notion/Motion, no viral loop.
- Funnel calibration: Shop content sells a checkout; app content sells a DAILY LOOP.
  Money shot = screen-recorded "win the day" moment, not feature lists.

### Necessary beliefs (LOCKED)
1. **Foundational:** "My problem isn't knowledge, it's invisible effort" — untracked days don't compound.
2. **Urgency:** "Winging it isn't neutral — drifting IS the decision."
3. **Structural:** "Discipline sticks when it's a game I can win TODAY — an adult one." (kills Habitica AND checklists)
4. **Rest-economy:** "Rest I earned isn't a betrayal." (the store belief — most differentiated)
5. **Brand/mechanism (in EVERY piece):** "Daily Grind is the only adult scoreboard — whole day = one score, win or lose, points buy real-life rewards."
6. Close (folds into CTA): free, first W today.

### Foundation remaining (next session)
- **Step 1.5: objection mining** — mine Habitica reviews/app-store complaints + habit-app dropout reasons (voice of customer). NEXT UP.
- Step 2: unique mechanism (draft exists in belief 5, needs locking)
- Step 3: belief map across awareness ladder (assign beliefs → content angles)
- Core desires (likely #7 confidence/self-worth primary, #4 status secondary)
- Consolidate → Foundation Brief (save as file per foundation skill format)

## 4. NAME + DOMAIN (decision pending — USER'S NEXT MOVE)

Verified available via live RDAP (June 2026):
- **score.day** ← top pick (short, literal, age-agnostic; CHECK PRICE — may be premium)
- **earnyour.day** ← ties to store slogan "you don't take cheat days, you earn them"
- **grindboard.app** ← coined word, "adult scoreboard", keeps grind identity
- grindday.app, grindstreak.app, dailygrind.io, dailygrind.day (backups)
- TAKEN: dailygrind.app/.com, grind.day, winyour.day, lockedin.app, grindscore.*, dayscore.*

**User's steps:** check TikTok handle for the pick → buy at Cloudflare/Porkbun → tell Claude.
**Then Claude does:** full in-app rename (title/icon/manifest/welcome), GitHub Pages custom
domain + DNS records, add domain to Firebase authorized domains.

## 5. ROADMAP (order locked)

1. ~~Accessible to anyone~~ ✅ (should friend-test once)
2. **Name + domain** ← current step (user buying)
3. Finish foundation → marketing brief → start posting 3-angle test content
4. **Stripe payments** — user creates Stripe account w/ 2FA (10 min), then Claude builds:
   free vs Pro split (Pro: unlimited custom rewards, streak shields, full history?),
   Payment Link first → webhook + Cloud Function later. Price: $4.99/mo / $29.99/yr.
5. App Store later via Capacitor (web-first strategy; Windows fine, cloud build for iOS).

### Feature backlog (agreed good ideas, not yet built)
- **Streak Shield** store item (mechanical: protects streak on a missed day — Duolingo's
  most-monetized feature; natural Pro/paid item)
- Platform-managed/offsite database backups when revenue justifies it (the in-app versioned Firestore vault + downloadable JSON backup already ship)

## 6. HOW TO VERIFY CHANGES (works in sandbox)

Launch config `daily-grind-static` serves the repo on :4321. Screenshots often time out —
use javascript_tool evals instead: seed localStorage `daily-grind-v13`, reload, assert on
document.body.innerText / localStorage. Always esbuild-syntax-check before pushing.
