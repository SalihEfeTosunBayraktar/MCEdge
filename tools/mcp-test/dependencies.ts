/**
 * KUYRUK #152: the mods a project depends on run with it. The example requires geckolib and suggests JEI (>=19.0);
 * resolve_dependencies downloads their jars per engine from Modrinth (with the mods they require) into
 * <toolchains>/mods, and the generated Gradle project loads them the way each loader needs.
 * Without flags: version matching, resolution on all 5 engines (network), list_dependency_jars, the generated
 * Gradle lines, update_mod's source field. `--runs`: on every engine (or the ids given after it) the server
 * reaches Done and the client the title screen with geckolib required (heavy: Gradle + 10 game runs).
 *   node tools/mcp-test/dependencies.ts [--runs [engine ids]]
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { compareVersions, versionMatches } from "../../src/build/modDependencies.ts";
import { listEngines } from "../../src/engines/registry.ts";
import { generateTarget } from "../../src/generator/generate.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

// ---- version matching ----
assert(versionMatches("5.1.0", "*") && versionMatches("21.4.0.27", ">=19.0") && !versionMatches("7.8.1.1019", ">=19.0"), "minimum versions");
assert(versionMatches("3.0.106", "3.0") && !versionMatches("3.1.0", "3.0") && versionMatches("geckolib-fabric-1.21.5-5.1.0", "5.1.0"), "exact versions match by their parts");
assert(compareVersions("31.17.0.109", "31.9") > 0 && compareVersions("1.0", "1.0.0") === 0, "version order");

const project = exampleProject();
const mcp = await connect(project);
try {
  const mod = await mcp.call("get_mod");
  assert(mod.dependencies.some((d: any) => d.modId === "geckolib" && d.required) && mod.dependencies.some((d: any) => d.modId === "jei" && !d.required), "the example requires geckolib and suggests jei");
  const before = await mcp.call("list_dependency_jars", { engines: ["fabric-1.21.5"] });
  assert(Array.isArray(before["fabric-1.21.5"]), "list_dependency_jars answers from the cache");

  // ---- resolve on all 5 engines ----
  const resolved = await mcp.call("resolve_dependencies");
  for (const engine of listEngines()) {
    const rows = resolved[engine.id];
    const gecko = rows.find((r: any) => r.modId === "geckolib");
    assert(gecko.status === "resolved" && gecko.jars[0].project === "geckolib" && existsSync(gecko.jars[0].file), `${engine.id}: geckolib ${gecko.jars[0]?.version} (${gecko.jars.length} jar(s))`);
    const jei = rows.find((r: any) => r.modId === "jei");
    console.log(`    ${engine.id}: jei ${jei.status} ${jei.jars.map((j: any) => `${j.project} ${j.version}${j.via ? ` via ${j.via}` : ""}`).join(", ")} ${jei.message ?? ""}`);
    assert(["resolved", "unavailable"].includes(jei.status), `${engine.id}: jei resolved or reported unavailable`);
  }
  assert(resolved["forge-1.16.5"].find((r: any) => r.modId === "jei").status === "unavailable", "forge-1.16.5: jei >=19.0 has no 1.16.5 version (JEI 7.x there)");
  const jei263 = resolved["neoforge-26.3"].find((r: any) => r.modId === "jei");
  assert(jei263.status === "resolved" && jei263.jars.some((j: any) => j.project === "mezzconfig" && j.via === "jei"), "neoforge-26.3: jei with the mod it requires (mezzconfig)");
  const listed = await mcp.call("list_dependency_jars");
  assert(listed["neoforge-1.21.5"].find((r: any) => r.modId === "geckolib").status === "resolved", "list_dependency_jars shows the cache after resolving");

  // ---- generated Gradle lines per loader ----
  const p = loadProject(project);
  for (const engine of listEngines()) {
    const out = join(project, "out", engine.id);
    const { warnings } = generateTarget(p, project, engine, out);
    const gradle = readFileSync(join(out, "build.gradle"), "utf8");
    const expect = engine.loader === "forge" ? "mcedgeRunMods fg.deobf('mcedge.mods:geckolib-forge-1.16.5:"
      : engine.loader === "fabric" && engine.minecraft.startsWith("1.") ? "modImplementation 'mcedge.mods:geckolib-fabric-1.21.5:"
        : `implementation 'mcedge.mods:geckolib-${engine.loader}-${engine.minecraft}:`;
    assert(gradle.includes(expect) && /maven \{ url = 'file:\/\/\//.test(gradle), `${engine.id}: build.gradle loads geckolib (${expect.trim()}...) from the local repository`);
    if (resolved[engine.id].find((r: any) => r.modId === "jei").status === "resolved") assert(/(runtimeOnly|mcedgeRunMods).*mcedge\.mods:jei-/.test(gradle) && !/(implementation|compileOnly).*mcedge\.mods:jei-/.test(gradle),`${engine.id}: optional jei is runtime only`);
    assert(!warnings.some((w) => w.includes("required mod")), `${engine.id}: no unresolved required mod warning`);
  }

  // ---- source field ----
  const maven = await mcp.call("update_mod", { dependencies: [...mod.dependencies, { modId: "modmenu", version: "*", required: false, side: "client", source: { maven: "com.terraformersmc:modmenu:14.0.0", repository: "https://maven.terraformersmc.com/releases" } }] });
  assert(maven.mod.dependencies.at(-1).source.maven === "com.terraformersmc:modmenu:14.0.0", "update_mod keeps a dependency's maven source");
  const bad = await mcp.call("update_mod", { dependencies: [{ modId: "x", source: { maven: "not-coordinates" } }] }, true);
  assert(String(bad).includes("maven") || String(bad).includes("Invalid"), "malformed maven coordinates are refused");
  const fromMaven = await mcp.call("resolve_dependencies", { engines: ["fabric-1.21.5"] });
  const cloth = fromMaven["fabric-1.21.5"].find((r: any) => r.modId === "modmenu");
  assert(cloth.source === "maven" && cloth.status === "resolved" && statSync(cloth.jars[0].file).size > 10_000, `a Maven source resolves (${cloth.status} ${cloth.message ?? cloth.jars[0]?.file})`);
  await mcp.call("update_mod", { dependencies: mod.dependencies });

  // ---- dev runs with geckolib required ----
  const at = process.argv.indexOf("--runs");
  if (at >= 0) {
    if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on (C:/BrainOS/.ingame)");
    const ids = process.argv.slice(at + 1).filter((a) => !a.startsWith("--"));
    for (const engine of listEngines().filter((e) => !ids.length || ids.includes(e.id))) {
      const server = await mcp.call("observe_run", { side: "server", engine: engine.id, warnings: false, modOnly: true, limit: 5 }, true);
      assert(server.ready, `${engine.id}: server reaches Done with geckolib required (${server.readyAfterSeconds} s)${server.ready ? "" : `\n${JSON.stringify(server.problems, null, 1).slice(0, 1500)}`}`);
      const client = await mcp.call("observe_run", { side: "client", engine: engine.id, screenshot: true, warnings: false, modOnly: true, limit: 5 }, true);
      assert(client.ready && client.screenshot && existsSync(client.screenshot), `${engine.id}: client reaches the title screen (${client.readyAfterSeconds} s, ${client.screenshot})${client.ready ? "" : `\n${JSON.stringify(client.problems, null, 1).slice(0, 1500)}`}`);
      assert(readFileSync(join(project, "out", engine.id, "run", "options.txt"), "utf8").includes("soundCategory_master:0.0"), `${engine.id}: the test client ran muted`);
      const loaded = (await mcp.call("server_log", { filter: "geckolib", lines: 5 })) as string;
      console.log(`    ${engine.id} server log: ${loaded.split("\n").slice(1, 3).join(" | ").slice(0, 300)}`);
    }
  }
  console.log("PASS");
} finally {
  await mcp.close();
}
