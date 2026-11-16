#!/bin/bash
# Q205 runtime: on a dedicated server, /sessionprobe (sessionprobe/<engine>/SessionProbe.java, copied into the built
# test project for the run and removed afterwards) opens session GUI trade_gui on session "probe" for two fake players
# and checks: both menus show the same slots, onOpen/onClosed and the session blocks see the session, a session value
# locks slot 0, the session outlives the first player closing, and the "End" button (gui_close_session) ends it with
# every item back with the player who put it in (the procedure's item to the player closing it, the display slot's
# item gone). Q203: trade_gui's onSlotChanged logs each slot the players change once, with the session id.
# Needs the test project built on the engines (build.sh).
# usage: bash tools/codegen-test/session-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-session$$}
E=${@:-forge-1.16.5 neoforge-1.21.5}
EXPECT=(
  "[session] menus true true true ids probe probe viewers 2"
  "[session] open probe hello opens 1"
  "[session] open probe hello opens 2"
  "[session] shared 5 3 hidden 1"
  "[slotchange] probe 0"
  "[slotchange] probe 1"
  "[slotchange] probe 2"
  "[session] lock true false false"
  "[session] closed probe 1"
  "[session] after a true viewers 1 a 0"
  "[session] closed probe 0"
  "[session] end true a 5 0 b 3 0 stone 1 gold 0 menu true"
)
status=0
for e in $E; do
  probe=tools/codegen-test/project/out/$e/src/main/java/dev/mcedge/wavethree/custom/SessionProbe.java
  mkdir -p "$(dirname $probe)"
  cp tools/codegen-test/sessionprobe/$e/SessionProbe.java $probe
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-sessionprobe.txt > /dev/null 2>&1
  rm -f $probe
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[(session|slotchange)\].*' $log
  # Q203: each changed slot once, although both players' menus broadcast.
  [ "$(grep -c '\[slotchange\]' $log)" == 3 ] || { echo "MISSING: three [slotchange] lines"; status=1; }
  for line in "${EXPECT[@]}"; do
    grep -qF "$line" $log || { echo "MISSING: $line"; status=1; }
  done
done
exit $status
