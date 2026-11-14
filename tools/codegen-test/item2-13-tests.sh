#!/bin/bash
# Fluid overlay (KUYRUK #2) and run server (#13) check: builds all 5 engines, starts each client to the title screen
# (Fabric overlay mixins apply when the screen effect renderer loads) and each build's own runServer task.
T=$(cd "$(dirname "$0")" && pwd)
cd "$T"
export RUN_ID=${RUN_ID:-sh$$}  # own run id: logs/run-<task>-<engine>-$RUN_ID.log, own ports (see run.ts)
bash build.sh > logs/build-summary.txt 2>&1
cut -c1-80 logs/build-summary.txt
for e in forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3; do
  node run.ts $e runClient commands-client.txt >/dev/null 2>&1
  c=logs/run-runClient-$e-$RUN_ID.log
  echo "$e client: $(grep -m1 -o 'Sound engine started' $c), crash: $(grep -c 'Crash report\|---- Minecraft Crash' $c), mixin errors: $(grep -c -i 'InvalidInjection\|Mixin.*failed\|mixin apply failed\|Mixin transformation' $c)"
done
bash server-run-tests.sh
