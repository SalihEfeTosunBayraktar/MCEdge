#!/bin/bash
# Q206 client check: a client in a world sees its own player from the front (bubbleshot/<engine>/BubbleShotClient.java)
# while the server gives every player the "trade" bubble (BubbleShotServer.java); a window image is taken and the log
# scanned for exceptions. Both files are copied into the built test project for the run and removed afterwards.
# Modern: the client opens the world a server run left (quick play); 1.16.5: it joins a running server.
# Needs the player's window, so never run it while the user is in a game (C:/BrainOS/.ingame).
# Q216: BUBBLE=<bubble element id> shows that designed bubble (showBubble) instead of the "wave" icon bubble; Fabric gets
# the two helpers as mixins (bubbleshot/fabric-*), listed in the mod's mixin config for the run.
# Images: logs/bubble-<engine>[-<bubble>].png. usage: [BUBBLE=trade_offer] bash bubble-client-check.sh [engines]
cd "$(dirname "$0")/../.."
export RUN_ID=${RUN_ID:-bsh$$}
E=${@:-forge-1.16.5 neoforge-1.21.5}
logs=tools/codegen-test/logs
printf '@wait 3\nstop\n@wait 15\n@kill\n' > $logs/bubble-world.txt
printf '@wait 100\n@shot bubble\n@wait 2\n@kill\n' > $logs/bubble-client.txt
printf '@wait 140\nstop\n@wait 15\n@kill\n' > $logs/bubble-hold.txt
for e in $E; do
  [ -e C:/BrainOS/.ingame ] && { echo "INGAME: stop"; exit 2; }
  out=tools/codegen-test/project/out/$e
  custom=$out/src/main/java/dev/mcedge/wavethree/custom
  mixins=$out/src/main/resources/wavethree.mixins.json
  case $e in fabric-*) custom=$out/src/main/java/dev/mcedge/wavethree/mixin
    cp $mixins $logs/bubble-mixins.json
    sed -i 's/"mixins": \[/"mixins": ["BubbleShotServerMixin",/; s/"client": \[/"client": ["BubbleShotClientMixin",/' $mixins ;;
  esac
  mkdir -p $custom
  cp tools/codegen-test/bubbleshot/$e/*.java $custom/
  [ -n "$BUBBLE" ] && sed -i "s/WavethreeModBubbles.show(player, \"wave\", \"Ali\", 0)/WavethreeModBubbles.showBubble(player, \"$BUBBLE\", \"Ali\", 0)/" $custom/BubbleShot*.java
  rm -rf tools/codegen-test/project/out/$e/run/world
  if [ "$e" = forge-1.16.5 ]; then
    node tools/codegen-test/run.ts $e runServer $logs/bubble-hold.txt > /dev/null 2>&1 &
    server=$!
    sleep 30
    timeout 150 node tools/codegen-test/run.ts $e runClient $logs/bubble-client.txt --join > /dev/null 2>&1
    wait $server
  else
    timeout 120 node tools/codegen-test/run.ts $e runServer $logs/bubble-world.txt > /dev/null 2>&1
    timeout 150 node tools/codegen-test/run.ts $e runClient $logs/bubble-client.txt --world > /dev/null 2>&1
  fi
  rm -f $custom/BubbleShot*.java
  case $e in fabric-*) mv $logs/bubble-mixins.json $mixins ;; esac
  image=$logs/bubble-$e${BUBBLE:+-$BUBBLE}.png
  rm -f $image; mv $logs/bubble-$RUN_ID.png $image 2>/dev/null
  echo "== $e image: $(ls $image 2>&1 | tail -1)"
  grep -E 'Exception|Caused by|Error executing' $logs/run-runClient-$e-$RUN_ID.log | grep -vE 'Win32Exception|Realms|FileSystemException' | cut -c1-190 | sort | uniq -c | sort -rn | head -5
done
