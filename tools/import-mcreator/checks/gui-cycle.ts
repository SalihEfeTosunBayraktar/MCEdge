// Adds a test procedure to a COPY of an imported project: each 60 ticks the player opens the next GUI, so every screen
// of the mod opens on a client. usage: node tools/import-mcreator/checks/gui-cycle.ts <project copy> [world time block]
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const timeBlock = process.argv[3] ?? "world_total_day_time";
const guis = readdirSync(join(dir, "elements/guis")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
const STEP = 60;
const dep = { block: "dep_entity", fields: { dep: "entity" } };
const remainder = { block: "math_arithmetic", fields: { op: "MODULO" }, inputs: { a: { block: timeBlock }, b: STEP * guis.length } };
const opens = guis.map((gui, index) => ({
  block: "if",
  inputs: {
    cond: { block: "logic_compare", fields: { op: "EQ" }, inputs: { a: remainder, b: STEP * index } },
    then: [
      { block: "log", inputs: { text: `[gui] ${gui}` } },
      { block: "gui_open", fields: { gui }, inputs: { entity: dep } },
    ],
  },
}));
const procedure = {
  id: "zz_gui_cycle", globalTrigger: "player_ticks", returnType: "none", skipDependencyNullCheck: false,
  program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }, ...opens] }] },
};
writeFileSync(join(dir, "elements/procedures/zz_gui_cycle.json"), JSON.stringify(procedure, null, 2));
console.log(`cycling ${guis.length} GUIs`);
