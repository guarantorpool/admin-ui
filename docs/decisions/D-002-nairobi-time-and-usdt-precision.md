# D-002: Times are shown in Nairobi time, and USDT to 2 decimals in lists

| Slice | Status | Replaces | Replaced by | Risks |
|---|---|---|---|---|
| All | Accepted | — | — | — |

## Decision

Every date and time is shown in Nairobi time (EAT, UTC+3), whatever the admin's browser is set to, and labelled "EAT" where it matters. It matches the backend (`app.time-zone`) and the receipts members see.

USDT amounts are shown to 2 decimals in lists and cards, and at full precision in detail views and anything entered for approval, so a payout is never approved from a rounded figure. KES and BLOCKS amounts follow the same rule, with their USDT value beside them.

## Why

Agreed on 2 Nov 2026 before the build. Admins may work from anywhere, but the pool's records, deadlines and members are in Kenya.

## Impact

- The time zone is a setting (`VITE_TIME_ZONE`), so a hosted build could show another zone without code changes.
- Amounts are formatted from the decimal strings the API returns, never through a floating-point number, so full precision is exact. Rounding to 2 decimals is half away from zero.
- Some requests take an amount as a JSON number (for example `PayoutRequest.amount`). The slices that enter amounts send exactly the digits typed, and show them in full before approval.

## Still open

- None.
