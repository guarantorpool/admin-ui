# BlockCoop Guarantor Pool Admin

The admin portal for the BlockCoop Guarantor Pool (issue #142 in the backend repo), built from the approved wireframe. React 18, TypeScript, Vite, Tailwind and shadcn/ui. It calls the GP API directly from the browser.

## Run it

```sh
npm install
cp .env.example .env        # then edit if your backend isn't on localhost:8080
npm run dev                 # http://localhost:3001
```

The backend must allow the portal's address for CORS (`CORS_ALLOWED_ORIGINS`). The ports are `3001` (dev) and `3002` (`npm run preview`), the two origins the dev backend allows.

### Settings (`.env`)

| Setting | Default | Used for |
|---|---|---|
| `PORT` | `3001` | Dev server port |
| `PREVIEW_PORT` | `3002` | `npm run preview` port |
| `VITE_API_BASE_URL` | `http://localhost:8080/api` | The GP API. The browser calls it directly, and `api:types` reads the spec from it |
| `VITE_IDLE_LOCK_MINUTES` | `30` | Minutes without activity, across all tabs, before the portal locks; keep it equal to the backend's `app.jwt.admin-idle-minutes` ([D-001](docs/decisions/D-001-sessions-in-local-storage.md)) |
| `VITE_TIME_ZONE` | `Africa/Nairobi` | Time zone every date and time is shown in ([D-002](docs/decisions/D-002-nairobi-time-and-usdt-precision.md)) |
| `VITE_APP_ENV` | `local` | Shown in the header as a badge unless it is exactly `prod`; "Unknown" when unset |

`VITE_` values are built into the bundle and are not secret.

## A local backend with nothing kept

```sh
npm run stack
```

Starts Postgres in a container that keeps its data in memory and is removed when it stops, then the backend from `../BlockCoop` (build its jar first with `./mvnw -DskipTests package`). It prints the first admin's email and a password made up for the run, then every email the backend would have sent, with sign-in codes and links, since no mail server is set. Ctrl+C stops it and deletes the container and the log.

| Setting (for the script only) | Default | |
|---|---|---|
| `BLOCKCOOP_DIR` | `../BlockCoop` | The backend repo |
| `STACK_API_PORT` | `8080` | The backend's port; point `VITE_API_BASE_URL` at it |
| `STACK_ADMIN_EMAIL` | `admin-a@test.local` | The first admin |

On-chain reads, the KES rate and scheduled jobs are off (chain reads go to an address that refuses at once, so nothing leaves the machine), and so is the backend's rate limit. Uploads go to Cloudflare R2, which isn't set up, so uploading a profile image fails locally. The e2e tests stand in for a member's KYC and proof-of-address uploads by adding the upload's record straight into the throwaway database, and answer the signed link to open a file themselves.

Quotes and guarantees are seeded the same way. A real quote needs the member's headroom (backing and network), and a guarantee only exists once the Lipa API's payment passes the callback, Lipa's status check and the on-chain check of its transaction, none of which a local run reaches. So `seedQuote` and `seedGuarantee` in `tests/e2e/helpers.ts` write the quote, the guarantee and its Lipa payment as the backend would. Everything the screens do with them (filters, manual close, approve and reject) goes through the real API.

## Checks

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript, including the generated API types |
| `npm test` | Vitest: formatting, labels, permissions, the menu, the session store, the API client |
| `npm run e2e` | Playwright: the main flows against `npm run stack`'s backend, started and removed by the run. Members are signed up the way the member app does it, with a throwaway wallet (`ethers`, a dev dependency) |
| `npm run api:types` | Regenerates `src/api/schema.d.ts` from the backend's OpenAPI document (`SWAGGER_ENABLED=true`); `-- --file` uses the saved `openapi/gp-api.json` |

Run Playwright's browser install once: `npx playwright install chromium`.

## Hosting

The portal runs on the backend's server, deployed the same way ([D-003](docs/decisions/D-003-hosting-beside-the-backend.md)). [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs Vitest and a build on every push to `main`, then [`deploy/deploy.sh`](deploy/deploy.sh) runs on the server, started over SSH or by the server's timer: it pulls `main`, rebuilds the container and waits for it to be healthy. The image ([`Dockerfile`](Dockerfile)) builds the portal and serves it with Caddy ([`deploy/Caddyfile`](deploy/Caddyfile)), which adds the security headers. The backend's Caddy handles HTTPS on `ADMIN_DOMAIN` and passes requests to this container over the `blockcoop-edge` network, which the backend's compose project creates.

To set it up on the server, as root, once the backend is deployed with `ADMIN_DOMAIN` set (BlockCoop `docs/BACKEND_GUIDE.md`, Running with Docker):

1. Clone this repo beside the backend, e.g. `/root/projects/admin-ui`, the same way the backend was cloned.
2. Copy `.env.example` to `.env` and set `VITE_API_BASE_URL` (e.g. `https://blockcoop.duckdns.org/api`) and `VITE_APP_ENV` (e.g. `dev`). `docker compose` passes them to the build; the ports aren't used on the server. Run `docker compose up -d --build` once.
3. On the backend, set `ADMIN_WEB_URL` to the portal's address, e.g. `https://admin-blockcoop.duckdns.org`, so CORS allows it and admin emails link to it.
4. Choose how deploys start: the server's timer, or the workflow's SSH step.

**The server's timer (no repository secrets needed).** [`deploy/poll.sh`](deploy/poll.sh) runs every minute. When `main` has a new commit and GitHub's `test` job passed for it, it runs `deploy/deploy.sh`. A commit whose tests failed is skipped, and the workflow's deploy job does nothing while the secrets are missing. Install it with:

```sh
cp deploy/systemd/admin-ui-deploy.* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now admin-ui-deploy.timer
journalctl -u admin-ui-deploy -f      # what it deployed or skipped
```

**The workflow's SSH step (needs the repository secrets), as for the backend.**

1. `ssh-keygen -t ed25519 -N "" -f ~/.ssh/gh_actions_admin_ui` and add its public key to `~/.ssh/authorized_keys` as `restrict,command="bash /root/projects/admin-ui/deploy/deploy.sh" ssh-ed25519 AAAA…`, so it can run this deploy and nothing else. The backend's key runs only the backend's.
2. In this repo's Settings → Secrets and variables → Actions, add `DEPLOY_HOST`, `DEPLOY_SSH_KEY` (the whole private key `~/.ssh/gh_actions_admin_ui`) and `DEPLOY_KNOWN_HOSTS`, as for the backend. Change `PORTAL_URL` in the workflow if the domain differs.

Both can run together: `deploy/deploy.sh` takes a lock, so one deploy waits for the other, and the timer finds nothing new to do. The deploy can also be run by hand on the server with `bash deploy/deploy.sh`.

## Decisions

The portal keeps its own [decisions](DECISIONS.md) and [risks](RISKS.md), numbered from D-001 and R-001. Backend decisions are cited by name, for example *BlockCoop D-009*.
