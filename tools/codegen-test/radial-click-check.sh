#!/bin/bash
# Radial click check (neoforge-26.3): the server opens the test project's "wheel" for the player
# (radialclick/<engine>/RadialClickServer.java), the client clicks its top slice ("offer", a bubble) through the screen's
# mouseClicked and turns the camera to the front (RadialClickClient.java). The log must show the click closing the wheel and
# the server's bubble becoming trade_offer; a window image shows the bubble. Needs the test project built on the engine.
# Never run it while the user is in a game (C:/BrainOS/.ingame). usage: bash radial-click-check.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-rclick$$}
E=${@:-neoforge-26.3}
logs=tools/codegen-test/logs
printf '@wait 3\nstop\n@wait 15\n@kill\n' > $logs/radial-click-world.txt
printf '@wait 110\n@shot radialclick\n@wait 2\n@kill\n' > $logs/radial-click-client.txt
status=0
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "INGAME: stop"; exit 2; }
  out=tools/codegen-test/project/out/$e
  custom=$out/src/main/java/dev/mcedge/wavethree/custom
  mkdir -p $custom
  cp tools/codegen-test/radialclick/$e/*.java $custom/
  rm -rf $out/run/world
  timeout 120 node tools/codegen-test/run.ts $e runServer $logs/radial-click-world.txt > /dev/null 2>&1
  timeout 175 node tools/codegen-test/run.ts $e runClient $logs/radial-click-client.txt --world > /dev/null 2>&1
  rm -f $custom/RadialClick*.java
  image=$logs/radial-click-$e.png
  rm -f $image; mv $logs/radialclick-$RUN_ID.png $image 2>/dev/null
  echo "== $e image: $(ls $image 2>&1 | tail -1)"
  log=$logs/run-runClient-$e-$RUN_ID.log
  grep -oE '\[radialclick\].*' $log
  grep -qF "[radialclick] clicked taken=true screen after=none" $log || { echo "MISSING: click closes the wheel"; status=1; }
  grep -qF "[radialclick] server bubble=trade_offer" $log || { echo "MISSING: server bubble trade_offer"; status=1; }
  grep -E 'Exception|Caused by' $log | grep -vE 'Win32Exception|Realms|FileSystemException' | cut -c1-190 | sort | uniq -c | sort -rn | head -5
done
exit $status
