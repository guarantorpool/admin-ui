# D-001: Admin sessions are kept in localStorage, with a 5-minute lock

| Slice | Status | Replaces | Replaced by | Risks |
|---|---|---|---|---|
| 1 | Accepted | — | — | [R-001](../../RISKS.md) |

## Decision

The access and refresh tokens are stored in `localStorage`, so every tab shares one session and opening a new tab doesn't ask for a sign-in.

After 5 minutes without activity in any tab (`VITE_IDLE_LOCK_MINUTES`), the portal locks every tab: it ends the session on the backend and clears the tokens, but remembers the email. Each tab keeps its page. Unlocking means signing in again, with the password and a new code, and every tab carries on where it was. A tab opened after the 5 minutes have passed starts locked.

Only one tab refreshes the tokens at a time, using the browser's Web Locks: each refresh token works once, and the backend answers a second use with 401.

## Why

Agreed on 2 Nov 2026 before the build. Admins work across several tabs, such as a member in one and their guarantee in another, and a sign-in for each tab would be a code email each time (BlockCoop D-009). The lock limits how long an unattended screen stays open.

## Impact

- `blockcoop-admin.session` holds the tokens, `blockcoop-admin.activity` the last activity time across tabs, and `blockcoop-admin.locked` the locked email. Tabs follow one another through storage events.
- On sign-in the activity time is written before the session, so another tab never sees the new session as already idle.
- "Sign out" ends this session in every tab. "Sign out everywhere" and changing the password end every session on every device, as the backend does.
- Pages read by one admin are cleared from memory when the session ends, so the next admin to sign in on that browser doesn't see them.

## Still open

- None.

<details>
<summary>Details</summary>

| Event | What happens |
|---|---|
| A request finds the access token within 30 seconds of expiry | The tab refreshes first, under the lock; a tab that waited finds the new tokens stored and uses them |
| A request is refused with 401 | The tab refreshes once and tries again |
| The refresh token is refused, or has expired | The session is cleared and every tab goes to sign-in, coming back to its page after |
| No activity in any tab for the idle time | Every tab locks within 15 seconds, or as soon as a background tab comes back into view |
| The backend can't be reached when locking | The tokens are still cleared; the refresh token expires on its own |

</details>
