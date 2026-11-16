#!/bin/bash
# Q228 client check: the slow_note bubble (200 tick appear, 300 tick active time, 200 tick disappear) is shown 5 seconds
# after the player spawns (transitionshot/<engine>/TransitionShotServer.java); the client looks at the player from the
# front and takes a window image every few seconds (the commands start when the world is joined, the bubble comes 5 s later) while logging the bubble's age (TransitionShotClient.java), so images
# in the middle of the appear and of the disappear can be picked. Both helpers are copied into the built test project
# for the run and removed afterwards. neoforge-1.21.5 only (the modern world flow of bubble-client-check.sh).
# Needs the player's window, so never run it while the user is in a game (C:/BrainOS/.ingame).
# Images: logs/transition-<engine>-<n>.png, the age log: logs/transition-<engine>.log. usage: bash transition-client-check.sh
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-trn$$}
e=${1:-neoforge-1.21.5}
logs=tools/codegen-test/logs
[ -e C:/BrainOS/.ingame ] && { echo "INGAME: stop"; exit 2; }
out=tools/codegen-test/project/out/$e
custom=$out/src/main/java/dev/mcedge/wavethree/custom
printf '@wait 3\nstop\n@wait 15\n@kill\n' > $logs/transition-world.txt
{ echo '@wait 3'; for i in $(seq 1 16); do echo "@shot s$i"; echo '@wait 2'; done; echo '@kill'; } > $logs/transition-client.txt
mkdir -p $custom
cp tools/codegen-test/transitionshot/$e/*.java $custom/
rm -rf $out/run/world
timeout 120 node tools/codegen-test/run.ts $e runServer $logs/transition-world.txt > /dev/null 2>&1
timeout 240 node tools/codegen-test/run.ts $e runClient $logs/transition-client.txt --world > /dev/null 2>&1
rm -f $custom/TransitionShot*.java
rm -f $logs/transition-$e-*.png
for f in $logs/s*-$RUN_ID.png; do n=${f##*/s}; n=${n%%-*}; mv "$f" $logs/transition-$e-$n.png; done
grep -h 'TRANSITION age' $logs/run-runClient-$e-$RUN_ID.log | sed 's/.*TRANSITION/TRANSITION/' > $logs/transition-$e.log
echo "== $e images: $(ls $logs/transition-$e-*.png 2>/dev/null | wc -l), age log lines: $(wc -l < $logs/transition-$e.log)"
grep -E 'Exception|Caused by|Error executing' $logs/run-runClient-$e-$RUN_ID.log | grep -vE 'Win32Exception|Realms|FileSystemException' | cut -c1-190 | sort | uniq -c | sort -rn | head -5
