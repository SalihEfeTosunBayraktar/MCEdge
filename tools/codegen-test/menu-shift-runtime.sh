#!/bin/bash
# KUYRUK 191 runtime: on a dedicated server, /menuprobe (menuprobe/<engine>/MenuProbe.java, copied into the built test
# project for the run and removed afterwards) shift clicks 64 diamonds into ruby_gui on a ruby_chest (max stack 32)
# whose slot 0 holds 20 diamonds and whose locked slot 3 holds 1: the locked slot must stay at 1 and no slot may pass 32.
# Needs the test project built on the engines (build.sh). usage: bash tools/codegen-test/menu-shift-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-menu$$}
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3}
status=0
for e in $E; do
  probe=tools/codegen-test/project/out/$e/src/main/java/dev/mcedge/wavethree/custom/MenuProbe.java
  mkdir -p "$(dirname $probe)"
  cp tools/codegen-test/menuprobe/$e/MenuProbe.java $probe
  timeout 300 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-menuprobe.txt > /dev/null 2>&1
  rm -f $probe
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[menu\].*' $log
  grep -qE '\[menu\] slots 32 0 0 1 32 rest 20$' $log || { echo "MISSING: [menu] slots 32 0 0 1 32 rest 20"; status=1; }
done
exit $status
