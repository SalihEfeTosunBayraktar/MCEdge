#!/bin/bash
# Q229 client check: playbackprobe/<engine>/PlaybackProbe.java is copied into the built test project for the run and
# removed afterwards. In a world it logs the frame list position of the playback_* sprites as it changes ("[q229] t=..."),
# places the hold-last and ping-pong blocks in front of the camera, opens playback_gui and restarts its procedure image,
# and saves screenshots at fixed ticks (run/screenshots/q229_<tick>.png, copied to logs/q229-<engine>/).
# Modern: the client opens the world a server run left (quick play); 1.16.5: it joins a running server.
# Needs the player's window, so never run it while the user is in a game (C:/BrainOS/.ingame).
# usage: bash tools/codegen-test/playback-client-check.sh [engines]   (after build.sh for those engines)
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-q229$$}
E=${@:-forge-1.16.5 neoforge-1.21.5}
logs=tools/codegen-test/logs
printf '@wait 3\nstop\n@wait 15\n@kill\n' > $logs/q229-world.txt
printf '@wait 110\n@kill\n' > $logs/q229-client.txt
printf '@wait 150\nstop\n@wait 15\n@kill\n' > $logs/q229-hold.txt
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "INGAME: stop"; exit 2; }
  out=tools/codegen-test/project/out/$e
  custom=$out/src/main/java/dev/mcedge/wavethree/custom
  mkdir -p $custom
  cp tools/codegen-test/playbackprobe/$e/PlaybackProbe.java $custom/
  rm -rf $out/run/world $out/run/screenshots/q229_*
  if [ "$e" = forge-1.16.5 ]; then
    node tools/codegen-test/run.ts $e runServer $logs/q229-hold.txt > /dev/null 2>&1 &
    server=$!
    sleep 30
    timeout 160 node tools/codegen-test/run.ts $e runClient $logs/q229-client.txt --join > /dev/null 2>&1
    wait $server
  else
    timeout 120 node tools/codegen-test/run.ts $e runServer $logs/q229-world.txt > /dev/null 2>&1
    timeout 160 node tools/codegen-test/run.ts $e runClient $logs/q229-client.txt --world > /dev/null 2>&1
  fi
  rm -f $custom/PlaybackProbe.java
  rm -rf $logs/q229-$e; mkdir -p $logs/q229-$e
  cp $out/run/screenshots/q229_* $logs/q229-$e/ 2>/dev/null
  echo "== $e screenshots: $(ls $logs/q229-$e | wc -l)"
  grep -h '\[q229\]' $logs/run-runClient-$e-$RUN_ID.log | sed 's/.*\[q229\]/[q229]/' | head -80
  grep -E 'Exception|Caused by|Error executing' $logs/run-runClient-$e-$RUN_ID.log | grep -vE 'Win32Exception|Realms|FileSystemException' | cut -c1-190 | sort | uniq -c | sort -rn | head -5
done
