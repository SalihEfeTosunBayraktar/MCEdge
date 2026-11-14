/**
 * KUYRUK #143: read_procedure's Java preview maps tags like the generator ("forge:crops" is "c:crops" on NeoForge
 * and Fabric, a vanilla forge: name is the vanilla tag, a project's own tag stays).
 */
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const mcp = await connect(project);
try {
  const tagBlock = (tag: string) => ({ block: "block_in_tag", fields: { tag }, inputs: {} });
  await mcp.call("write_procedure", {
    id: "tag_probe",
    program: {
      format: 1,
      variables: [{ name: "a", type: "logic" }, { name: "b", type: "logic" }],
      stacks: [{ x: 0, y: 0, blocks: [
        { block: "start" },
        { block: "local_logic_set", fields: { var: "a" }, inputs: { value: tagBlock("forge:crops") } },
        { block: "local_logic_set", fields: { var: "b" }, inputs: { value: tagBlock("forge:logs") } },
      ] }],
    },
  });
  const java = async (engine: string) => (await mcp.call("read_procedure", { id: "tag_probe", engine, java: true })).java.source as string;
  const neo = await java("neoforge-1.21.5");
  assert(neo.includes("\"c:crops\"") && !neo.includes("forge:crops"), "neoforge preview maps forge:crops to c:crops");
  assert(neo.includes("\"minecraft:logs\""), "neoforge preview maps forge:logs to the vanilla tag");
  const legacy = await java("forge-1.16.5");
  assert(legacy.includes("\"forge:crops\"") && legacy.includes("\"minecraft:logs\""), "forge-1.16.5 preview keeps forge:crops");
  console.log("PASS");
} finally {
  await mcp.close();
}
