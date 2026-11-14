#!/bin/bash
# KUYRUK #46 S1: a world saved by the MCreator version of a mod keeps its map variables. Writes
# run/world/data/wavethree_mapvars.dat the way MCreator 1.16.5 did (goldPrice = 7.5), starts a server and
# expects "[probe] legacy goldPrice 7.5". Needs the test project built; never run while .ingame exists.
# usage: bash tools/codegen-test/legacy-vars-check.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-sh$$}  # own run id: logs/run-<task>-<engine>-$RUN_ID.log, own ports (see run.ts)
[ -e .ingame ] && { echo "the user is in game (.ingame exists): not starting a server"; exit 1; }
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
for e in $E; do
  v=${e#*-}
  d=tools/codegen-test/project/out/$e/run/world
  rm -rf "$d"
  node tools/codegen-test/write-legacy-vars.ts "$d/data/wavethree_mapvars.dat"
  timeout 240 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-rules-$v.txt > /dev/null 2>&1
  echo "== $e"
  grep -oE '\[probe\] legacy.*|Test (passed|failed).*' tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
done
