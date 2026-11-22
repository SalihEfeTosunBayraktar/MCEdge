#!/bin/bash
# Q264 runtime: on a dedicated server, the spec's hold_probe procedure (every 40 ticks) spawns its own pig and minecart, puts a
# diamond pickaxe in the pig's main hand and a torch in its off hand (player_set_hand_item), reads them back, swings both arms
# (entity_swing_arm) and logs "[hold] swung", then calls the same blocks on the minecart (a non-living entity: no error, hand stays empty).
# Expected log lines: "[hold] pig main minecraft:diamond_pickaxe off minecraft:torch", "[hold] swung", "[hold] minecart main minecraft:air"
# (item id of an empty stack is air), no exception from the procedure. The client animation cannot be seen headless.
# Needs the test project built on the engines (build.sh). usage: bash tools/codegen-test/hold-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-hold$$}
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
status=0
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "game mode on (C:/BrainOS/.ingame), not starting a server"; exit 9; }
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-holdprobe.txt > /dev/null 2>&1
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[hold\] .*' $log | sort | uniq -c
  grep -q '\[hold\] pig main minecraft:diamond_pickaxe off minecraft:torch' $log || { echo "FAIL: held items not set on the mob"; status=1; }
  grep -q '\[hold\] swung' $log || { echo "FAIL: swing did not run"; status=1; }
  grep -q '\[hold\] minecart main minecraft:air' $log || { echo "FAIL: non-living entity not a no-op"; status=1; }
  grep -iE 'exception|procedure.*(error|fail)' $log | head -3
done
exit $status
