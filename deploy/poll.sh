#!/usr/bin/env bash
# Deploys main from the server's side, for when the repository has no deploy secrets: a systemd timer runs this every
# minute (deploy/systemd), and when main has a new commit whose "test" job passed on GitHub, it runs deploy/deploy.sh.
# A commit whose tests failed is skipped; one still being tested is looked at again on the next run.
{
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch --quiet origin main
target=$(git rev-parse origin/main)
[ "$(git rev-parse HEAD)" = "$target" ] && exit 0
skipped=.git/deploy-skipped
[ "$(cat "$skipped" 2>/dev/null)" = "$target" ] && exit 0

# the same GitHub credential git fetches with; passed to curl on stdin so it never shows in the process list
token=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
conclusion=$(printf 'Authorization: Bearer %s\n' "$token" \
  | curl -fsS -H @- -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/guarantorpool/admin-ui/commits/$target/check-runs?check_name=test" \
  | jq -r '.check_runs[0].conclusion // "pending"')

case "$conclusion" in
  success) bash deploy/deploy.sh ;;
  pending|null) exit 0 ;;
  *)
    echo "Not deploying $(git log -1 --format='%h %s' "$target"): its tests ended with $conclusion"
    echo "$target" > "$skipped"
    ;;
esac
exit 0
}
