#!/bin/bash
# Q225 runtime (server side): on a dedicated server, /seatprobe (seatprobe/<engine>/SeatProbe.java, copied into the built
# test project for the run and removed afterwards) right-clicks the test project's seat blocks with fake players and
# checks the shared seat runtime: a chair facing east seats one player at its turned seat, 0.5 blocks up (auto height of
# its slab-high box), feet 0.6 below the seat, facing east; a taken seat and a player holding an item are refused; the
# bench seats two at its manual 0.5625 and refuses a third; the sit / is sitting / stand up procedure blocks work on a
# plain block; a stands up on top of the chair, the bench's riders in front of it; standing up and breaking the bench remove the seats.
# Q226 and lying seats: the corner sofa places its 6 parts and the tall chair its top part; a taken cell refuses the
# sofa; a click on a far part of the sofa seats on its seat there (feet 0.6 below, facing east); i lies on the long side,
# feet 0.85 behind the lying spot and 0.125 above it; breaking one part removes the whole sofa, one sofa drops, both stand up.
# Needs the test project built on the engines (build.sh).
# usage: bash tools/codegen-test/seat-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-seat$$}
E=${@:-forge-1.16.5 neoforge-1.21.5}
EXPECT=(
  "[seat] use a=true b=false f=false"
  "[seat] bench c=true d=true e=false"
  "[seat] procedure sitting true"
  "[seat] procedure stood false"
  "[seat] chair a dx=0.5625 dz=0.5000 height=0.5000 drop=0.6000 yaw=-90.0 sitting=true"
  "[seat] bench c dx=0.2500 dz=0.5000 height=0.5625 drop=0.6000"
  "[seat] bench d dx=0.7500 dz=0.5000 height=0.5625 drop=0.6000"
  "[seat] entities 3"
  "[seat] dismount a 0.50,1.00,0.50 c 0.50,0.00,-0.50"
  "[seat] stood a=false"
  "[seat] after c=false d=false entities 0"
  "[multi] placed sofa=6 chair=2 top=1"
  "[multi] fits blocked=false free=true"
  "[multi] use i=true h=true"
  "[multi] h dx=0.0000 dz=-0.5000 height=0.4375 drop=-0.1250 yaw=90.0 lying=true i lying=true feet -0.50,0.56,0.09"
  "[multi] after sofa=0 drops=1 h=false i=false"
)
status=0
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "INGAME: stop"; exit 2; }
  probe=tools/codegen-test/project/out/$e/src/main/java/dev/mcedge/wavethree/custom/SeatProbe.java
  mkdir -p "$(dirname $probe)"
  cp tools/codegen-test/seatprobe/$e/SeatProbe.java $probe
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-seatprobe.txt > /dev/null 2>&1
  rm -f $probe
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[(seat|multi)\].*' $log
  for line in "${EXPECT[@]}"; do
    grep -qF "$line" $log || { echo "MISSING: $line"; status=1; }
  done
done
exit $status
