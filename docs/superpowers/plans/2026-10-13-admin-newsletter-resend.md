# Admin newsletter with Resend OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin newsletter workspace that connects to Resend with OAuth, synchronizes consented subscribers, and creates, previews, saves, and sends HTML broadcasts.

**Architecture:** Keep the existing Firebase Hosting admin shell and add a focused newsletter browser module. Put Resend OAuth, audience synchronization, and campaign operations behind admin-checked Cloud Functions, with focused service modules that accept injected storage and HTTP dependencies for unit tests. Store drafts and operational state in Firestore; keep all OAuth tokens server-side.

**Tech Stack:** Firebase Hosting, Cloud Functions for Firebase v2 on Node.js 24, Firestore, browser JavaScript, Resend OAuth 2.1 and Broadcast API, Node.js built-in `node:test`.

**Spec:** [2026-10-13-admin-newsletter-resend-design.md](../specs/2026-10-13-admin-newsletter-resend-design.md)

## Global Constraints

- Runtime is Node.js `24`; Cloud Functions use region `southamerica-east1`.
- Existing opt-in is `usuarios/{uid}.newsletter == true`; the profile email is `usuarios/{uid}.email`.
- All admin-only newsletter operations require `admin` or `dev` via `verificarAdmin`; the existing subscription callable remains available to signed-in users making an explicit opt-in.
- Request Resend OAuth `full_access` only for the approved Broadcast and audience/contact management flow.
- OAuth access and refresh tokens stay in server-readable storage and never appear in browser responses or logs.
- The HTML preview iframe has a sandbox without script execution or same-origin access.
- Local and automated verification must not send real email or require an active Resend grant.

## Review Focus

1. **OAuth callback with missing, expired, replayed, or mismatched state:** reject without exchanging the code or persisting tokens. Pin in Task 1.
2. **Two functions refreshing the same rotating token concurrently:** serialize refresh and persist the new refresh token once before returning. Pin in Task 1.
3. **Routine sync sees an already-unsubscribed Resend contact:** preserve the unsubscribe; only a new explicit opt-in can reactivate it. Pin in Task 2.
4. **A campaign send times out after Resend may have accepted it:** mark reconciliation required and do not blindly create/send another broadcast. Pin in Task 3.
5. **Campaign HTML contains script or hostile markup:** preview cannot execute it or reach the admin document. Pin in Task 4.

---

### Task 1: Resend OAuth lifecycle and server integration

**Files:**
- Create: `functions/newsletter/oauth.js`
- Create: `functions/newsletter/oauth.test.js`
- Create: `functions/newsletter/functions.js`
- Modify: `functions/index.js`
- Modify: `functions/package.json`
- Modify: `firebase.json`

**Interfaces:**
- `createNewsletterFunctions({ onCall, onRequest, HttpsError, db, FieldValue, verificarAdmin, fetchImpl, now })` returns Firebase exports `iniciarOAuthResendNewsletter`, `resendNewsletterOAuthCallback`, `obterStatusResendNewsletter`, and `desconectarResendNewsletter`.
- OAuth functions use `full_access`, fixed callback `https://corindivisum.com.br/api/newsletter/resend/callback`, Authorization Code + PKCE S256, one-time state bound to the initiating UID, and a 10-minute state expiry. Dynamic registration requests `authorization_code` and `refresh_token` grants with `token_endpoint_auth_method: "none"`.
- Persist the public DCR client ID and audience selection in `newsletter_config/resend`; keep rotating grant data in the server-only `newsletter_private/resend_grant` document and temporary verifier/state data in a separate `newsletter_oauth_states/{state}` document.
- `getResendAccessToken()` refreshes expiring access tokens and serializes refreshes so the same refresh token is not submitted twice concurrently.

- [ ] **Step 1: Write OAuth tests first** in `functions/newsletter/oauth.test.js` for a valid authorization URL, wrong/expired/replayed state, successful callback persistence, token refresh rotation, and concurrent refresh serialization. Use injected fake storage, clock, and `fetchImpl`; assert that token values never occur in returned status or captured logs.
- [ ] **Step 2: Run the OAuth tests and verify they fail** with missing OAuth service behavior, not test setup errors.

  Run from the repository root: `node --test --test-name-pattern="OAuth|refresh" functions/newsletter/oauth.test.js`

- [ ] **Step 3: Implement OAuth helpers and integration callables** in `functions/newsletter/oauth.js` and `functions/newsletter/functions.js`; register the public client once on first connect, bind state to the current admin, consume it once, exchange the verifier, persist refresh-token rotations, and revoke/delete the local grant on disconnect.
- [ ] **Step 4: Wire Cloud Function exports and callback rewrite** in `functions/index.js` and `firebase.json`; add `"test": "node --test newsletter/*.test.js"` to `functions/package.json`.
- [ ] **Step 5: Run OAuth tests and checks**.

  Run from the repository root: `node --test --test-name-pattern="OAuth|refresh" functions/newsletter/oauth.test.js`

  Expected: all matching tests pass; no live Resend request is made.

