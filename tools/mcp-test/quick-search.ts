/**
 * KUYRUK 136: quick_search finds elements, textures, lang keys, variables and tags in one call, best match first.
 *   node tools/mcp-test/quick-search.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
writeFileSync(join(project, "tags.json"), JSON.stringify({ tags: [{ type: "item", id: "hellomcedge:gems", entries: ["ruby"] }] }));
const mcp = await connect(project);
try {
  const ruby = await mcp.call("quick_search", { query: "ruby" });
  const kinds = new Set(ruby.map((h: { kind: string }) => h.kind));
  assert(ruby[0].kind === "element" && ruby[0].label === "Ruby" && ruby[0].target === "item/ruby", `best hit first: ${JSON.stringify(ruby[0])}`);
  assert(kinds.has("texture") && kinds.has("langKey"), `elements, textures and lang keys: ${[...kinds]}`);
  const tags = await mcp.call("quick_search", { query: "gems", kinds: ["tag"] });
  assert(tags.length === 1 && tags[0].target === "item:hellomcedge:gems", `tag: ${JSON.stringify(tags)}`);
  assert((await mcp.call("quick_search", { query: "zzzz_nothing" })).length === 0, "no match is empty");
  console.log("PASS quick_search");
} finally {
  await mcp.close();
}
