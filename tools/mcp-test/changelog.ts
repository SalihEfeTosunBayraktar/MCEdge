/**
 * KUYRUK 168: the export changelog over MCP. On a copy of examples/hello: no repository, a first export (all commits),
 * commits after a remembered export, uncommitted changes flagged, and a remembered commit that left the history (the
 * commits after its date are listed instead).
 *   node tools/mcp-test/changelog.ts
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordExport, LAST_EXPORT } from "../../src/vcs/changelog.ts";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const project = exampleProject();
const git = (...args: string[]) => {
  const r = spawnSync("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (subject: string) => {
  writeFileSync(join(project, "notes.txt"), `${subject}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", subject);
};

const mcp = await connect(project);
try {
  assert(mcp.tools.includes("changelog"), "changelog is listed");
  const none = await mcp.call("changelog");
  assert(none.repo === false && none.commits.length === 0 && none.text.startsWith("## "), `no repository: ${JSON.stringify(none)}`);

  git("init", "-q");
  commit("Add the ruby");
  commit("Fix the ruby block drop");
  const first = await mcp.call("changelog");
  assert(first.repo && !first.since && first.commits.length === 2, `first export lists all: ${JSON.stringify(first)}`);
  assert(first.text === "## 0.1.0\n\n- Fix the ruby block drop\n- Add the ruby\n", `text: ${JSON.stringify(first.text)}`);

  await recordExport(project, "0.1.0");
  git("add", "-A");
  git("commit", "-q", "-m", "Record the 0.1.0 export");
  commit("Add the sapphire");
  writeFileSync(join(project, "notes.txt"), "not committed\n");
  const next = await mcp.call("changelog");
  assert(next.since?.version === "0.1.0" && !next.sinceMissing, `since the export: ${JSON.stringify(next.since)}`);
  assert(next.commits.map((c: { subject: string }) => c.subject).join("|") === "Add the sapphire", `commits after it, not the one that only records the export: ${JSON.stringify(next.commits)}`);
  assert(next.uncommitted === true, "uncommitted changes are flagged");

  // A commit no longer in the history (rewritten, another clone): the commits after the export's date.
  mkdirSync(join(project, ".mcedge"), { recursive: true });
  writeFileSync(join(project, LAST_EXPORT), JSON.stringify({ commit: "0".repeat(40), version: "0.0.9", date: "2000-01-01T00:00:00Z" }));
  const missing = await mcp.call("changelog");
  assert(missing.sinceMissing === true && missing.commits.length === 3, `missing commit falls back to the date: ${JSON.stringify(missing)}`);
  console.log("PASS");
} finally {
  await mcp.close();
}