---

### Task 2: Resend audience and consent-aware subscriber synchronization

**Files:**
- Create: `functions/newsletter/subscribers.js`
- Create: `functions/newsletter/subscribers.test.js`
- Modify: `functions/newsletter/functions.js`
- Modify: `functions/index.js`

**Interfaces:**
- Add callable exports `listarAudienciasResendNewsletter`, `criarAudienciaResendNewsletter`, `configurarAudienciaNewsletter`, and `sincronizarInscritosNewsletter`; each calls `verificarAdmin`.
- `syncNewsletterSubscriber({ uid, explicitOptIn })` reads the profile in Firestore, requires `newsletter === true` and a valid normalized email, then creates or updates the contact in the configured Resend Segment (the current replacement for deprecated Audiences).
- `syncNewsletterSubscribers()` imports profiles where `newsletter === true`, returns `{ total, synced, skipped, failed }`, and preserves an existing contact's Resend unsubscribe state during routine synchronization.
- Extend existing `inscreverNewsletter` so it first persists the explicit opt-in and then synchronizes that user's contact. A provider failure must not erase consent; return a retryable sync result.

- [ ] **Step 1: Write subscriber tests first** for excluding non-subscribers/invalid emails, idempotent contact sync, preserving existing unsubscribe state on routine sync, re-subscribing only when `explicitOptIn` is true, and rejecting non-staff callers of audience/list/sync callables.
- [ ] **Step 2: Run subscriber tests and verify the expected missing behavior**.

  Run from the repository root: `node --test --test-name-pattern="subscriber|unsubscribe|opt-in" functions/newsletter/subscribers.test.js`

- [ ] **Step 3: Implement the audience and contact adapter** in `functions/newsletter/subscribers.js`; use only the configured audience, normalize email consistently, and never set `unsubscribed: false` during routine import.
- [ ] **Step 4: Add admin callables and hook the existing opt-in** in `functions/newsletter/functions.js` and `functions/index.js`; return per-contact counts without exposing provider tokens or unnecessary provider payloads.
- [ ] **Step 5: Run subscriber tests**.

  Run from the repository root: `node --test --test-name-pattern="subscriber|unsubscribe|opt-in" functions/newsletter/subscribers.test.js`

  Expected: all matching tests pass without contacting Resend.

---

### Task 3: Draft storage, verified senders, and protected broadcast lifecycle

**Files:**
- Create: `functions/newsletter/campaigns.js`
- Create: `functions/newsletter/campaigns.test.js`
- Modify: `functions/newsletter/functions.js`
- Modify: `firestore.rules`

**Interfaces:**
- Add callables `listarRemetentesResendNewsletter`, `salvarRascunhoNewsletter`, `listarCampanhasNewsletter`, and `enviarCampanhaNewsletter`; all require staff authorization.
- Draft input is `{ campaignId?, subject, from, html }`; save returns `{ campaignId }`. The backend verifies that `from` is on an available verified Resend domain, enforces subject/HTML size limits, and requires `{{{RESEND_UNSUBSCRIBE_URL}}}` inside a visible unsubscribe link.
- `listarCampanhasNewsletter({ limit })` returns bounded metadata and HTML only to staff. `enviarCampanhaNewsletter({ campaignId })` takes recipients/audience only from server configuration and records `authorUid`, audience, provider ID, timestamps, state, and result counts in `newsletter_campaigns/{campaignId}`.
- Send states are `draft`, `sending`, `queued`, `sent`, `failed`, and `needs_reconciliation`; a transaction lock prevents a second send from starting while one is active.

- [ ] **Step 1: Write campaign tests first** for valid/invalid draft fields (subject ≤ 200 characters, HTML ≤ 200 KiB), unverified sender rejection, missing unsubscribe token rejection, history capped at 50 entries, rejection of non-staff callers, concurrent send exclusion, and uncertain provider result changing the state to `needs_reconciliation` without starting a second broadcast.
- [ ] **Step 2: Run campaign tests and verify they fail for missing behavior**.

  Run from the repository root: `node --test --test-name-pattern="campaign|broadcast|sender|reconciliation" functions/newsletter/campaigns.test.js`

- [ ] **Step 3: Implement draft validation and Firestore lifecycle** in `functions/newsletter/campaigns.js`; use transaction-based send reservation, call Resend's create-and-send operation once with `send: true`, and preserve ambiguous sends for manual reconciliation.
- [ ] **Step 4: Add verified sender and campaign callables** in `functions/newsletter/functions.js`; redact provider failures before returning safe messages or writing logs.
- [ ] **Step 5: Verify Firestore client rules deny direct reads and writes** to `newsletter_config`, `newsletter_oauth_states`, and `newsletter_campaigns`; only validated Cloud Functions may access OAuth and campaign data.
- [ ] **Step 6: Run campaign tests**.

  Run from the repository root: `node --test --test-name-pattern="campaign|broadcast|sender|reconciliation" functions/newsletter/campaigns.test.js`

  Expected: all matching tests pass; no real campaign is sent.

