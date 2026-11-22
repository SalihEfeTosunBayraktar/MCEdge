#!/bin/bash
# Q276: builds the text GUI project for neoforge-26.3, opens it in a client (the world a server run left, quick play),
# saves screenshots at GUI scale 2 and 3 to design/276/game-26.3-scale<N>.png. Never while the user is in a game.
# usage: bash tools/codegen-test/textshot/run.sh
cd "$(dirname "$0")/../../.."
[ -e C:/BrainOS/.ingame ] && { echo "INGAME: stop"; exit 2; }
export RUN_ID=${RUN_ID:-q276$$}
e=neoforge-26.3
project=$(node tools/codegen-test/textshot/make.ts | tail -1)
echo "project $project"
node src/cli.ts build "$project" --target $e > tools/codegen-test/logs/q276-build.log 2>&1 || { tail -20 tools/codegen-test/logs/q276-build.log; exit 1; }
out=$(cygpath -u "$project")/out/$e
custom=$out/src/main/java/dev/mcedge/hello/custom
mkdir -p $custom
cp tools/codegen-test/textshot/$e/TextShot.java $custom/
logs=tools/codegen-test/logs
printf '@wait 3\nstop\n@wait 15\n@kill\n' > $logs/q276-world.txt
printf '@wait 90\n@kill\n' > $logs/q276-client.txt
export RUN_PROJECT=$project
timeout 180 node tools/codegen-test/run.ts $e runServer $logs/q276-world.txt > /dev/null 2>&1
timeout 240 node tools/codegen-test/run.ts $e runClient $logs/q276-client.txt --world > /dev/null 2>&1
mkdir -p design/276
for n in 2 3; do cp $out/run/screenshots/q276_scale$n.png design/276/game-26.3-scale$n.png 2>/dev/null; done
ls -la design/276/
grep -h '\[q276\]' $logs/run-runClient-$e-$RUN_ID.log | sed 's/.*\[q276\]/[q276]/'
grep -E 'Exception|Caused by|error:' $logs/run-runClient-$e-$RUN_ID.log | grep -vE 'Win32Exception|Realms|FileSystemException' | cut -c1-190 | sort | uniq -c | sort -rn | head -5
