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
| `VITE_IDLE_LOCK_MINUTES` | `5` | Minutes without activity, across all tabs, before the portal locks ([D-001](docs/decisions/D-001-sessions-in-local-storage.md)) |
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

On-chain reads, the KES rate and scheduled jobs are off, and so is the backend's rate limit. Uploads go to Cloudflare R2, which isn't set up, so uploading a profile image fails locally.

## Checks

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript, including the generated API types |
| `npm test` | Vitest: formatting, permissions, the menu, the session store, the API client |
| `npm run e2e` | Playwright: the main flows against `npm run stack`'s backend, started and removed by the run |
| `npm run api:types` | Regenerates `src/api/schema.d.ts` from the backend's OpenAPI document (`SWAGGER_ENABLED=true`); `-- --file` uses the saved `openapi/gp-api.json` |

Run Playwright's browser install once: `npx playwright install chromium`.

## Decisions

The portal keeps its own [decisions](DECISIONS.md) and [risks](RISKS.md), numbered from D-001 and R-001. Backend decisions are cited by name, for example *BlockCoop D-009*.
