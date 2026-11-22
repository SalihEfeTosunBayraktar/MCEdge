#!/bin/bash
# Q265 runtime: on a dedicated server, the spec's structure_probe procedure (every 40 ticks) reads the project template probe_house
# (3x2x3, 5 blocks without air, 7 with, one structure_void it never lists) and vanilla minecraft:igloo/top with the structure_* blocks,
# places both block by block (house at 0 100 0, igloo at 4 100 0; only while the commands file keeps a gold block at 15 99 15, Q268) and logs counts, sizes and the first entries. The commands file places
# vanilla minecraft:igloo/top at 4 100 12 with /place template (1.21.5+; 1.16.5 has no such command) and compares the two copies with
# "execute if blocks ... all". Expected house lines: sorted by y, x, z, planks 0 0 0 / planks 1 0 0 / stairs 2 0 0 east / planks 2 0 1 / planks 0 1 0.
# Needs the test project built on the engines (build.sh). usage: bash tools/codegen-test/structure-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-struct$$}
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
status=0
need() { grep -qF "$2" "$1" || { echo "FAIL: missing '$2'"; status=1; }; }
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "game mode on (C:/BrainOS/.ingame), not starting a server"; exit 9; }
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-structprobe.txt > /dev/null 2>&1
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[struct\] .*' $log | sort | uniq -c | sort -k2 | head -40
  need $log "[struct] house count 5 air 7 size 3 2 3"
  need $log "[struct] house #0 minecraft:oak_planks 0 0 0 "
  need $log "[struct] house #1 minecraft:oak_planks 1 0 0 "
  need $log "[struct] house #2 minecraft:oak_stairs 2 0 0 east"
  need $log "[struct] house #3 minecraft:oak_planks 2 0 1 "
  need $log "[struct] house #4 minecraft:oak_planks 0 1 0 "
  need $log "[struct] house placed"
  need $log "[struct] misc missing 0 range [] air0 minecraft:air"
  grep -q '\[struct\] igloo count [1-9]' $log || { echo "FAIL: igloo has no blocks"; status=1; }
  grep -q '\[struct\] igloo placed' $log || { echo "FAIL: igloo not placed"; status=1; }
  if [ "$e" != forge-1.16.5 ]; then
    grep -E 'Test (passed|failed)' $log | head -2
    grep -q 'Test passed' $log || { echo "FAIL: block-by-block igloo differs from /place template"; status=1; }
  fi
  grep -iE 'exception|procedure.*(error|fail)' $log | head -3
done
exit $status
