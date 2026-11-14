#!/bin/bash
# KUYRUK #37: game rule read and write, stack text and item damage at runtime, on a dedicated server of each engine.
# KUYRUK #51: a rule with ruleName "snake_probe_rule" is read by its camelCase and its snake_case name (7) and set under either (11).
# KUYRUK 99: a negative energy receive drains past the extract limit (100): stored after
# "extracted" + 200 (receive limit) - 250 = "drained", and a block slot written by a procedure reads back (5).
# KUYRUK 106: server_ticks runs once per server tick: every "[probe] server tick <time>" value appears once (world_ticks would repeat it per dimension).
# Needs the test project built on the engines. usage: bash tools/codegen-test/rules-check.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-sh$$}  # own run id: logs/run-<task>-<engine>-$RUN_ID.log, own ports (see run.ts)
E=${@:-forge-1.16.5 neoforge-1.21.5 neoforge-26.3 fabric-1.21.5 fabric-26.3}
EXPECT=('\[probe\] snake camel 7(\.0)?$' '\[probe\] snake exact 7(\.0)?$' '\[probe\] snake set 11(\.0)?$' '\[probe\] slot 5(\.0)?$')
status=0
for e in $E; do
  v=${e#*-}
  timeout 240 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-rules-$v.txt > /dev/null 2>&1
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[probe\].*|Test (passed|failed).*' $log
  for pattern in "${EXPECT[@]}"; do
    grep -qE "$pattern" $log || { echo "MISSING: $pattern"; status=1; }
  done
  ext=$(grep -oE '\[probe\] energy extracted [0-9]+' $log | tail -1 | grep -oE '[0-9]+$')
  drained=$(grep -oE '\[probe\] energy drained [0-9]+' $log | tail -1 | grep -oE '[0-9]+$')
  ticks=$(grep -oE '\[probe\] server tick [0-9.]+' $log)
  if [ -z "$ticks" ] || [ -n "$(echo "$ticks" | sort | uniq -d)" ]; then echo "SERVER TICK: want each logged time once, got: $(echo $ticks)"; status=1; fi
  if [ -z "$ext" ] || [ "$drained" != "$((ext + 200 - 250))" ]; then echo "ENERGY: extracted '$ext' drained '$drained' (want extracted - 50)"; status=1; fi
done
exit $status
