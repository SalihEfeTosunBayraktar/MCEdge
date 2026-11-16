#!/bin/bash
# Q206 runtime (server side): on a dedicated server, /bubbleprobe (bubbleprobe/<engine>/BubbleProbe.java, copied into
# the built test project for the run and removed afterwards) runs the bubble blocks and checks the bubble store: a bubble
# until cleared stays, a 20-tick one ends, a player missing from the player list (logged out) or dead loses it, and
# clearing removes it; Q216: the bubble_show block with a designed bubble, and the bubbles.json data the server reads.
# Needs the test project built on the engines (build.sh).
# usage: bash tools/codegen-test/bubble-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-bubble$$}
E=${@:-forge-1.16.5 neoforge-1.21.5}
EXPECT=(
  "[bubble] block wave"
  "[bubble] designed trade_offer"
  "[bubble] styles trade_offer=40x28 slice=4 caption=Trade: {text} default=20 unknown=32"
  "[bubble] timing appear=6 disappear=8 active=0 out=0.88/1.00/0.06 note=60 bg=0,1,3,2,1,0 icon=0,3,3 once=true"
  "[bubble] start a=trade b=trade c=trade d=trade"
  "[bubble] later a=trade b= c= d="
  "[bubble] cleared a= b= c= d="
)
status=0
for e in $E; do
  probe=tools/codegen-test/project/out/$e/src/main/java/dev/mcedge/wavethree/custom/BubbleProbe.java
  mkdir -p "$(dirname $probe)"
  cp tools/codegen-test/bubbleprobe/$e/BubbleProbe.java $probe
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-bubbleprobe.txt > /dev/null 2>&1
  rm -f $probe
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[bubble\].*' $log
  for line in "${EXPECT[@]}"; do
    grep -qF "$line" $log || { echo "MISSING: $line"; status=1; }
  done
done
exit $status
