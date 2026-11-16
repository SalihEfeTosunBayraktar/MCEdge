#!/bin/bash
# Q227 runtime (server side): config/wavethree/emotes/ gets the fixture images of radialprobe/ (a PNG, a 3-frame GIF, a
# text file named .png, a bad file name and a .txt), then on a dedicated server /radialprobe (radialprobe/<engine>/
# RadialProbe.java, copied into the built test project for the run and removed afterwards) checks that the images were
# registered, chooses slices of the wheel menu as a client would (bubble, command, procedure, a greyed out slice, a
# folder image, an unknown image), runs the radial blocks and /wavethree reload.
# Needs the test project built on the engines (build.sh).
# usage: bash tools/codegen-test/radial-runtime.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-radial$$}
E=${@:-forge-1.16.5 neoforge-1.21.5}
EXPECT=(
  "Runtime image registered: emotes/smile (png 1 frames, 2 ticks each)"
  "Runtime image registered: emotes/spin (gif 3 frames, 3 ticks each)"
  "Runtime image fake.png skipped: not an image"
  "Runtime image bad name!.png skipped"
  "[radial] images smile=1x2 spin=3x3 menus=[small, wheel]"
  "[radial] choose offer chosen=wheel/main/offer bubble=trade_offer"
  "[radial_a] hi"
  "[radial] choose hello chosen=wheel/main/hello"
  "[radial] procedure wheel main run"
  "[radial] chosen wheel main run"
  "[radial] choose locked chosen=none"
  "[radial] choose spin chosen=wheel/images/spin bubble=img:emotes/spin"
  "[radial] choose nosuch chosen=none"
  "[radial] image bubble img:emotes/spin"
  "[radial] choose hello chosen=none"
  "Runtime images: 2"
)
status=0
for e in $E; do
  out=tools/codegen-test/project/out/$e
  probe=$out/src/main/java/dev/mcedge/wavethree/custom/RadialProbe.java
  mkdir -p "$(dirname $probe)" $out/run/config/wavethree/emotes
  cp tools/codegen-test/radialprobe/$e/RadialProbe.java $probe
  rm -f $out/run/config/wavethree/emotes/*
  cp tools/codegen-test/radialprobe/*.png tools/codegen-test/radialprobe/*.gif tools/codegen-test/radialprobe/*.txt $out/run/config/wavethree/emotes/
  timeout 400 node tools/codegen-test/run.ts $e runServer tools/codegen-test/commands-radialprobe.txt > /dev/null 2>&1
  rm -f $probe
  echo "== $e"
  log=tools/codegen-test/logs/run-runServer-$e-$RUN_ID.log
  grep -oE '\[radial\].*|Runtime image.*|\[radial_a\] hi' $log
  for line in "${EXPECT[@]}"; do
    grep -qF "$line" $log || { echo "MISSING: $line"; status=1; }
  done
done
exit $status
