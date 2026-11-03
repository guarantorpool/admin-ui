#!/usr/bin/env bash
# Deploys the latest main on the server: GitHub Actions runs it over SSH (.github/workflows/deploy.yml), with a key
# that can run nothing else, and it can be run by hand. .env is left as it is.
# The braces make bash read the whole script before running it, so the git reset below can replace this file.
{
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch --quiet origin main
git reset --hard --quiet origin/main
echo "Deploying $(git log -1 --format='%h %s')"

docker compose up -d --build --remove-orphans

# done when Caddy serves the portal inside the container (the Dockerfile's HEALTHCHECK)
status=starting
for _ in $(seq 1 12); do
  sleep 5
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q web)" 2>/dev/null || echo missing)
  [ "$status" = healthy ] && break
done

if [ "$status" != healthy ]; then
  echo "The portal is $status after the deploy; its last log lines:"
  docker compose logs web --no-color --tail 60
  exit 1
fi

# images left untagged by the new build
docker image prune -f >/dev/null
echo "Deployed and healthy"
exit 0
}
