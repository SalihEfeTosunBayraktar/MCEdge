#!/bin/bash
# Q263 runtime: saved entity values survive a server restart. Run 1 (commands-dataprobe-write.txt) kills the pigs left in
# the reused world, summons one (NoAI, persistent) and lets the spec's data_probe procedure write a number, a text and a
# logic value on it ("[data] wrote"), then save-all and stop. Run 2 (commands-dataprobe-read.txt) starts the same world
# without summoning anything: the probe must only log "[data] read 42.5 hello_world true missing 0  false" (number 0, empty text, false: the
# last three are a key never written: the defaults) and never "[data] wrote minecraft:pig" (a stray item entity of the reused world may get its own first write; the probe takes the nearest entity).
# Needs the test project built on the engines (build.sh). usage: bash tools/codegen-test/entity-data-runtime.sh [engines]
cd "$(dirname "$0")/../.."
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
status=0
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "game mode on (C:/BrainOS/.ingame), not starting a server"; exit 9; }
  export RUN_ID=data$$w
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-dataprobe-write.txt > /dev/null 2>&1
  [ -e C:/BrainOS/.ingame ] && { echo "game mode on, not starting the second server"; exit 9; }
  export RUN_ID=data$$r
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-dataprobe-read.txt > /dev/null 2>&1
  echo "== $e"
  w=tools/codegen-test/logs/run-runServer-$e-data$$w.log
  r=tools/codegen-test/logs/run-runServer-$e-data$$r.log
  echo "run 1: wrote=$(grep -c '\[data\] wrote' $w) read=$(grep -c '\[data\] read' $w)"
  echo "run 2: wrote=$(grep -c '\[data\] wrote' $r) read=$(grep -c '\[data\] read' $r)"
  grep -oE '\[data\] read.*' $r | sort | uniq -c
  grep -q '\[data\] wrote minecraft:pig' $w || { echo "FAIL: run 1 never wrote"; status=1; }
  grep -q '\[data\] wrote minecraft:pig' $r && { echo "FAIL: run 2 wrote on the pig again (values were lost)"; status=1; }
  grep -qE '\[data\] read 42\.5 hello_world true missing 0  false' $r || { echo "FAIL: run 2 did not read the saved values"; status=1; }
done
exit $status
