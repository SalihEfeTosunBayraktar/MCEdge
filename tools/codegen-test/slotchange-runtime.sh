#!/bin/bash
# Q203 runtime: on a dedicated server, /slotprobe (slotprobe/<engine>/SlotProbe.java, copied into the built test
# project for the run and removed afterwards) opens watch_gui over a ruby_chest for two fake players. Its onSlotChanged
# (slot_changed) logs "[slot] <id> <count> changes <n>" with n counted in the chest's block data. The log must be
# exactly EXPECT: nothing on an idle broadcast, one line for a click (slot 0), a shift click (target slot 1), a
# procedure write (slot 1) and a change of the chest itself (slot 0), each once although two menus show the chest, and
# one line for slot 2 although the procedure rewrites slot 2 every time it runs. Needs the test project built (build.sh).
# usage: bash tools/codegen-test/slotchange-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-slot$$}
E=${@:-forge-1.16.5 neoforge-1.21.5}
EXPECT="[watch] start
[watch] idle
[slot] 0 5 changes 1
[watch] clicked
[slot] 1 10 changes 2
[watch] shifted
[slot] 1 2 changes 3
[watch] written
[slot] 0 0 changes 4
[watch] chest
[slot] 2 1 changes 5
[watch] loop true 5
[watch] end"
status=0
for e in $E; do
  probe=tools/codegen-test/project/out/$e/src/main/java/dev/mcedge/wavethree/custom/SlotProbe.java
  mkdir -p "$(dirname $probe)"
  cp tools/codegen-test/slotprobe/$e/SlotProbe.java $probe
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-slotprobe.txt > /dev/null 2>&1
  rm -f $probe
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  got=$(grep -oE '\[(watch|slot)\].*' $log | tr -d '\r')
  echo "$got"
  [ "$got" == "$EXPECT" ] || { echo "MISMATCH (expected the lines in EXPECT)"; status=1; }
done
exit $status
