#!/bin/bash
# Opens every GUI of a built project copy on all 5 engines (gui-cycle.ts must have run on it first, or the project
# opens GUIs itself as the codegen test project does); prints the GUIs opened, positions client menus logged, exceptions.
# usage: bash tools/import-mcreator/checks/gui-cycle.sh <project copy> [engines]
export RUN_PROJECT=$1
export RUN_ID=${RUN_ID:-sh$$}  # own run id: logs/run-<task>-<engine>-$RUN_ID.log, own ports (see run.ts)
shift
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
logs=tools/codegen-test/logs
C=tools/import-mcreator/checks
printf '@wait 3\nstop\n@wait 15\n@kill\n' > $logs/gui-world.txt
printf '@wait 130\n@shot gui-cycle\n@wait 2\n@kill\n' > $logs/gui-client.txt
printf '@wait 175\nstop\n@wait 15\n@kill\n' > $logs/gui-hold.txt
for e in $E; do
  rm -rf "$RUN_PROJECT/out/$e/run/world"
  if [ "$e" = forge-1.16.5 ]; then
    node tools/codegen-test/run.ts $e runServer $logs/gui-hold.txt > /dev/null 2>&1 &
    server=$!
    sleep 30
    timeout 170 node tools/codegen-test/run.ts $e runClient $logs/gui-client.txt --join > /dev/null 2>&1
    wait $server
    side=$logs/run-runServer-$e-$RUN_ID.log
  else
    timeout 120 node tools/codegen-test/run.ts $e runServer $logs/gui-world.txt > /dev/null 2>&1
    timeout 170 node tools/codegen-test/run.ts $e runClient $logs/gui-client.txt --world > /dev/null 2>&1
    side=$logs/run-runClient-$e-$RUN_ID.log
  fi
  cp $logs/gui-cycle-$RUN_ID.png $logs/gui-cycle-$e.png 2>/dev/null
  echo "== $e opened=$(grep -c '\[gui\] ' $side) distinct=$(grep -oE '\[gui\] [a-z0-9_]+' $side | sort -u | wc -l)"
  grep -ohE '\[guipos\] [-0-9. ]+' $logs/run-runClient-$e-$RUN_ID.log | sort | uniq -c | head -3
  cat $side $logs/run-runClient-$e-$RUN_ID.log | grep -E 'Exception|Caused by|Error executing' | grep -vE 'Win32Exception|Realms|FileSystemException' | cut -c1-190 | sort | uniq -c | sort -rn | head -6
done
