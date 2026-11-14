#!/bin/bash
# Custom model check (KUYRUK #15): a server builds a scene with every project model of the test project (JSON block
# with rotated element, OBJ block, .bbmodel block, JSON plant, worn Java armor model, JSON/OBJ item and tool models;
# KUYRUK #21: an animated Java model block, Java model items, tools and a block item; KUYRUK #22: block states (y=102 row:
# plain, lit, angry+north, level 3), a multipart block and an item state from a procedure property in slot 7),
# then the client opens that world (quick play, 1.21.5 and 26.3) and takes a screenshot: logs/models-<engine>.png,
# with the items in the hotbar (GUI transforms) and in the hand. 1.16.5 has no quick play: its client joins a
# dedicated server holding the same scene (run.ts --join). Results: logs/models-results.txt. Build first: build.sh
T=$(cd "$(dirname "$0")" && pwd)
cd "$T"
export RUN_ID=${RUN_ID:-sh$$}  # own run id: logs/run-<task>-<engine>-$RUN_ID.log, own ports (see run.ts)
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
out=logs/models-results.txt
: > $out
errors='Unable to load model|Unable to bake|Missing textures|missing texture|Exception loading blockstate|Could not read OBJ|Failed to load model|Unable to resolve texture|Exception caught during firing'
for e in $E; do
  if [ $e = forge-1.16.5 ]; then
    # No quick play (KUYRUK #24): a dedicated server holds the same scene and the client joins it (run.ts --join).
    rm -rf project/out/$e/run/world logs/run-runServer-$e-$RUN_ID.log logs/models-$RUN_ID.png
    node run.ts $e runServer commands-models-1.16.5.txt >/dev/null 2>&1 &
    for i in $(seq 1 150); do grep -q 'Done (' logs/run-runServer-$e-$RUN_ID.log 2>/dev/null && break; sleep 2; done
    node run.ts $e runClient commands-models-join-shot.txt --join >/dev/null 2>&1
    wait
    mv -f logs/models-$RUN_ID.png logs/models-$e.png 2>/dev/null
    s=logs/run-runServer-$e-$RUN_ID.log
    c=logs/run-runClient-$e-$RUN_ID.log
    echo "$e server: started $(grep -c 'Done (' $s), joined: $(grep -c 'joined the game' $s), command errors: $(grep -c -E 'Unknown or incomplete command|Incorrect argument|Expected .* at position' $s)" | tee -a $out
    echo "$e client: shot $(ls logs/models-$e.png 2>/dev/null), crash: $(grep -c 'Crash report\|---- Minecraft Crash' $c), model errors: $(grep -c -i -E "$errors" $c)" | tee -a $out
    grep -i -E "$errors" $c | head -5 | tee -a $out
    cp $c logs/run-runClient-models-$e.log
    continue
  fi
  rm -rf project/out/$e/run/world
  node run.ts $e runServer commands-models-world.txt >/dev/null 2>&1
  s=logs/run-runServer-$e-$RUN_ID.log
  echo "$e server: started $(grep -c 'Done (' $s), command errors: $(grep -c -E 'Unknown or incomplete command|Incorrect argument|Expected .* at position|No entity was found' $s)" | tee -a $out
  # The player stands still facing the scene, with every model item in the hotbar and the OBJ scepter in hand.
  P=project/out/$e/run/world/datapacks/modeltest
  mkdir -p $P/data/modeltest/function $P/data/minecraft/tags/function
  case $e in *26.3) echo '{"pack":{"description":"model test","min_format":121,"max_format":121}}' > $P/pack.mcmeta;;
    *) echo '{"pack":{"description":"model test","pack_format":71}}' > $P/pack.mcmeta;; esac
  {
    echo 'tp @a 8.0 100 4.0 0 12'
    i=0
    for item in ruby_scepter ruby_lamp ruby_gem_block ruby_statue ruby_idol ruby_buckler ruby_charm crown_armor_helmet crown_armor_boots; do
      echo "item replace entity @a hotbar.$i with wavethree:$item"; i=$((i+1))
    done
  } > $P/data/modeltest/function/hold.mcfunction
  echo '{"values":["modeltest:hold"]}' > $P/data/minecraft/tags/function/tick.json
  node run.ts $e runClient commands-models-shot.txt --world >/dev/null 2>&1
  mv -f logs/models-$RUN_ID.png logs/models-$e.png 2>/dev/null
  c=logs/run-runClient-$e-$RUN_ID.log
  echo "$e client: joined $(grep -c 'logged in with entity id' $c), shot $(ls logs/models-$e.png 2>/dev/null), crash: $(grep -c 'Crash report\|---- Minecraft Crash' $c), model errors: $(grep -c -i -E "$errors" $c)" | tee -a $out
  grep -i -E "$errors" $c | head -5 | tee -a $out
  cp $c logs/run-runClient-models-$e.log
done
