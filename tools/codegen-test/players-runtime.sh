#!/bin/bash
# Q202 runtime: on a dedicated server, /playersprobe (playersprobe/<engine>/PlayersProbe.java, copied into the built
# test project for the run and removed afterwards) puts fake player q202_over in the overworld (y 100) and q202_nether
# in the nether (y 70) and runs procedure server_players_probe from the overworld: the server-wide loop sees both (each
# at its own y, the body's world still the overworld), the default loop only the overworld one, and player_by_name finds
# the nether player by a name in other letter case and nothing for an unknown name. Needs the test project built on the
# engines (build.sh). usage: bash tools/codegen-test/players-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-players$$}
E=${@:-forge-1.16.5 neoforge-1.21.5}
EXPECT=(
  "[players] start online 2 overworld 1 nether 1"
  "[players] server q202_over y 100 world minecraft:overworld"
  "[players] server q202_nether y 70 world minecraft:overworld"
  "[players] dimension q202_over"
  "[players] byname q202_nether y 70"
  "[players] missing none"
)
status=0
for e in $E; do
  probe=tools/codegen-test/project/out/$e/src/main/java/dev/mcedge/wavethree/custom/PlayersProbe.java
  mkdir -p "$(dirname $probe)"
  cp tools/codegen-test/playersprobe/$e/PlayersProbe.java $probe
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-playersprobe.txt > /dev/null 2>&1
  rm -f $probe
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[players\].*' $log
  for line in "${EXPECT[@]}"; do
    grep -qF "$line" $log || { echo "MISSING: $line"; status=1; }
  done
  grep -qF "[players] dimension q202_nether" $log && { echo "UNEXPECTED: the default loop saw the nether player"; status=1; }
done
exit $status
