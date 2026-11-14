#!/bin/bash
# KUYRUK 139: the tagprobe command on a dedicated server of each engine resolves every tag of config/common-tags.json
# as a procedure gets it (expected results in tags-check.ts). Needs the test project built on the engines.
# usage: bash tools/codegen-test/tags-check.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-sh$$}  # own run id: logs/run-<task>-<engine>-$RUN_ID.log, own ports (see run.ts)
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
status=0
for e in $E; do
  timeout 300 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-tags.txt > /dev/null 2>&1
  node tools/codegen-test/tags-check.ts $e tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log || status=1
done
exit $status
