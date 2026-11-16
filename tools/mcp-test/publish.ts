/**
 * Q238: publishing against a local mock of the Modrinth and CurseForge upload APIs (no network, no real account).
 * - Without projects in mod.publish nothing builds and nothing is requested; the problems name both platforms.
 * - The tokens come from the app's Preferences file (MCEDGE_USER_DATA), never from the project.
 * - A server that does not start in time (MCEDGE_SMOKE_TIMEOUT_MS) stops the publish: no upload, no tag.
 * - Other Modrinth GETs (the dev server's dependencies) are passed on to the real Modrinth.
 * - A real publish on fabric-1.21.5: the server starts, v<version> is tagged, Modrinth gets one version
 *   (<version>+fabric-1.21.5, game version 1.21.5, loader fabric, the jar) and CurseForge one file (the ids of 1.21.5 and
 *   Fabric, the changelog).
 * - Publishing the same version again is refused before any build (the tag exists).
 *   node tools/mcp-test/publish.ts
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const MR_TOKEN = "mr-test-token";
const CF_TOKEN = "cf-test-token";
const ENGINE = "fabric-1.21.5";

interface Upload { platform: string; auth?: string; meta: Record<string, unknown>; jarBytes: number }
const uploads: Upload[] = [];
const requests: string[] = [];

/** The JSON part and the size of the file part of a multipart body. */
function parts(body: Buffer, contentType: string, jsonName: string): { meta: Record<string, unknown>; jarBytes: number } {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1] ?? "";
  const text = body.toString("latin1");
  let meta: Record<string, unknown> = {};
  let jarBytes = 0;
  for (const part of text.split(`--${boundary}`)) {
    const [head, ...rest] = part.split("\r\n\r\n");
    const content = rest.join("\r\n\r\n").replace(/\r\n$/, "");
    if (head.includes(`name="${jsonName}"`)) meta = JSON.parse(Buffer.from(content, "latin1").toString("utf8"));
    if (head.includes('name="file"')) jarBytes = content.length;
  }
  return { meta, jarBytes };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  requests.push(`${req.method} ${url.pathname}`);
  const send = (status: number, body: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(body)));
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (url.pathname === "/mr/v2/project/hello-mod") return send(200, { id: "AbCd1234", slug: "hello-mod" });
    if (url.pathname === "/mr/v2/version" && req.method === "POST") {
      if (req.headers.authorization !== MR_TOKEN) return send(401, { error: "unauthorized" });
      uploads.push({ platform: "modrinth", auth: req.headers.authorization, ...parts(body, req.headers["content-type"] ?? "", "data") });
      return send(200, { id: "ver1" });
    }
    if (url.pathname.startsWith("/cf/api/")) {
      if (req.headers["x-api-token"] !== CF_TOKEN) return send(401, { error: "unauthorized" });
      if (url.pathname === "/cf/api/game/version-types") return send(200, [
        { id: 1, name: "Minecraft 1.21", slug: "minecraft-1-21" }, { id: 2, name: "Java", slug: "java" }, { id: 68441, name: "Modloader", slug: "modloader" }]);
      if (url.pathname === "/cf/api/game/versions") return send(200, [
        { id: 11, gameVersionTypeID: 1, name: "1.21.5" }, { id: 12, gameVersionTypeID: 1, name: "1.21.4" }, { id: 21, gameVersionTypeID: 2, name: "Java 21" },
        { id: 7499, gameVersionTypeID: 68441, name: "Fabric" }, { id: 10150, gameVersionTypeID: 68441, name: "NeoForge" }]);
      if (url.pathname === "/cf/api/projects/123456/upload-file" && req.method === "POST") {
        uploads.push({ platform: "curseforge", auth: req.headers["x-api-token"] as string, ...parts(body, req.headers["content-type"] ?? "", "metadata") });
        return send(200, { id: 555 });
      }
    }
    // Dependency lookups (geckolib for the dev server) share MCEDGE_MODRINTH_API: they go on to the real Modrinth.
    if (url.pathname.startsWith("/mr/v2/") && req.method === "GET") {
      void fetch(`https://api.modrinth.com/v2/${url.pathname.slice(7)}${url.search}`, { headers: { "User-Agent": "MCEdge tests" } })
        .then(async (r) => (res.writeHead(r.status, { "content-type": "application/json" }), res.end(Buffer.from(await r.arrayBuffer()))))
        .catch(() => send(502, {}));
      return;
    }
    send(404, {});
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const userData = mkdtempSync(join(tmpdir(), "mcedge-publish-prefs-"));
writeFileSync(join(userData, "app-state.json"), JSON.stringify({ preferences: { modrinthToken: MR_TOKEN, curseforgeToken: CF_TOKEN } }));
const env = { MCEDGE_MODRINTH_API: `${base}/mr/v2`, MCEDGE_CURSEFORGE_UPLOAD_API: `${base}/cf/api`, MCEDGE_USER_DATA: userData };
delete process.env.MCEDGE_MODRINTH_TOKEN;
delete process.env.MCEDGE_CURSEFORGE_TOKEN;

