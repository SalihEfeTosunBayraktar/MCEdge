#!/bin/bash
# Reimports the legacy mod into the MCEdge project, in the order the scripts need, and builds it for Forge 1.16.5.
# usage: bash tools/import-mcreator/rebuild.sh <legacy mod dir> <project dir>
set -e
legacy=$1
project=$2
node tools/import-mcreator/blocks.ts "$legacy" "$project"
node tools/import-mcreator/items.ts "$legacy" "$project"
node tools/import-mcreator/guis.ts "$legacy" "$project"
node tools/import-mcreator/content.ts "$legacy" "$project"
node tools/import-mcreator/procedures.ts "$legacy" "$project"
node src/cli.ts build "$project" --target forge-1.16.5
