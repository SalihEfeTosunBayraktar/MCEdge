/**
 * MCP side of KUYRUK #8: a plain Gradle mod (copy of ETREconomy-Legacy) offers the file, build/run, export_jar
 * and git tools but no MCEdge element tools. `--build` exports the jar with the mod's own wrapper (heavy).
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-Legacy", "ETREconomy-Legacy");
const mcp = await connect(project);
try {
  for (const tool of ["read_file", "edit_file", "build", "run_client", "export_jar", "gradle_task", "git_status"]) assert(mcp.tools.includes(tool), `tool ${tool} offered`);
  assert(!mcp.tools.includes("create_element"), "no MCEdge element tools on a Gradle mod");
  const info = await mcp.call("project_info");
  assert(info.kind === "gradle" && info.jdk === 8, "project_info: Gradle mod on JDK 8");
  if (process.argv.includes("--build")) {
    const folder = mkdtempSync(join(tmpdir(), "mcedge-etr-jar-"));
    const result = await mcp.call("export_jar", { folder });
    assert(result.ok && existsSync(result.jar), `export_jar ${result.jar}`);
  }
  console.log("PASS");
} finally {
  await mcp.close();
}