---

### Task 4: Admin Newsletter tab and HTML preview

**Files:**
- Create: `public/admin/newsletter.js`
- Modify: `public/admin/index.html`
- Modify: `public/admin/admin.js`
- Modify: `public/admin/admin.css`

**Interfaces:**
- Add `data-tab="newsletter"` and `data-panel="newsletter"` to the existing tab system.
- `window.iniciarNewsletterAdmin()` loads connection status and campaigns after existing admin-role verification. UI actions call the exact callables from Tasks 1–3 using the initialized Firebase Functions client, including `criarAudienciaResendNewsletter`.
- Connect opens the returned OAuth URL in a top-level browser window. The callback redirects back to `/admin/?tab=newsletter&resend=connected` without exposing OAuth parameters after processing.
- Editor fields are subject, verified sender, and raw HTML. `iframe.sandbox` is empty; preview content is assigned through `srcdoc`, never inserted into the admin document.
- Save, sync, connect, disconnect, and send are distinct actions. Send confirmation shows campaign subject, selected audience, and active subscribed contact count from Resend.

- [x] **Step 1: Add the Newsletter tab and semantic editor structure** in `public/admin/index.html`; load `newsletter.js` after Firebase initialization.
- [x] **Step 2: Implement connection status and OAuth controls** in `public/admin/newsletter.js`; expose `window.iniciarNewsletterAdmin()` and call it only after the existing `admin`/`dev` role check succeeds in `public/admin/admin.js`.
- [x] **Step 3: Implement the subject/sender/HTML editor and sandboxed preview** in `public/admin/newsletter.js`; assign HTML only to `iframe.srcdoc` and use an empty `sandbox` attribute.
- [x] **Step 4: Implement audience/segment selection, subscriber synchronization, drafts, and campaign history** in `public/admin/newsletter.js` using the exact callable names from Tasks 1–3. Selection requires explicit confirmation and cannot silently switch the segment used for a send.
- [x] **Step 5: Implement the explicit send confirmation** showing subject, selected audience, and active subscribed contact count; disable repeat submission while the send is in progress.
- [x] **Step 6: Apply responsive styles** in `public/admin/admin.css` and ensure the tab remains usable at mobile viewport widths.
- [ ] **Step 7: Verify the HTML preview security invariant** in a browser: script tags in a saved draft do not execute, the iframe cannot access `parent.document`, and changing preview HTML does not mutate the admin page. Browser verification is blocked by Hosting Emulator's redirect to `/login/` and the absence of a local admin-auth harness.
- [ ] **Step 8: Verify the main UI flow with mocked callable responses**: disconnected state → OAuth launch; connect → audience selection and sync; save → reload draft; preview → render; send → confirmation → queued/history state. Do not authorize a real Resend account or send live mail during local verification. Browser verification is blocked by Hosting Emulator's redirect to `/login/` and the absence of a local admin-auth harness.

---

### Task 5: End-to-end local verification and handoff

**Files:**
- No additional files; this is a verification-only task.

**Interfaces:**
- No new public interfaces. Verify the exported function names in `functions/index.js`, callback rewrite target, Firestore deny rules, and callable names used by the UI match Tasks 1–4.

- [x] **Step 1: Run the complete newsletter unit suite** — `node --test functions/newsletter/*.test.js` passes 22 tests.

  Run: `npm --prefix functions test`

  Expected: all tests pass and no test makes an external request.

- [x] **Step 2: Run static checks** for `functions/index.js`, every `functions/newsletter/*.js` file, `public/admin/admin.js`, and `public/admin/newsletter.js`; parse `firebase.json` and run `git diff --check`.

  Run: `node --check functions/index.js`; `Get-ChildItem functions/newsletter -Filter *.js | ForEach-Object { node --check $_.FullName }`; `node --check public/admin/admin.js`; `node --check public/admin/newsletter.js`; `node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8'))"`; `git diff --check`

  Expected: JavaScript syntax/config checks and whitespace checks pass.

- [x] **Step 3: Review the complete diff against the acceptance criteria** in the design spec; confirm no deployment, real OAuth grant, or real email send was performed. Fresh independent review found issues which were fixed; final review reported no remaining concrete blockers.

## Handoff Notes

- User approval of this plan is required before implementation begins.
- Connecting Resend and sending a real campaign are separate operational actions to perform later from the admin interface.
- The implementation must account for existing unrelated working-tree modifications; do not overwrite or revert them.