const project = exampleProject();
const git = (...args: string[]) => spawnSync("git", ["-C", project, ...args], { encoding: "utf8" });
git("init", "-q");
git("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "start");
const folder = join(project, "..", "jars");
mkdirSync(folder, { recursive: true });
const publishArgs = { engines: [ENGINE], folder, platforms: ["modrinth", "curseforge"], release_type: "beta", changelog: "- First public test" };

try {
  // 1. no projects: refused before any build, nothing requested
  let mcp = await connect(project, env);
  try {
    assert(mcp.tools.includes("publish_mod"), "publish_mod offered");
    const none = await mcp.call("publish_mod", publishArgs);
    assert(none.uploaded === false && none.problems.length === 2 && none.problems.every((p: string) => /no (modrinth|curseforge) project/.test(p)), `no projects: ${JSON.stringify(none)}`);
    assert(requests.length === 0, `nothing requested without projects: ${requests.join(", ")}`);
    const mod = (await mcp.call("update_mod", { publish: { modrinth: "hello-mod", curseforge: "123456" } })).mod;
    assert(mod.publish?.modrinth === "hello-mod" && mod.publish?.curseforge === "123456", "publish projects saved");
    console.log("PASS checks before the build (no projects, nothing requested)");
  } finally {
    await mcp.close();
  }

  // 2. the server test fails: no upload, no tag
  mcp = await connect(project, { ...env, MCEDGE_SMOKE_TIMEOUT_MS: "1" });
  try {
    const failed = await mcp.call("publish_mod", publishArgs);
    assert(failed.uploaded === false && failed.stopped && failed.smoke?.[0]?.ok === false, `gate failed: ${JSON.stringify(failed).slice(0, 600)}`);
    assert(uploads.length === 0, "no upload after a failed gate");
    assert(!git("tag", "--list").stdout.trim(), "no tag after a failed gate");
    console.log(`PASS failed server test uploads nothing (${failed.stopped})`);
  } finally {
    await mcp.close();
  }

  // 3. a real publish
  mcp = await connect(project, env);
  try {
    const version = (await mcp.call("get_mod")).version;
    const done = await mcp.call("publish_mod", publishArgs);
    assert(done.uploaded === true, `published: ${JSON.stringify(done).slice(0, 800)}`);
    assert(done.smoke[0].ok && done.tag === `v${version}`, `gate and tag: ${JSON.stringify(done.smoke)} ${done.tag}`);
    assert(git("tag", "--list").stdout.trim() === `v${version}`, "tag in the project repo");
    const mr = uploads.find((u) => u.platform === "modrinth");
    const cf = uploads.find((u) => u.platform === "curseforge");
    assert(mr && mr.jarBytes > 1000, `Modrinth got the jar (${mr?.jarBytes} bytes)`);
    assert(mr.meta.version_number === `${version}+fabric-1.21.5` && (mr.meta.game_versions as string[])[0] === "1.21.5"
      && (mr.meta.loaders as string[])[0] === "fabric" && mr.meta.project_id === "AbCd1234" && mr.meta.version_type === "beta"
      && mr.meta.changelog === "- First public test", `Modrinth metadata: ${JSON.stringify(mr.meta)}`);
    assert(cf && cf.jarBytes === mr.jarBytes, "CurseForge got the same jar");
    assert(JSON.stringify(cf.meta.gameVersions) === "[11,7499]" && cf.meta.releaseType === "beta" && cf.meta.changelogType === "markdown",
      `CurseForge metadata: ${JSON.stringify(cf.meta)}`);
    assert(uploads.length === 2, `one upload per platform: ${uploads.length}`);
    console.log(`PASS publish: server started, tagged ${done.tag}, Modrinth ${mr.meta.version_number}, CurseForge [11,7499]`);

    // 4. the same version again: refused before the build
    const before = requests.length;
    const again = await mcp.call("publish_mod", publishArgs);
    assert(again.uploaded === false && again.problems.some((p: string) => p.includes("already tagged")), `again: ${JSON.stringify(again)}`);
    assert(requests.length === before, "nothing requested for a tagged version");
    console.log("PASS a tagged version is refused");
  } finally {
    await mcp.close();
  }
} finally {
  server.close();
}
