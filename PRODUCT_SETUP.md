# Daily Grind → Sellable Product: Setup Guide

This is the roadmap for turning Daily Grind into a paid web product.
We do it in safe phases so your **live app never breaks** and your **real data is never lost**.

---

## Phase 1 — Real accounts + security (the urgent one)

**Why first:** Right now anyone who knows a "sync code" can read/write that data.
That's fine for personal use but you can't sell a product with that hole. This phase
replaces sync codes with real logins and locks the database down per-user.

### What YOU do (Firebase console — Claude can't do these)

1. Go to https://console.firebase.google.com → pick the **daily-grind-370cd** project.
2. Left sidebar → **Build → Authentication** → click **Get started** (if not already).
3. **Sign-in method** tab → enable these providers:
   - **Google** → toggle on → pick a support email → Save. (Free, instant.)
   - **Email/Password** → open it → also toggle **Email link (passwordless sign-in)** → Save.
4. **Settings → Authorized domains** → make sure these are listed (add if missing):
   - `feroakdemir-arch.github.io`
   - `localhost`
5. Tell Claude "auth is enabled" — Claude adds the login screen next.

### What CLAUDE does (in code)

- Add a **Sign in** screen (Google button + "email me a link").
- Keep your current sync working **alongside** it so nothing breaks mid-migration.
- After you log in once, **migrate your existing data** to your account (your `uid`).
- Move Firestore data from `sync/{code}/...` to `users/{uid}/...`.

### The security rules (apply LAST, after login works)

Firebase console → **Build → Firestore Database → Rules** tab → replace everything with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Each user can only read/write their own data
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    // (Old sync-code data — leave readable until migration is done, then delete this block)
    match /sync/{code}/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Then click **Publish**. ⚠️ Only do this AFTER Claude confirms login + migration work,
or you'll lock yourself out.

---

## Phase 2 — Free vs Paid split

Decide what's free and what's behind the paywall. Suggested:

| Free | Pro (paid) |
|------|-----------|
| Habits | Cloud sync across devices |
| Tasks | Calendar |
| Timers | Full history + stats |
| (local only) | Multi-device |

Price guidance for this kind of app: **$3–5/month** or **~$30/year**.

---

## Phase 3 — Payments (Stripe)

- Create a Stripe account (https://stripe.com) — ~3% per transaction, no monthly fee.
- Add Stripe Checkout for the subscription.
- A small serverless function (Firebase Cloud Functions or similar) verifies who's paid.
- Claude wires the "Upgrade to Pro" button + gates the Pro features.

---

## Phase 4 — Landing page

A real page that sells it: what it does, screenshots, "Start free" button.
Can live at the root of the same GitHub Pages site or a custom domain
(e.g. dailygrind.app — ~$12/yr).

---

## Phase 5 (later) — iOS App Store

- Wrap the web app with **Capacitor** (same codebase).
- Needs a **Mac** (or cloud Mac) + **$99/yr Apple Developer** account.
- Add **Sign in with Apple** (Apple requires it once you offer Google sign-in on iOS).
- Apple takes 15–30% of App Store sales — that's why we do web first.

---

## Current status

- [x] Phase 1 CODE: Google sign-in button (Settings → Account), account storage
      (`users/{uid}/data`), auto-migration of local data on first sign-in
- [ ] Phase 1 CONSOLE: **YOU enable Google sign-in in Firebase** ← DO THIS NEXT
      (console → Authentication → Sign-in method → Google → enable → save,
       then check Authorized domains includes feroakdemir-arch.github.io)
- [ ] Phase 1 RULES: apply security rules AFTER login is confirmed working
- [ ] Phase 2: free/paid split
- [ ] Phase 3: Stripe payments
- [ ] Phase 4: landing page
- [ ] Phase 5: iOS wrapper

Also shipped: level system (lifetime points → levels + ranks + LEVEL UP moment).
