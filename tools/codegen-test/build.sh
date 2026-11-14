#!/bin/bash
# Builds the codegen test project on the given engines (default all 5) in parallel; one result line per engine.
# Logs: tools/codegen-test/logs/build-<engine>.log
T=$(cd "$(dirname "$0")" && pwd)
cd "$T/../.."
mkdir -p "$T/logs"
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
for e in $E; do
  ( node src/cli.ts build "$T/project" --target $e > "$T/logs/build-$e.log" 2>&1; echo "$e exit $? $(grep -E 'OK ->|failed|not generated' "$T/logs/build-$e.log" | head -5 | tr '\n' ' ')" ) &
done
wait
