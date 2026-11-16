#!/bin/bash
# Q225, Q226 client check: a client in a world (the one a server run left, quick play) is laid down on the corner sofa's
# lying spot, the tall chair beside it, by the shared seat runtime (seatshot/<engine>/SeatShotServer.java) and seen from the front (SeatShotClient.java); a window image is
# taken and the log scanned for exceptions. Both files are copied into the built test project for the run and removed
# afterwards. Modern engines only (quick play). Needs the player's window, so never run it while the user is in a game
# (C:/BrainOS/.ingame). Images: logs/seat-<engine>.png. usage: bash seat-client-check.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-ssh$$}
E=${@:-neoforge-1.21.5}
logs=tools/codegen-test/logs
printf '@wait 3\nstop\n@wait 15\n@kill\n' > $logs/seat-world.txt
printf '@wait 100\n@shot seat\n@wait 2\n@kill\n' > $logs/seat-client.txt
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "INGAME: stop"; exit 2; }
  out=tools/codegen-test/project/out/$e
  custom=$out/src/main/java/dev/mcedge/wavethree/custom
  mkdir -p $custom
  cp tools/codegen-test/seatshot/$e/*.java $custom/
  rm -rf $out/run/world
  timeout 120 node tools/codegen-test/run.ts $e runServer $logs/seat-world.txt > /dev/null 2>&1
  timeout 150 node tools/codegen-test/run.ts $e runClient $logs/seat-client.txt --world > /dev/null 2>&1
  rm -f $custom/SeatShot*.java
  image=$logs/seat-$e.png
  rm -f $image; mv $logs/seat-$RUN_ID.png $image 2>/dev/null
  echo "== $e image: $(ls $image 2>&1 | tail -1)"
  grep -oE '\[seat\].*' $logs/run-runClient-$e-$RUN_ID.log | sort | uniq -c
  grep -E 'Exception|Caused by|Error executing' $logs/run-runClient-$e-$RUN_ID.log | grep -vE 'Win32Exception|Realms|FileSystemException' | cut -c1-190 | sort | uniq -c | sort -rn | head -5
done
