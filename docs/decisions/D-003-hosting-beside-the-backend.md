# D-003: The portal is hosted beside the backend, with a strict Content Security Policy

| Slice | Status | Replaces | Replaced by | Risks |
|---|---|---|---|---|
| Hosting | Accepted | — | — | [R-001](../../RISKS.md) |

## Decision

The portal runs on the backend's server, on its own domain (`admin-blockcoop.duckdns.org` on the dev server), and is deployed the way the backend is: every push to `main` is tested, then GitHub Actions logs in over SSH with a key that can only run `deploy/deploy.sh`, which pulls `main` and rebuilds the container.

Until this repository has the deploy secrets, which only its owner can add, a systemd timer on the server deploys instead: every minute it looks for a new commit on `main` whose tests passed on GitHub, and runs the same `deploy/deploy.sh` (`deploy/poll.sh`). A tested commit goes live within about a minute either way.

The container is Caddy serving the built files. The backend's Caddy handles HTTPS for both domains and passes the portal's requests to it over a shared Docker network (`blockcoop-edge`).

Every response carries a Content Security Policy that allows scripts from the portal itself only, and API calls to the API's origin only (taken from `VITE_API_BASE_URL` when the image is built). The theme script that ran inline in `index.html` is now a file (`public/theme.js`) so the policy needs no exception for it.

## Why

Agreed on 3 Nov 2026. One server and one deploy pattern for both: no second host to pay for or look after. A domain of its own keeps the portal's `localStorage`, which holds the admin's tokens (D-001), apart from the API's and the member app's sites. The policy is what R-001 asked for: a script injected through a bug or a bad dependency can't load more code from elsewhere, or send the tokens anywhere but the API.

## Impact

- The `VITE_` values are fixed when the image is built, from the server's `.env`; changing one means a redeploy, not a restart.
- The backend must be deployed first: its compose project creates the `blockcoop-edge` network, and its Caddy serves `ADMIN_DOMAIN`.
- Anything that later loads from another site (a map, an analytics script, a font CDN) is refused by the browser until the policy is changed here.
- Opening an uploaded file is a navigation to its signed link, which the policy doesn't restrict.
- Playwright isn't run on deploy, since it needs the backend's local stack; Vitest and a build are.

## Still open

- None.

<details>
<summary>Details</summary>

| Header | Value | For |
|---|---|---|
| `Content-Security-Policy` | `script-src 'self'`; `connect-src 'self'` and the API's origin; `style-src 'self' 'unsafe-inline'`; `img-src` and `font-src` `'self' data:`; `object-src 'none'`; `base-uri 'none'`; `frame-ancestors 'none'` | R-001. Inline styles are allowed because Radix positions menus and dialogs with style attributes and sonner adds its own style element |
| `Strict-Transport-Security` | `max-age=31536000`, without `includeSubDomains` | HTTPS only; duckdns.org's other names aren't ours |
| `Referrer-Policy` | `no-referrer` | Reset and invite links carry a token in their query |
| `X-Content-Type-Options` | `nosniff` | |
| `Permissions-Policy` | camera, microphone, location and payment off | |
| `Cache-Control` | `immutable` for `/assets/*` (hashed names), `no-cache` for everything else | A deploy shows at the next visit |

Neither Caddy keeps an access log, since reset and invite links carry a token.

</details>
