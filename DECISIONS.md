# BlockCoop Guarantor Pool Admin: Design Decisions

Decisions about the admin portal itself. The backend's decisions are in the BlockCoop repo and are cited here by name, for example *BlockCoop D-009*, so the two registers never mix. Each decision has its own file in [docs/decisions](docs/decisions/), and the risks they open are in [RISKS.md](RISKS.md).

## Decision log

**Slice** is the build slice the decision belongs to (see the build plan), or **All** when it applies across the portal.

| ID | Decision | Slice | Status | Risks |
|---|---|---|---|---|
| [D-001](docs/decisions/D-001-sessions-in-local-storage.md) | Admin sessions are kept in `localStorage`, shared by every tab, with a lock after 5 minutes without activity | 1 | Accepted | [R-001](RISKS.md) |
| [D-002](docs/decisions/D-002-nairobi-time-and-usdt-precision.md) | Times are shown in Nairobi time, and USDT to 2 decimals in lists and in full where it's approved | All | Accepted | — |
| [D-003](docs/decisions/D-003-hosting-beside-the-backend.md) | The portal is hosted beside the backend on its own domain, deployed the same way, with a strict Content Security Policy | Hosting | Accepted | [R-001](RISKS.md) |
