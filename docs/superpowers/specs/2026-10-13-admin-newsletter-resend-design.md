# Admin newsletter with Resend OAuth

## Goal

Add a Newsletter tab to the existing admin panel so staff can create HTML campaigns, preview and save them, and send them to people who subscribed to the existing newsletter. Connect Resend through OAuth; do not ask administrators to paste an API key into the app.

## Current behavior

- Public newsletter enrollment requires a signed-in user and sets `usuarios/{uid}.newsletter` to `true` through `inscreverNewsletter`.
- User profiles keep the email address in `usuarios/{uid}.email`.
- The admin panel is a static Firebase Hosting page. It verifies `admin` or `dev` roles before starting its Firestore listeners.
- No newsletter sending, campaign history, or Resend integration exists yet.

## Admin experience

Add a Newsletter tab to `/admin/` with:

- Resend connection status and Connect/Disconnect actions.
- A campaign editor with subject, sender selected from verified Resend domains, and raw HTML editing.
- A sandboxed HTML preview that cannot execute scripts or access the admin page.
- Draft save, draft list, send confirmation with the recipient audience/count, and campaign history with draft, sending, queued/sent, failed, or needs-reconciliation status.
- A first-connection step to select or create the Resend Audience used for the newsletter and synchronize existing opted-in profiles.

Saving a draft must never send it. Sending requires a distinct confirmation. The sender must belong to a verified Resend domain. No arbitrary recipient editing is included in the first version.

## Resend connection and authorization

- Use Resend OAuth 2.1 Authorization Code with PKCE and the narrowest scope that supports the selected integration. The approved Broadcast and audience/contact management flow requires `full_access` under the current Resend API scope model.
- Register the OAuth client dynamically once on first connection and store the public client ID in server-managed configuration. The redirect URI is a fixed HTTPS Firebase Hosting rewrite to a callback Cloud Function.
- The admin callable creates a random state and PKCE verifier, persists them with the initiating admin UID and a short expiry, and returns the Resend authorization URL.
- The callback validates and consumes state once, exchanges the code using the stored verifier, and stores the rotating refresh token only in a server-readable Firestore integration document. Never return OAuth tokens to the browser or include them in logs.
- Refresh access tokens server-side before API operations; serialize refreshes so concurrent functions cannot reuse the same rotating refresh token, then persist its replacement before proceeding. If refresh fails or the grant is revoked, report the connection as needing reconnection and do not attempt campaign sends.
- Disconnect revokes the stored grant with Resend when possible and removes the local token document. It does not delete campaigns or subscriber records.

## Subscriber and unsubscribe behavior

- Firestore `usuarios.newsletter == true` with a valid profile email is the initial import set. Do not import profiles without explicit newsletter consent.
- On first setup, synchronize those profiles into the chosen Resend Audience. New opt-ins are added after the Firestore consent write succeeds. If Resend is disconnected or temporarily unavailable, retain the Firestore opt-in and let an admin retry synchronization.
- Resend is the send-time authority for unsubscribe status. Existing unsubscribed Resend contacts must not be re-subscribed during routine synchronization. A new, explicit opt-in can resubscribe that contact.
- Every campaign includes Resend's `{{{RESEND_UNSUBSCRIBE_URL}}}` placeholder in a visible footer so Resend can suppress future broadcasts after unsubscribe.
- Display import/sync results and do not report success for contacts that failed to synchronize.

## Campaign lifecycle and storage

- Store drafts and campaign history in a dedicated `newsletter_campaigns` collection. Persist subject, HTML, chosen sender, author UID, timestamps, lifecycle state, provider broadcast ID, audience ID, and provider/result counts. Do not store OAuth tokens in campaign documents.
- Every campaign callable validates admin role, subject/sender/HTML size, and the required unsubscribe placeholder. The backend selects the audience and recipient state; clients cannot supply arbitrary recipients or provider IDs.
- Sending uses Resend Broadcasts so Resend handles queueing and campaign delivery. The backend locks a draft before calling Resend, records the provider ID/result, and prevents simultaneous sends. The history distinguishes draft, sending, queued/sent, failed, and needs-reconciliation states. If the provider outcome is uncertain, preserve an in-progress state for reconciliation instead of blindly creating and sending a duplicate broadcast.
- Provider errors returned to the admin are safe and actionable; detailed provider responses are logged only after redacting tokens and recipient content.

## Security and access control

- All campaign, audience, synchronization, and connection operations go through authenticated callable functions that call `verificarAdmin`.
- The OAuth callback is public by protocol but accepts only a valid, unexpired, single-use state bound to an admin UID and the expected redirect URI.
- Firestore client rules deny direct reads/writes to OAuth integration state and campaign records. Admin SDK access remains inside validated functions.
- HTML preview uses an iframe sandbox without script execution or same-origin access. Campaign HTML is only rendered as email content and is never inserted into the live admin DOM.

## Error handling and recovery

- Expired/revoked grants prompt reconnection without losing drafts or subscriber consent.
- Audience synchronization is retryable and idempotent by audience plus normalized email; preserve Resend unsubscribe state unless a new explicit opt-in is recorded.
- Campaign sends use a server-side lock and provider broadcast ID to prevent concurrent duplicate sends. Ambiguous provider results require reconciliation before retry.
- Campaign history preserves enough metadata for support without saving secrets; subscriber synchronization reports per-contact success/failure separately from broadcast delivery state.

## Out of scope for the first version

- Scheduling, segmentation, personalization beyond Resend defaults, attachments, analytics dashboards, and transactional email.
- Importing contacts from sources other than the current opted-in Firebase profiles.
- Sending directly from the browser or exposing Resend credentials in client code.

## Acceptance criteria

1. Only staff accounts can connect Resend, manage drafts, synchronize recipients, and send campaigns.
2. OAuth uses PKCE and a one-time state bound to the initiating admin; credentials remain server-side and rotating refresh tokens are persisted safely.
3. Existing opted-in profiles can be synchronized, and unsubscribed Resend contacts are not reactivated by routine synchronization.
4. Admins can save and preview raw HTML drafts without triggering delivery.
5. A send requires confirmation and dispatches a single Resend broadcast to the configured newsletter audience with a visible unsubscribe link.
6. Concurrent/ambiguous send attempts do not automatically create duplicate broadcasts; their status is visible in history.
7. Revoking/disconnecting Resend preserves drafts and consent records and prevents further sends until reconnection.
