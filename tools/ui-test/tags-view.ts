/**
 * KUYRUK #19: the Element tags section. Make a tag, set its type and id, add entries (typed + Enter and Add entry),
 * remove one, see a problem for an unknown mod entry, and see a tag an agent adds over MCP appear live.
 * Screenshots go to design/element-tags/.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../mcp-test/client.ts";
import { assert, exampleProject, run, type App } from "./cdp.ts";

const project = exampleProject();
const OUT = "design/element-tags";
const saved = () => JSON.parse(readFileSync(join(project, "tags.json"), "utf8")).tags as { type: string; id: string; entries: string[] }[];
const settle = async (app: App) => {
  await app.sleep(600);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
};
const addEntry = async (app: App, value: string, viaButton = false) => {
  await app.setField("Add", value, ".tagform");
  if (viaButton) await app.click(".tagform .mbtn", "Add entry");
  else {
    await app.click(".tagform .frow input[list]");
    await app.key("Enter");
  }
};

await run(async (app) => {
  await app.click(".rtab", "Element tags");
  await app.waitFor(`document.querySelector(".table-empty")`);
  await app.click(".abtn", "New tag");
  await app.setField("Tag", "hellomcedge:gems", ".tagform");
  await addEntry(app, "ruby");
  await addEntry(app, "minecraft:diamond", true);
  await addEntry(app, "#minecraft:coals");
  await addEntry(app, "sapphire");
  await app.waitFor(`document.querySelector(".tagform .issues")?.textContent.includes("sapphire")`, 5000);
  await app.shot(`${OUT}/problem-dark.png`);
  await app.click(".tagentries .lrow", "sapphire");
  await app.click(".tagform .mbtn", "Remove selected");
  await settle(app);
  let tags = saved();
  assert(tags.length === 1 && tags[0].type === "item" && tags[0].entries.join() === "ruby,minecraft:diamond,#minecraft:coals", `tag saved: ${JSON.stringify(tags)}`);

  // A second tag that adds to a vanilla tag.
  await app.click(".abtn", "New tag");
  await app.setField("Type", "block", ".tagform");
  await app.setField("Tag", "minecraft:logs", ".tagform");
  await addEntry(app, "ruby_block");
  await settle(app);
  tags = saved();
  assert(tags.some((t) => t.type === "block" && t.id === "minecraft:logs" && t.entries[0] === "ruby_block"), "block tag added to minecraft:logs");

  // An agent adds a tag over MCP: it shows up live.
  const mcp = await connect(project);
  try {
    await mcp.call("set_tag", { type: "biome", id: "hot_places", entries: ["minecraft:desert"] });
  } finally {
    await mcp.close();
  }
  await app.waitFor(`[...document.querySelectorAll(".grid td")].some((td) => td.textContent.includes("hot_places"))`, 10000);
  await app.click(".grid tbody tr", "gems");
  await app.shot(`${OUT}/tags-dark.png`);
  await app.setTheme("light");
  await app.shot(`${OUT}/tags-light.png`);
}, { project });
