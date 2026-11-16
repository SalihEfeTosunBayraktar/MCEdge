#!/bin/bash
# Q227 client check: the server opens the "wheel" radial menu for every player 5 s after they join
# (radialshot/<engine>/RadialShotServer.java); the client keeps the cursor over a slice and later scrolls to the runtime
# image tab (RadialShotClient.java) once the first image is taken (the script then leaves run/radial-scroll). Two window images are taken and the log scanned for exceptions. The helpers and the
# radialprobe image fixtures are copied into the built test project for the run and the helpers removed afterwards.
# Modern: the client opens the world a server run left (quick play); 1.16.5: it joins a running server.
# Needs the player's window, so never run it while the user is in a game (C:/BrainOS/.ingame).
# Images: logs/radial-<engine>.png (first tab), logs/radial-<engine>-images.png. usage: bash radial-client-check.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-rsh$$}
E=${@:-forge-1.16.5 neoforge-1.21.5}
logs=tools/codegen-test/logs
printf '@wait 3\nstop\n@wait 15\n@kill\n' > $logs/radial-world.txt
printf '@wait 100\n@shot radial\n@wait 20\n@shot radialimages\n@wait 2\n@kill\n' > $logs/radial-client.txt
printf '@wait 165\nstop\n@wait 15\n@kill\n' > $logs/radial-hold.txt
# Waits for the first window image, then tells the client helper to scroll to the next tab.
scrollAfterShot() {
  for i in $(seq 200); do [ -e $logs/radial-$RUN_ID.png ] && break; sleep 1; done
  touch $out/run/radial-scroll
}
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "INGAME: stop"; exit 2; }
  out=tools/codegen-test/project/out/$e
  custom=$out/src/main/java/dev/mcedge/wavethree/custom
  mkdir -p $custom $out/run/config/wavethree/emotes
  cp tools/codegen-test/radialshot/$e/*.java $custom/
  cp tools/codegen-test/radialprobe/smile.png tools/codegen-test/radialprobe/spin.gif $out/run/config/wavethree/emotes/
  rm -rf $out/run/world $out/run/radial-scroll
  if [ "$e" = forge-1.16.5 ]; then
    node tools/codegen-test/run.ts $e runServer $logs/radial-hold.txt > /dev/null 2>&1 &
    server=$!
    sleep 30
    scrollAfterShot &
    timeout 175 node tools/codegen-test/run.ts $e runClient $logs/radial-client.txt --join > /dev/null 2>&1
    wait $server
  else
    timeout 120 node tools/codegen-test/run.ts $e runServer $logs/radial-world.txt > /dev/null 2>&1
    scrollAfterShot &
    timeout 175 node tools/codegen-test/run.ts $e runClient $logs/radial-client.txt --world > /dev/null 2>&1
  fi
  wait
  rm -f $custom/RadialShot*.java $out/run/radial-scroll
  for shot in radial:radial-$e radialimages:radial-$e-images; do
    image=$logs/${shot#*:}.png
    rm -f $image; mv $logs/${shot%%:*}-$RUN_ID.png $image 2>/dev/null
    echo "== $e image: $(ls $image 2>&1 | tail -1)"
  done
  grep -E 'Exception|Caused by|Error executing' $logs/run-runClient-$e-$RUN_ID.log | grep -vE 'Win32Exception|Realms|FileSystemException' | cut -c1-190 | sort | uniq -c | sort -rn | head -5
done
