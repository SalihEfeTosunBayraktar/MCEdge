/**
 * KUYRUK 173: dependency jars from CurseForge, against a local mock of the CurseForge and Modrinth APIs (no network,
 * no real key): source.curseforge resolves the newest matching file with its required projects; a mod Modrinth does not
 * have falls back to CurseForge by its mod id when a key is set; without a key, with a wrong key, or for a file its
 * author keeps off third-party downloads the answer fails with a message; the Gradle lines use the cached jar. Then the
 * MCP server (its own process) reads the key from the app's Preferences file (MCEDGE_USER_DATA) and resolves the same
 * way; the key never reaches the project. A real key: MCEDGE_CURSEFORGE_REAL_KEY=<key> also resolves JEI from
 * CurseForge on neoforge-1.21.5.
 *   node tools/mcp-test/curseforge.ts
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { dependencyGradle, resolveModDependencies } from "../../src/build/modDependencies.ts";
import { listEngines } from "../../src/engines/registry.ts";
import type { Dependency } from "../../src/ir/types.ts";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

/** A one-file stored zip: a mod jar whose metadata names its mod id. */
function jar(modId: string): Buffer {
  const name = Buffer.from("META-INF/neoforge.mods.toml");
  const data = Buffer.from(`modLoader="javafml"\n[[mods]]\nmodId="${modId}"\n`);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(10, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(10, 4); central.writeUInt16LE(10, 6); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  const centralAt = local.length + name.length + data.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(centralAt, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

const KEY = "test-key";
const jars: Record<string, Buffer> = { "coolmod-1.21.5-2.0.0.jar": jar("coolmod"), "coolmod-1.21.5-2.3.0.jar": jar("coolmod"), "libmod-1.21.5-1.0.0.jar": jar("libmod") };
const sha1 = (b: Buffer) => createHash("sha1").update(b).digest("hex");
let base = "";
const file = (id: number, fileName: string, date: string, dependencies: { modId: number; relationType: number }[] = [], downloadable = true) => ({
  id, displayName: fileName.replace(/\.jar$/, ""), fileName, fileDate: date, downloadUrl: downloadable ? `${base}/dl/${fileName}` : null,
  hashes: jars[fileName] ? [{ value: sha1(jars[fileName]), algo: 1 }] : [], dependencies,
});
const MODS = [{ id: 1001, slug: "coolmod", name: "Cool Mod" }, { id: 1002, slug: "libmod", name: "Lib Mod" }, { id: 1004, slug: "nodist", name: "No Dist" }];
const requests: string[] = [];
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  requests.push(url.pathname);
  const send = (status: number, body: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(body)));
  if (url.pathname.startsWith("/dl/")) {
    const bytes = jars[url.pathname.slice(4)];
    return bytes ? (res.writeHead(200), res.end(bytes)) : send(404, {});
  }
  if (url.pathname.startsWith("/mr/")) return send(404, { error: "not_found" });
  if (!url.pathname.startsWith("/cf/v1/")) return send(404, {});
  if (req.headers["x-api-key"] !== KEY) return send(403, { error: "Forbidden" });
  const path = url.pathname.slice("/cf/v1".length);
  if (path === "/mods/search") return send(200, { data: MODS.filter((m) => m.slug === url.searchParams.get("slug")) });
  const files = /^\/mods\/(\d+)\/files$/.exec(path);
  if (files) {
    const neo = url.searchParams.get("modLoaderType") === "6" && url.searchParams.get("gameVersion") === "1.21.5";
    const id = Number(files[1]);
    const list = !neo ? [] : id === 1001 ? [file(11, "coolmod-1.21.5-2.0.0.jar", "2026-01-01T00:00:00Z"), file(12, "coolmod-1.21.5-2.3.0.jar", "2026-06-01T00:00:00Z", [{ modId: 1002, relationType: 3 }, { modId: 1003, relationType: 2 }])]
      : id === 1002 ? [file(21, "libmod-1.21.5-1.0.0.jar", "2026-02-01T00:00:00Z")] : id === 1004 ? [file(41, "nodist-1.21.5-1.0.0.jar", "2026-02-01T00:00:00Z", [], false)] : [];
    return send(200, { data: list });
  }
  const mod = /^\/mods\/(\d+)$/.exec(path);
  if (mod) {
    const found = MODS.find((m) => m.id === Number(mod[1]));
    return found ? send(200, { data: found }) : send(404, {});
  }
  send(404, {});
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const toolchains = mkdtempSync(join(tmpdir(), "mcedge-cf-tc-"));
const noPrefs = mkdtempSync(join(tmpdir(), "mcedge-cf-nokey-"));
const env = { MCEDGE_TOOLCHAINS: toolchains, MCEDGE_CURSEFORGE_API: `${base}/cf/v1`, MCEDGE_MODRINTH_API: `${base}/mr/v2` };
Object.assign(process.env, env, { MCEDGE_USER_DATA: noPrefs });
delete process.env.MCEDGE_CURSEFORGE_KEY;
const neo = listEngines().find((e) => e.id === "neoforge-1.21.5")!;
const fabric = listEngines().find((e) => e.id === "fabric-1.21.5")!;
const dep = (modId: string, version: string, source?: Dependency["source"]): Dependency => ({ modId, version, required: true, side: "both", ...(source ? { source } : {}) });

try {
  // ---- no key ----
  let [r] = await resolveModDependencies([dep("coolmod", ">=2.1", { curseforge: "coolmod" })], neo, { refresh: true });
  assert(r.status === "failed" && r.source === "curseforge" && r.message!.includes("Preferences"), `without a key CurseForge fails and says where to set it: ${r.message}`);

  // ---- with a key ----
  process.env.MCEDGE_CURSEFORGE_KEY = KEY;
  [r] = await resolveModDependencies([dep("coolmod", ">=2.1", { curseforge: "coolmod" })], neo, { refresh: true });
  assert(r.status === "resolved" && r.source === "curseforge", `source.curseforge resolves: ${r.status} ${r.message ?? ""}`);
  assert(r.jars.map((j) => `${j.project} ${j.version}${j.via ? ` via ${j.via}` : ""}`).join(", ") === "coolmod coolmod-1.21.5-2.3.0, libmod libmod-1.21.5-1.0.0 via coolmod",
    `newest matching file and its required project, the optional one left out: ${r.jars.map((j) => `${j.project} ${j.version} ${j.via ?? ""}`).join(", ")}`);
  assert(r.jars[0].modId === "coolmod" && statSync(r.jars[0].file).size === jars["coolmod-1.21.5-2.3.0.jar"].length, "the jar is cached (sha1 checked) and its mod id read");
  const gradle = dependencyGradle([dep("coolmod", ">=2.1", { curseforge: "coolmod" })], neo);
  assert(gradle.lines.some((l) => l.includes(r.jars[0].coords) && l.startsWith("implementation")) && gradle.lines.length === 2, `Gradle lines use the cached jars: ${gradle.lines.join(" | ")}`);
  [r] = await resolveModDependencies([dep("coolmod", "2.0", { curseforge: "1001" })], neo, { refresh: true });
  assert(r.status === "resolved" && r.jars[0].version === "coolmod-1.21.5-2.0.0" && r.jars.length === 1, "a numeric project id and an exact version pick the older file");

  // Modrinth does not have it: CurseForge by mod id.
  [r] = await resolveModDependencies([dep("coolmod", "*")], neo, { refresh: true });
  assert(r.status === "resolved" && r.source === "curseforge" && r.jars[0].project === "coolmod", `a mod Modrinth lacks falls back to CurseForge: ${r.status} ${r.source}`);
  assert(requests.some((p) => p.startsWith("/mr/v2/project/coolmod")), "Modrinth was asked first");
  [r] = await resolveModDependencies([dep("coolmod", "*", { curseforge: "coolmod" })], fabric, { refresh: true });
  assert(r.status === "unavailable" && r.message!.includes("on CurseForge"), `no file for the engine: unavailable (${r.message})`);
  [r] = await resolveModDependencies([dep("nodist", "*", { curseforge: "nodist" })], neo, { refresh: true });
  assert(r.status === "failed" && r.message!.includes("does not allow downloads outside CurseForge"), `a file kept off third-party downloads: ${r.message}`);
  process.env.MCEDGE_CURSEFORGE_KEY = "wrong";
  [r] = await resolveModDependencies([dep("coolmod", "*", { curseforge: "coolmod" })], neo, { refresh: true });
  assert(r.status === "failed" && r.message!.startsWith("403"), `a wrong key: ${r.message}`);
  delete process.env.MCEDGE_CURSEFORGE_KEY;

  // ---- MCP: the key comes from the app's Preferences file ----
  const userData = mkdtempSync(join(tmpdir(), "mcedge-cf-prefs-"));
  writeFileSync(join(userData, "app-state.json"), JSON.stringify({ exportFolders: {}, recent: [], preferences: { language: "en", theme: "dark", fontScale: 1, uiFont: "", codeFont: "", curseforgeKey: KEY } }));
  const project = exampleProject();
  const mcp = await connect(project, { ...env, MCEDGE_USER_DATA: userData });
  try {
    await mcp.call("update_mod", { dependencies: [{ modId: "coolmod", version: ">=2.1", required: true, source: { curseforge: "coolmod" } }] });
    const resolved = await mcp.call("resolve_dependencies", { engines: ["neoforge-1.21.5"], refresh: true });
    const row = resolved["neoforge-1.21.5"][0];
    assert(row.status === "resolved" && row.source === "curseforge" && row.jars.length === 2, `MCP resolve_dependencies with the Preferences key: ${row.status} ${row.message ?? ""}`);
    const listed = await mcp.call("list_dependency_jars", { engines: ["neoforge-1.21.5"] });
    assert(listed["neoforge-1.21.5"][0].jars[0].project === "coolmod", "list_dependency_jars shows the CurseForge jar");
    const bad = await mcp.call("update_mod", { dependencies: [{ modId: "coolmod", source: { curseforge: "coolmod", apiKey: KEY } }] }, true);
    assert(String(bad).toLowerCase().includes("unrecognized"), "update_mod refuses a key in the dependency source");
  } finally {
    await mcp.close();
  }
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (n === "out" || n === ".git" ? [] : statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
  assert(!files(project).some((f) => readFileSync(f).includes(KEY)), "the key is nowhere in the project");

  // ---- optional: a real key ----
  const real = process.env.MCEDGE_CURSEFORGE_REAL_KEY;
  if (real) {
    delete process.env.MCEDGE_CURSEFORGE_API;
    process.env.MCEDGE_CURSEFORGE_KEY = real;
    process.env.MCEDGE_TOOLCHAINS = mkdtempSync(join(tmpdir(), "mcedge-cf-real-"));
    [r] = await resolveModDependencies([dep("jei", "*", { curseforge: "jei" })], neo, { refresh: true });
    assert(r.status === "resolved", `real CurseForge: jei ${r.jars[0]?.version ?? r.message}`);
  } else console.log("--  no MCEDGE_CURSEFORGE_REAL_KEY: the real CurseForge API was not called");
  console.log("PASS");
} finally {
  server.close();
}
