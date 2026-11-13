# The portal's static build, served by Caddy on port 80 inside the container (deploy/Caddyfile).
# The VITE_ values are built into the bundle, so they are build arguments, not settings read when it starts.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_BASE_URL
ARG VITE_APP_ENV
ARG VITE_IDLE_LOCK_MINUTES=30
ARG VITE_TIME_ZONE=Africa/Nairobi
# the Content Security Policy lets the browser call the API's origin and nothing else outside the portal (D-003)
RUN test -n "$VITE_API_BASE_URL" && test -n "$VITE_APP_ENV" \
 && npm run build \
 && sed "s|__API_ORIGIN__|$(node -p 'new URL(process.env.VITE_API_BASE_URL).origin')|" deploy/Caddyfile > /Caddyfile

FROM caddy:2.10-alpine
COPY --from=build /Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
HEALTHCHECK --interval=10s --timeout=3s CMD wget -q --spider http://127.0.0.1/ || exit 1
