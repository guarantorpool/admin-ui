# BlockCoop Guarantor Pool Admin: Risk Register

Risks opened by the portal's [design decisions](DECISIONS.md), grouped by status: **Open** first, **Closed** last.

| Status | Meaning |
|---|---|
| Open | Nothing limits it yet, or only in part |
| Mitigated | Mostly limited; follow-up work remains |
| Accepted | The business accepts it as it is |
| Closed | Resolved; the row records what closed it and when |

To change a risk's status, move its row to the matching section. When closing one, fill in **Closed by** (a decision, issue or PR) and **Closed on** (a date).

## Open

**Tally:** 0 risks

| ID | Risk | From | Slice | What limits it now | Still needed |
|---|---|---|---|---|---|

## Mitigated

**Tally:** 1 risk

| ID | Risk | From | Slice | What limits it now | Still needed |
|---|---|---|---|---|---|
| R-001 | **Tokens in `localStorage` can be read by any script on the portal's site.** A cross-site scripting bug, or a bad dependency, could copy an admin's access and refresh tokens. | [D-001](docs/decisions/D-001-sessions-in-local-storage.md) | 1 | No third-party scripts at runtime: fonts and the logo are served by the portal itself. The hosted build's Content Security Policy allows scripts from the portal only and calls to the API only ([D-003](docs/decisions/D-003-hosting-beside-the-backend.md)), so an injected script can't load more code or send the tokens elsewhere. The portal has its own domain, apart from the API and the member app. Access tokens last 30 minutes and admin refresh tokens 12 hours (BlockCoop D-009). The idle lock ends the session on the backend after 5 minutes. "Sign out everywhere" ends every session. | A script already running on the page can still use the tokens against the API itself; accept that or not |

## Accepted

**Tally:** 0 risks

## Closed

**Tally:** 0 risks

| ID | Risk | From | Closed by | Closed on |
|---|---|---|---|---|
