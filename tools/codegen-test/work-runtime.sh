#!/bin/bash
# Q262 runtime: on a dedicated server, a ruby_worker (ai_work: condition work_on = redstone block at 20 100 20, tick
# procedure work_tick logs "[work] tick") must log ticks only between "work-phase-on" and "work-phase-off2"
# (the commands place and remove the redstone block), about 20 per second while on, none before, and only the few ticks of the stop delay after (a running goal would log about 160).
# Needs the test project built on the engines (build.sh). usage: bash tools/codegen-test/work-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-work$$}
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
status=0
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "game mode on (C:/BrainOS/.ingame), not starting a server"; exit 9; }
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-workprobe.txt > /dev/null 2>&1
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  before=$(awk '/work-phase-on/{exit} /\[work\] tick/{n++} END{print n+0}' $log)
  during=$(awk '/work-phase-on/{on=1} /work-phase-off2/{on=0} on&&/\[work\] tick/{n++} END{print n+0}' $log)
  after=$(awk '/work-phase-off2/{on=1} on&&/\[work\] tick/{n++} END{print n+0}' $log)
  echo "ticks before=$before during=$during after=$after"
  [ "$before" -eq 0 ] || { echo "FAIL: ticks before the condition held"; status=1; }
  [ "$during" -ge 40 ] || { echo "FAIL: too few ticks while the condition held"; status=1; }
  [ "$after" -le 5 ] || { echo "FAIL: ticks after the condition ended"; status=1; }
done
exit $status
