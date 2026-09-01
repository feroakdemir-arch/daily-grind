# Daily Grind → Sellable Product: Setup Guide

This is the roadmap for turning Daily Grind into a paid web product.
We do it in safe phases so your **live app never breaks** and your **real data is never lost**.

---

## Phase 1 — Real accounts + security

Google sign-in and per-account storage are live. All three existing account records have
their own `users/{uid}/data` collection. The legacy sync-code client has been retired.

The source-controlled security policy is in `firestore.rules`. The active Firebase policy
must match it:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    // Keep the old migration archive, but make it administrator-only.
    match /sync/{code}/{document=**} {
      allow read, write: if false;
    }
  }
}
```

The old `/sync` records are retained as an administrator-only emergency archive rather
than deleted. Client applications cannot read or change them.

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

- [x] Phase 1 CODE: Google sign-in, account storage, legacy client retirement
- [x] Phase 1 DATA: all existing account records have account-scoped data collections
- [ ] Phase 1 RULES: publish `firestore.rules` to close the legacy `/sync` access rule
- [ ] Phase 2: free/paid split
- [ ] Phase 3: Stripe payments
- [ ] Phase 4: landing page
- [ ] Phase 5: iOS wrapper

Also shipped: level system (lifetime points → levels + ranks + LEVEL UP moment).
