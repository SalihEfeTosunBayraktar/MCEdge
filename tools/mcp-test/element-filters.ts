/**
 * KUYRUK 129: list_elements withProblems and notGeneratedOn, the element list's With problems and Not generated filters.
 *   node tools/mcp-test/element-filters.ts
 */
import { exampleProject } from "../ui-test/cdp.ts";
import { addElement } from "../ui-test/fixtures.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
addElement(project, "creative_tab", "broken_tab", { name: "Broken", icon: "no_such_item" });
addElement(project, "armor_trim", "trim");
const mcp = await connect(project);
try {
  const problems = await mcp.call("list_elements", { withProblems: true });
  assert(problems.elements.some((e: { id: string; problems: number }) => e.id === "broken_tab" && e.problems > 0), `withProblems: ${JSON.stringify(problems.elements)}`);
  assert(problems.elements.every((e: { problems: number }) => e.problems > 0) && !problems.elements.some((e: { id: string }) => e.id === "ruby"), "only elements with problems");
  const forge = await mcp.call("list_elements", { notGeneratedOn: "forge-1.16.5" });
  assert(forge.elements.map((e: { id: string }) => e.id).join() === "trim", `not generated on 1.16.5: ${JSON.stringify(forge.elements)}`);
  assert((await mcp.call("list_elements", { notGeneratedOn: "fabric-1.21.5" })).total === 0, "fabric 1.21.5 generates every type");
  assert(String(await mcp.call("list_elements", { notGeneratedOn: "nope" }, true)).includes("unknown engine"), "unknown engine refused");
  console.log("PASS list_elements filters");
} finally {
  await mcp.close();
}
