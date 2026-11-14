#!/bin/bash
# KUYRUK 44 runtime (forge-1.16.5: dedicated server + joined client, so a real player closes the menu).
# gui_pos_open reopens ruby_gui every 200 ticks at 3 100 7, where there is no block, so the menu is unbound; reopening
# closes the previous menu. ruby_gui's tick writes a stone into slot 4, which is keepOnClose: the stone must never be
# given back ("Found 0" / "No items were found"). CONTROL=1 builds the same project without the flag first and expects
# the player to collect stone, then restores the project (make.ts + build).
# Also shoots the open GUI (logs/gui-keep-<run id>.png): the KUYRUK 105 label "[label] wallet 7" is computed on the server.
# The client shoots the open GUI at 90 s and stays until after the server counted (162 s against the server's 150 s).
# usage: [CONTROL=1] bash tools/codegen-test/gui-keep-runtime.sh
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-keep$$}
e=forge-1.16.5
logs=tools/codegen-test/logs
gui=tools/codegen-test/project/elements/guis/ruby_gui.json
if [ "$CONTROL" = 1 ]; then
  node -e 'const f=process.argv[1],fs=require("fs");const g=JSON.parse(fs.readFileSync(f,"utf8"));for(const w of g.components)delete w.keepOnClose;fs.writeFileSync(f,JSON.stringify(g,null,2));' $gui
  bash tools/codegen-test/build.sh $e
fi
printf '@wait 150\nclear Dev minecraft:stone 0\n@wait 1\nstop\n@wait 15\n@kill\n' > $logs/gui-keep-server.txt
printf '@wait 90\n@shot gui-keep\n@wait 72\n@kill\n' > $logs/gui-keep-client.txt
rm -rf tools/codegen-test/project/out/$e/run/world
node tools/codegen-test/run.ts $e runServer $logs/gui-keep-server.txt > /dev/null 2>&1 &
server=$!
sleep 30
timeout 300 node tools/codegen-test/run.ts $e runClient $logs/gui-keep-client.txt --join > /dev/null 2>&1
wait $server
log=$logs/run-runServer-$e-$RUN_ID.log
echo "opened $(grep -c '\[gui\] ruby_gui' $log)"
grep -A1 '>>> clear Dev' $log | tail -1
status=0
if [ "$CONTROL" = 1 ]; then
  grep -qE '<<< Found [1-9][0-9]* matching' $log || { echo "CONTROL: expected stone given back"; status=1; }
  node tools/codegen-test/make.ts > /dev/null && bash tools/codegen-test/build.sh $e
else
  grep -qE '<<< (Found 0 |No items were found)' $log || { echo "KEEP: expected no stone given back"; status=1; }
fi
exit $status
