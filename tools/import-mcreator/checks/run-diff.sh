#!/bin/bash
# Runs client-diff.txt on a built project with a dedicated server and a joined client; keeps both logs under <tag>.
# usage: bash tools/import-mcreator/checks/run-diff.sh <project dir> <tag>
export RUN_PROJECT=$1
export RUN_ID=${RUN_ID:-sh$$}  # own run id: logs/run-<task>-<engine>-$RUN_ID.log, own ports (see run.ts)
tag=$2
logs=tools/codegen-test/logs
node tools/codegen-test/run.ts forge-1.16.5 runServer tools/import-mcreator/checks/server-hold.txt > /dev/null 2>&1 &
server=$!
sleep 35
timeout 110 node tools/codegen-test/run.ts forge-1.16.5 runClient tools/import-mcreator/checks/client-diff.txt --join > /dev/null 2>&1
cp $logs/run-runClient-forge-1.16.5-$RUN_ID.log $logs/diff-$tag-client.log
cp $logs/etr-diff-$RUN_ID.png $logs/diff-$tag.png
wait $server
cp $logs/run-runServer-forge-1.16.5-$RUN_ID.log $logs/diff-$tag-server.log
