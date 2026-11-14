/**
 * KUYRUK 196: problem severities over MCP. validate_project and validate_element give each problem its severity and
 * leave out the ones the project ignores unless include_ignored; ignore_problem and set_problem_severity write
 * problems.json and refuse error checks.
 *   node tools/mcp-test/problems.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

type Issue = { path: string; code?: string; severity: string; ignored?: boolean };
const project = exampleProject();
writeFileSync(join(project, "localization", "english.json"), JSON.stringify({ "item.hellomcedge.ruby": "Ruby" }));
const mcp = await connect(project);
try {
  assert(mcp.tools.includes("ignore_problem") && mcp.tools.includes("set_problem_severity"), "the tools are listed");
  await mcp.call("update_element", { type: "item", id: "ruby", values: { damageCount: 187500 } });
  const all = await mcp.call<Issue[]>("validate_project");
  const durability = all.find((i) => i.path === "item/ruby.damageCount");
  assert(durability?.code === "unusualHigh" && durability.severity === "info", `durability is info: ${JSON.stringify(durability)}`);
  assert(all.find((i) => i.code === "languageCode")?.severity === "warning", "language code is a warning");

  const refused = await mcp.call<string>("ignore_problem", { code: "duplicateId", path: "item/ruby.id" }, true);
  assert(/error check/.test(String(refused)), `an error check is refused: ${refused}`);
  const lowered = await mcp.call<string>("set_problem_severity", { code: "fileNotFound", severity: "info" }, true);
  assert(/error check/.test(String(lowered)), "an error check keeps its severity");

  const settings = await mcp.call("ignore_problem", { code: "unusualHigh", path: "item/ruby.damageCount" });
  assert(settings.ignore?.[0]?.path === "item/ruby.damageCount", "ignore_problem returns the settings");
  assert(JSON.parse(readFileSync(join(project, "problems.json"), "utf8")).ignore.length === 1, "problems.json is written");
  const after = await mcp.call<Issue[]>("validate_project");
  assert(!after.some((i) => i.code === "unusualHigh"), "validate_project leaves the ignored problem out");
  const withIgnored = await mcp.call<Issue[]>("validate_project", { include_ignored: true });
  assert(withIgnored.some((i) => i.code === "unusualHigh" && i.ignored === true), "include_ignored lists it, marked ignored");
  assert((await mcp.call<Issue[]>("validate_element", { type: "item", id: "ruby" })).length === 0, "validate_element leaves it out");
  assert((await mcp.call<Issue[]>("validate_element", { type: "item", id: "ruby", include_ignored: true }))[0]?.ignored === true, "validate_element include_ignored");
  assert((await mcp.call("update_element", { type: "item", id: "ruby", values: { stackSize: 64 } })).issues.length === 0, "update_element leaves it out");

  await mcp.call("ignore_problem", { code: "languageCode" });
  assert(!(await mcp.call<Issue[]>("validate_project")).some((i) => i.code === "languageCode"), "a whole check is ignored");
  await mcp.call("set_problem_severity", { code: "languageCode", severity: "error" });
  assert((await mcp.call<Issue[]>("validate_project")).find((i) => i.code === "languageCode")?.severity === "error", "raised to error: shown again, blocking");
  await mcp.call("set_problem_severity", { code: "languageCode", severity: "default" });
  await mcp.call("ignore_problem", { code: "languageCode", undo: true });
  await mcp.call("ignore_problem", { code: "unusualHigh", path: "item/ruby.damageCount", undo: true });
  const back = await mcp.call<Issue[]>("validate_project");
  assert(back.some((i) => i.code === "unusualHigh") && back.find((i) => i.code === "languageCode")?.severity === "warning", "undo restores everything");
  console.log(`severities: ${all.map((i) => `${i.code}=${i.severity}`).join(", ")}`);
  console.log("PASS");
} finally {
  await mcp.close();
}
