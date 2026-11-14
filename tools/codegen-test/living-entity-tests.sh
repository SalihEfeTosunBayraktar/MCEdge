#!/bin/bash
# Living entity stage 2 run check: on each engine (default all 5) a dedicated server summons every living entity of the
# test project (commands-mobs2.txt) and a client starts to the title screen. One summary line per run, also written
# to logs/living-entity-results.txt. Build first: tools/codegen-test/build.sh
T=$(cd "$(dirname "$0")" && pwd)
cd "$T"
export RUN_ID=${RUN_ID:-sh$$}  # own run id: logs/run-<task>-<engine>-$RUN_ID.log, own ports (see run.ts)
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
out=logs/living-entity-results.txt
: > $out
total=$(ls project/elements/living_entities | wc -l)
for e in $E; do
  node run.ts $e runServer commands-mobs2.txt >/dev/null 2>&1
  s=logs/run-runServer-$e-$RUN_ID.log
  echo "$e server: started $(grep -c 'Done (' $s), mobs ok $(grep -o '\[Rcon\] [a-z_0-9]*-ok' $s | sort -u | wc -l)/$((total+1)), data: $(grep -A1 '>>> data get' $s | grep '<<<' | cut -c5-70 | tr '\n' '|') procs: $(grep -c '\[wavethree\]' $s), exceptions: $(grep -c -E '^\S*Exception|Caused by|Mixin.*(failed|error)|InvalidInjection' $s)" | tee -a $out
  node run.ts $e runClient commands-client.txt >/dev/null 2>&1
  c=logs/run-runClient-$e-$RUN_ID.log
  echo "$e client: $(grep -m1 -o 'Sound engine started' $c), crash: $(grep -c 'Crash report\|---- Minecraft Crash' $c), mixin errors: $(grep -c -i 'InvalidInjection\|Mixin.*failed\|mixin apply failed' $c)" | tee -a $out
done
# In-world render check (1.21.5, 26.3): the client opens the world the server run left, with the summoned mobs.
for e in $E; do
  [ $e = forge-1.16.5 ] && continue
  node run.ts $e runClient commands-world.txt --world >/dev/null 2>&1
  c=logs/run-runClient-$e-$RUN_ID.log
  echo "$e client in world: joined $(grep -c -i 'joined the game\|logged in with entity id\|Starting integrated minecraft server' $c), crash: $(grep -c 'Crash report\|---- Minecraft Crash' $c), render errors: $(grep -c -i 'Rendering entity\|Exception rendering\|Error rendering' $c), exceptions: $(grep -c -E '^\S*Exception|Caused by' $c)" | tee -a $out
  cp $c logs/run-runClient-world-$e.log
done
