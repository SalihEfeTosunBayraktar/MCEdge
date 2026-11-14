#!/bin/bash
# Fluid screen overlay check (KUYRUK #2): a server fills the spawn with ruby_water, then the client opens that world
# (quick play, 1.21.5 and 26.3) with the player's head in the fluid and takes a screenshot:
# logs/fluid-overlay-<engine>.png. 1.16.5 has no quick play; its overlay code is checked by build and client start.
T=$(cd "$(dirname "$0")" && pwd)
cd "$T"
export RUN_ID=${RUN_ID:-sh$$}  # own run id: logs/run-<task>-<engine>-$RUN_ID.log, own ports (see run.ts)
E=${@:-neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
for e in $E; do
  rm -rf project/out/$e/run/world
  node run.ts $e runServer commands-fluid-world.txt >/dev/null 2>&1
  # Spawn rules differ per version (26.x spawns on top of the fluid): a test datapack keeps the player's head in it.
  P=project/out/$e/run/world/datapacks/fluidtest
  mkdir -p $P/data/fluidtest/function $P/data/minecraft/tags/function
  case $e in *26.3) echo '{"pack":{"description":"fluid test","min_format":121,"max_format":121}}' > $P/pack.mcmeta;;
    *) echo '{"pack":{"description":"fluid test","pack_format":71}}' > $P/pack.mcmeta;; esac
  echo 'tp @a 8 101 8' > $P/data/fluidtest/function/hold.mcfunction
  echo '{"values":["fluidtest:hold"]}' > $P/data/minecraft/tags/function/tick.json
  node run.ts $e runClient commands-fluid-shot.txt --world >/dev/null 2>&1
  mv -f logs/fluid-overlay-$RUN_ID.png logs/fluid-overlay-$e.png 2>/dev/null
  c=logs/run-runClient-$e-$RUN_ID.log
  echo "$e: joined $(grep -c 'logged in with entity id' $c), shot $(ls logs/fluid-overlay-$e.png 2>/dev/null), crash: $(grep -c 'Crash report\|---- Minecraft Crash' $c), mixin errors: $(grep -c -i 'InvalidInjection\|Mixin.*failed\|mixin apply failed\|Mixin transformation' $c)"
done
