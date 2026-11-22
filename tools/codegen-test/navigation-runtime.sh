#!/bin/bash
# Q261 runtime: on a dedicated server, the spec's nav_probe procedure (server_ticks trigger) walks the pig summoned at
# 0 100 0 to 10.5 100 0.5 with entity_navigate_to; entity_navigation_done must be false while it walks ("[nav] walking")
# and true once it arrived ("[nav] arrived"). The pig stands on a stone floor built by the commands (no player needed).
# Needs the test project built on the engines (build.sh). usage: bash tools/codegen-test/navigation-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-nav$$}
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
status=0
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "game mode on (C:/BrainOS/.ingame), not starting a server"; exit 9; }
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-navprobe.txt > /dev/null 2>&1
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[nav\].*' $log | sort | uniq -c
  for pattern in '\[nav\] go$' '\[nav\] walking$' '\[nav\] arrived$'; do
    grep -qE "$pattern" $log || { echo "MISSING: $pattern"; status=1; }
  done
  grep -q "pig-at-target" $log || { echo "MISSING: pig-at-target"; status=1; }
done
exit $status
