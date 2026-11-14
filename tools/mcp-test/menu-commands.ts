/**
 * MCP side of KUYRUK #7: import_resources (sound, Blockbench model, structure), list/delete_resource,
 * export_workspace, and that run_server / debug_client / gradle_task are offered. Uses a copy of the example.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const files = mkdtempSync(join(tmpdir(), "mcedge-mcp-files-"));
writeFileSync(join(files, "Bell.ogg"), "OggS fixture");
writeFileSync(join(files, "tower.nbt"), Buffer.from([0x1f, 0x8b, 8, 0]));
const png = readFileSync(join(project, "textures", "ruby.png")).toString("base64");
writeFileSync(join(files, "lamp.bbmodel"), JSON.stringify({
  resolution: { width: 16, height: 16 },
  elements: [{ name: "c", from: [0, 0, 0], to: [16, 8, 16], faces: { up: { uv: [0, 0, 16, 16], texture: 0 } } }],
  textures: [{ source: `data:image/png;base64,${png}` }],
}));

const mcp = await connect(project);
try {
  for (const tool of ["import_resources", "list_resources", "delete_resource", "export_workspace", "run_server", "server_log", "stop_server", "debug_client", "gradle_task"]) {
    assert(mcp.tools.includes(tool), `tool ${tool} offered`);
  }
  const sound = await mcp.call("import_resources", { kind: "sound", files: [join(files, "Bell.ogg")] });
  assert(sound.imported[0] === "sounds/bell.ogg" && existsSync(join(project, "sounds", "bell.ogg")), "sound imported as sounds/bell.ogg");
  const model = await mcp.call("import_resources", { kind: "model", files: [join(files, "lamp.bbmodel")] });
  assert(model.imported.includes("models/lamp.json") && model.imported.includes("textures/block/lamp_0.png"), "bbmodel converted with its texture");
  await mcp.call("import_resources", { kind: "structure", files: [join(files, "tower.nbt")] });
  const list = await mcp.call("list_resources");
  assert(list.sounds[0].use === "hellomcedge:bell" && list.models[0].use === "lamp" && list.structures[0].use === "hellomcedge:tower", "list_resources gives ids");
  const wrong = await mcp.call("import_resources", { kind: "sound", files: [join(files, "tower.nbt")] }, true);
  assert(String(wrong).includes("must be .ogg"), "wrong file type refused");
  await mcp.call("delete_resource", { path: "structures/tower.nbt" });
  assert(!existsSync(join(project, "structures", "tower.nbt")), "delete_resource removes the file");

  const zip = join(files, "ws.zip");
  const exported = await mcp.call("export_workspace", { file: zip });
  const entries = spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-tf", zip], { encoding: "utf8" }).stdout.split(/\r?\n/);
  assert(exported.files > 5 && entries.includes("hellomcedge/sounds/bell.ogg"), "export_workspace writes a readable zip");
  // Gradle console from MCP (generates the engine project first). Needs toolchains; skipped with --no-gradle.
  if (!process.argv.includes("--no-gradle")) {
    const out = await mcp.call("gradle_task", { engine: "fabric-1.21.5", tasks: ["help"] });
    assert(String(out).startsWith("exit code 0") && String(out).includes("BUILD SUCCESSFUL"), "gradle_task help succeeds");
  }
  console.log("PASS");
} finally {
  await mcp.close();
}
