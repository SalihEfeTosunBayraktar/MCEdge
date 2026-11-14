#!/bin/bash
# KUYRUK #46 O1: the in-game overlay layer. Client only: the client opens a world (modern: the world a server run left,
# quick play; 1.16.5: joins a running server) and takes a window image of the HUD (ruby_hud draws "Ruby HUD" at 4,4 and
# the always-on overlays); the log is scanned for exceptions. Needs the player's window, so never run it while the user
# is in a game (C:/BrainOS/.ingame). Images: logs/overlay-<engine>.png. usage: bash overlay-check.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-sh$$}
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
logs=tools/codegen-test/logs
printf '@wait 3\nstop\n@wait 15\n@kill\n' > $logs/overlay-world.txt
printf '@wait 100\n@shot overlay\n@wait 2\n@kill\n' > $logs/overlay-client.txt
printf '@wait 140\nstop\n@wait 15\n@kill\n' > $logs/overlay-hold.txt
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "INGAME: stop"; exit 2; }
  rm -rf tools/codegen-test/project/out/$e/run/world
  if [ "$e" = forge-1.16.5 ]; then
    node tools/codegen-test/run.ts $e runServer $logs/overlay-hold.txt > /dev/null 2>&1 &
    server=$!
    sleep 30
    timeout 150 node tools/codegen-test/run.ts $e runClient $logs/overlay-client.txt --join > /dev/null 2>&1
    wait $server
  else
    timeout 120 node tools/codegen-test/run.ts $e runServer $logs/overlay-world.txt > /dev/null 2>&1
    timeout 150 node tools/codegen-test/run.ts $e runClient $logs/overlay-client.txt --world > /dev/null 2>&1
  fi
  cp $logs/overlay-$RUN_ID.png $logs/overlay-$e.png 2>/dev/null
  echo "== $e image: $(ls $logs/overlay-$e.png 2>&1 | tail -1)"
  grep -E 'Exception|Caused by|Error executing' $logs/run-runClient-$e-$RUN_ID.log | grep -vE 'Win32Exception|Realms|FileSystemException' | cut -c1-190 | sort | uniq -c | sort -rn | head -5
done
