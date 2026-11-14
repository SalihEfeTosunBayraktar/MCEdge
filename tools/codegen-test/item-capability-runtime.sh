#!/bin/bash
# KUYRUK 104 runtime: on a dedicated NeoForge server, /capprobe (capprobe/<engine>/CapProbe.java, copied into the
# built test project for the run and removed afterwards) inserts into a ruby_chest through the item capability the
# way other mods' pipes do: from a side only into its in slots (0-1), without a side into any slot.
# Needs the test project built on the engines (build.sh). usage: bash tools/codegen-test/item-capability-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-cap$$}
E=${@:-neoforge-1.21.5 neoforge-26.3}
EXPECT=('\[cap\] sided rest 0$' '\[cap\] sided into out slot rest 1$' '\[cap\] unsided into out slot rest 0$' '\[cap\] slots 3 0 1$')
status=0
for e in $E; do
  probe=tools/codegen-test/project/out/$e/src/main/java/dev/mcedge/wavethree/custom/CapProbe.java
  mkdir -p "$(dirname $probe)"
  cp tools/codegen-test/capprobe/$e/CapProbe.java $probe
  timeout 300 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-capprobe.txt > /dev/null 2>&1
  rm -f $probe
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[cap\].*' $log
  for pattern in "${EXPECT[@]}"; do
    grep -qE "$pattern" $log || { echo "MISSING: $pattern"; status=1; }
  done
done
exit $status
