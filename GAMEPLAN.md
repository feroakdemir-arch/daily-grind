# DAILY GRIND — Master Gameplan & Session Handoff
*Last updated: August 2026. This file is the source of truth for continuing work in any session.*

---

## 1. WHAT THIS IS

The user's own product: a habit tracker + task lists + time-blocked calendar + pomodoro
that scores your day in points. Hit your daily goal → win the day → streaks → XP → levels
→ ranks (ROOKIE → GRINDER → OPERATOR → MACHINE → RELENTLESS → UNSTOPPABLE → LEGEND → GOAT).
Plus a **Store**: spend earned points on real-life rewards (cheat day, rest day, sleep in).

- **Live:** https://feroakdemir-arch.github.io/daily-grind/
- **Code:** ONE file — `index.html` in this repo (`daily-grind-deploy`). React 18 + Babel standalone, inline styles object `S` at bottom. NOT the old Vite project (`Videos/Claude/daily-grind/daily-grind` is stale/abandoned).
- **Deploy:** push to `main` → GitHub Pages, live in ~60s. User must hard-refresh (Ctrl+Shift+R).
- **Backend:** Firebase project `daily-grind-370cd` — anonymous + Google auth, Firestore.
- **Owner:** feroakdemir@gmail.com (GitHub: feroakdemir-arch). Owner's daily goal: 250.

## 2. CURRENT PRODUCT STATE (all shipped & verified)

- **Accounts:** Google sign-in required for new visitors (welcome gate). Data per-account at `users/{uid}/data/`. Legacy sync codes still work for signed-out users with data.
- **Security rules published:** users can only touch their own data; legacy `sync/{code}` open to any authed user (delete that block once owner's phone is signed in with Google).
- **Data safety stack:** richness guard (empty starter can NEVER overwrite real data, in get() AND the live-sync listener), no auto-save while on fresh starter, retry on transient cloud read failures, `resetStamp` lets intentional resets propagate. Cross-device wipe bug is dead.
- **XP system:** goal-normalized (100% of goal = 100 XP, cap 150/day) so point inflation can't buy levels. Curve: L2=100 XP, L5≈700, L10≈2700, L20≈10.4k.
- **Store:** wallet = lifetime raw points − spent. Defaults priced off dailyGoal (Sleep In 0.75×, Skip Gym 1×, Friends 1×, Rest Day 1.5×, Cheat Day 2×). Custom rewards, inline edit (✎), purchase log, buy overlay. Spending NEVER touches XP/level/history.
- **Tasks:** per-list completed history w/ dates and tracked work time, paginated 10 + Load More; daily lists archive completions before reset. Each pending task has a persistent cumulative Start/Stop timer; starting a different task stops the current one, and completing a running task stops it automatically. Drag reorder everywhere (habits/tasks/lists) with auto-scroll. Task editor: points, deadlines (+chips), move between lists, send to pomodoro.
- **Habits:** past-day editing (weekly dots + monthly calendar, both), auto-skip (red ✗) for unmarked days at rollover incl. multi-day gaps, history score recomputes on past edits.
- **Calendar:** custom repeat days, 3-option recurring delete (this/following/all), configurable day window incl. past-midnight spillover, drag-safe on mobile.
- **Pomodoro:** looping alarm until Start/Reset, tab-title countdown + 🔔.
- **Design:** full dark system (#0b0b14 shell), tactile buttons, XP shimmer, dark popups. Feels dialed, not vibecoded.

### ⚠️ Technical landmines (do not step on)
- **Babel/React CDN versions are PINNED** (`@babel/standalone@7.29.7`, react 18.3.1). Babel 8 broke the app once (white screen). NEVER unpin.
- **Auto-recovery hardcode:** `index.html` has owner-email-gated auto-restore from `sync/123` (search `dg-autorecover-v1` / `isOwner`). Remove once owner confirms recovery is complete. `sync/123` in Firestore = frozen backup of owner's full data (33 habits, 121 main tasks, 60 days history).
- **Components must stay module-level** (HabitCard, TaskListCard). Defining components inside DailyGrind causes remount-on-every-keystroke bugs (hit us twice: FW focus bug, HabitCard).
- Syntax-check before pushing: extract babel script → esbuild → node --check.

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
- Server-side backups when revenue justifies it
- Remove owner auto-recovery hardcode after confirmation
- Delete legacy `sync/{code}` rules block once owner's phone is on Google sign-in

## 6. HOW TO VERIFY CHANGES (works in sandbox)

Launch config `daily-grind-static` serves the repo on :4321. Screenshots often time out —
use javascript_tool evals instead: seed localStorage `daily-grind-v13`, reload, assert on
document.body.innerText / localStorage. Always esbuild-syntax-check before pushing.
