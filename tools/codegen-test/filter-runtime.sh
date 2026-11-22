#!/bin/bash
# Q257 runtime: on a dedicated server, /filterprobe (filterprobe/<engine>/FilterProbe.java, copied into the built test
# project for the run and removed afterwards) opens filter_gui over a ruby_chest and checks the slot place filters:
# slot 0 (gems tag, lockCondition false), slot 1 (paper, lockCondition false), slot 2 (anything), slot 3 (lockCondition
# true, filter lists sticks), slot 4 (sticks only). Shift clicking diamonds, paper, sticks and a bone must go to the
# filtered slot that matches first (0, 1, 4: sticks skip the plain slot 2, Q258), then to the first slot that
# accepts (the bone fills the plain slot 2). Needs the test project built on the engines (build.sh).
# usage: bash tools/codegen-test/filter-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-filter$$}
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3}
status=0
for e in $E; do
  probe=tools/codegen-test/project/out/$e/src/main/java/dev/mcedge/wavethree/custom/FilterProbe.java
  mkdir -p "$(dirname $probe)"
  cp tools/codegen-test/filterprobe/$e/FilterProbe.java $probe
  timeout 300 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-filterprobe.txt > /dev/null 2>&1
  rm -f $probe
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[filter\].*' $log
  grep -qE '\[filter\] mayPlace \(diamond stick paper bone\) s0:Ynnn s1:nnYn s2:YYYY s3:nnnn s4:nYnn$' $log || { echo "MISSING mayPlace line"; status=1; }
  grep -qE '\[filter\] shift slots 5 3 1 0 2 rest 0 0 0 0$' $log || { echo "MISSING shift line"; status=1; }
done
exit $status
