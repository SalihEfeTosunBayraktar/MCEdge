#!/bin/bash
# Q266 runtime: on a dedicated server, the spec's hurtguard_probe procedure (every 40 ticks) spawns a hurt_guard_mob (health 20) whose
# "When mob is hurt" procedure (hurt_guard, returns logic) lets only hits of 10 or more through, hits it for 4 and then 12 and logs the health
# after each. Expected: "[hurtguard] hurt 4", "[hurtguard] after small 20" (false cancelled the damage), "[hurtguard] hurt 12",
# "[hurtguard] after big 8" (true kept it), no exception from the procedure.
# Needs the test project built on the engines (build.sh). usage: bash tools/codegen-test/hurt-guard-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-hurtguard$$}
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
status=0
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "game mode on (C:/BrainOS/.ingame), not starting a server"; exit 9; }
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-hurtguard.txt > /dev/null 2>&1
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[hurtguard\] .*' $log | sort | uniq -c
  grep -qE '\[hurtguard\] after small 20(\.0)?([^0-9.]|$)' $log || { echo "FAIL: a false hurt procedure did not cancel the damage"; status=1; }
  grep -qE '\[hurtguard\] after big 8(\.0)?([^0-9.]|$)' $log || { echo "FAIL: a true hurt procedure did not keep the damage"; status=1; }
  grep -iE 'exception|procedure.*(error|fail)' $log | head -3
done
exit $status
