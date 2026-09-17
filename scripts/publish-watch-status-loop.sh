#!/usr/bin/env bash
#
# Refresh and publish the watch feed every five minutes for about an hour.
#
# The previous inline version of this loop silently stopped publishing for a
# whole run at a time. Its push path was:
#
#     git push                              # fails: checkout leaves a detached HEAD
#     git pull --rebase origin main         # conflicts: both sides edit the same JSON
#
# The failed rebase left a .git/rebase-merge directory behind, so every later
# cycle in that hour died with "there is already a rebase-merge directory" while
# the job still reported success. Run 34316801797 ran for 62 minutes and
# published nothing.
#
# Two changes stop that recurring:
#   * push explicitly to the branch, so a detached HEAD is not fatal;
#   * never rebase. data/watch-status.json and data/oracle-live.json are fully
#     regenerated every cycle, so there is nothing in a losing commit worth
#     keeping. Drop it, take the remote tip, and let the next cycle republish
#     five minutes later.
#
# Deliberately not `set -e`: one bad cycle must not end the run.
set -uo pipefail

BRANCH="${BRANCH:-${GITHUB_REF_NAME:-main}}"
INTERVAL="${REFRESH_INTERVAL_SECONDS:-300}"
WINDOW="${REFRESH_WINDOW_SECONDS:-3900}"
FILES=(data/watch-status.json data/oracle-live.json data/ftso-delegations.json
       data/network-position.json data/fse-entity.json data/fse-entity-ftso.json)

# The delegation snapshot used to be published by its own workflow on a four-hour
# cron, so the home page and the operator dashboard - which read it - showed a
# reward epoch one behind the live feed for hours at a time. It rides this loop
# instead, but not every cycle: its refresh pulls the 16MB oracle payload, so
# every third cycle (15 minutes) keeps upstream load sane while still being
# sixteen times fresher than the cron it replaces.
DELEGATION_EVERY="${DELEGATION_EVERY_CYCLES:-3}"

# Network position and the two Flare Systems Explorer snapshots were on the same
# kind of two-hour cron, which is where the FTSO 6h/24h figures were coming from
# - so those could be two hours behind. Same treatment, but offset by one cycle
# so the two heavier refreshes never land in the same one.
POSITION_EVERY="${POSITION_EVERY_CYCLES:-3}"
END=$(( $(date +%s) + WINDOW ))
cycles=0
published=0
unchanged=0
failures=0

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# Clear anything a previous run left behind, and make sure we are on a branch
# rather than the detached HEAD actions/checkout can leave.
reset_to_remote() {
  git rebase --abort >/dev/null 2>&1
  rm -rf .git/rebase-merge .git/rebase-apply
  git fetch -q origin "$BRANCH" || return 1
  git checkout -q -B "$BRANCH" FETCH_HEAD || return 1
  git reset -q --hard FETCH_HEAD || return 1
  return 0
}

# 0 = published, 1 = failed, 2 = nothing to publish, 3 = lost the race (retryable).
attempt_publish() {
  node scripts/update-oracle-mirror.mjs >/dev/null || echo "  oracle mirror failed"
  node scripts/update-watch-status.mjs >/dev/null || return 1

  if [ $(( cycles % DELEGATION_EVERY )) -eq 1 ]; then
    node scripts/update-ftso-delegations.mjs >/dev/null \
      || echo "  delegation snapshot failed this cycle"
  fi

  if [ $(( cycles % POSITION_EVERY )) -eq 2 ]; then
    node scripts/update-network-position.mjs >/dev/null \
      || echo "  network position snapshot failed this cycle"
  fi

  if git diff --quiet -- "${FILES[@]}"; then
    echo "  no change this cycle"
    return 2
  fi

  git add -- "${FILES[@]}"
  git commit -q -m "Update live data snapshots" || return 1

  if git push -q origin "HEAD:${BRANCH}" 2>/dev/null; then
    echo "  published"
    return 0
  fi

  # Another workflow landed first. The payload is regenerated from scratch, so
  # the losing commit holds nothing worth keeping: drop it, take their tip, and
  # rebuild on top straight away rather than losing the whole five-minute slot.
  echo "  push lost the race; resyncing and rebuilding"
  reset_to_remote || return 1
  return 3
}

publish() {
  local try rc
  for try in 1 2 3; do
    attempt_publish
    rc=$?
    [ "$rc" -ne 3 ] && return "$rc"
  done
  echo "  still losing the race after 3 attempts; next cycle will retry"
  return 1
}

reset_to_remote || echo "::warning::initial resync failed; working from the checkout as-is"

while :; do
  cycles=$(( cycles + 1 ))
  echo "--- cycle ${cycles} ($(date -u +%H:%M:%SZ))"

  publish
  case $? in
    0) published=$(( published + 1 )) ;;
    2) unchanged=$(( unchanged + 1 )) ;;
    *)
      failures=$(( failures + 1 ))
      echo "::warning::publish failed on cycle ${cycles}"
      ;;
  esac

  NOW=$(date +%s)
  REMAIN=$(( END - NOW ))
  if [ "$REMAIN" -lt "$INTERVAL" ]; then
    echo "--- window complete after ${cycles} cycles"
    break
  fi
  sleep "$INTERVAL"
done

echo "Branch: ${BRANCH}"
echo "Cycles: ${cycles}, published: ${published}, unchanged: ${unchanged}, failed: ${failures}"

# A run where every cycle failed is a real breakage, not a flaky upstream.
if [ "$cycles" -gt 0 ] && [ "$failures" -eq "$cycles" ]; then
  echo "::error::Every cycle failed to publish."
  exit 1
fi
