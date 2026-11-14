#!/bin/bash
# Run server check (KUYRUK #13): the generated build's own runServer task starts a dedicated server on each engine
# (default all 5), answers RCON and stops. Results: logs/server-run-results.txt. Build first: build.sh
T=$(cd "$(dirname "$0")" && pwd)
cd "$T"
export RUN_ID=${RUN_ID:-sh$$}  # own run id: logs/run-<task>-<engine>-$RUN_ID.log, own ports (see run.ts)
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
out=logs/server-run-results.txt
: > $out
for e in $E; do
  grep -q "server" project/out/$e/build.gradle || [ "${e#fabric}" != "$e" ] || echo "$e: build.gradle has no server run" | tee -a $out
  node run.ts $e runServer commands-stop.txt >/dev/null 2>&1
  s=logs/run-runServer-$e-$RUN_ID.log
  echo "$e runServer: started $(grep -c 'Done (' $s), rcon list: $(grep -A1 '>>> list' $s | grep '<<<' | cut -c5-80), stopped: $(grep -c 'Stopping the server\|Stopping server' $s), exit: $(grep -o 'EXIT [0-9-]*' $s)" | tee -a $out
done
