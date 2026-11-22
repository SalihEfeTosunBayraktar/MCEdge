/**
 * Q246: build errors explained. Real failing builds (headless Gradle, no game) of copies of examples/hello: a procedure with
 * broken Java gives compile errors of many kinds, and a build with no network and an empty Gradle home fails inside Gradle.
 * `build` and `build_errors` return the same explanation ids, params and fix hints (config/build-explanations.json); an error
 * no rule knows has none. Also checks every rule has its texts (what, plain, fix) in en and tr.
 *   node tools/mcp-test/build-explain.ts
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO, exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on; Gradle must not start");
const ENGINE = "neoforge-1.21.5";

// Every rule has its three texts in both languages, and its fix hint mentions what it should.
const rules: { id: string }[] = JSON.parse(readFileSync(join(REPO, "config", "build-explanations.json"), "utf8")).rules;
for (const lang of ["en", "tr"]) {
  const strings = JSON.parse(readFileSync(join(REPO, "config", "ui-strings", `${lang}.json`), "utf8")) as Record<string, string>;
  const missing = rules.flatMap((r) => ["what", "plain", "fix"].map((p) => `buildError.${r.id}.${p}`)).filter((k) => !strings[k]?.trim());
  assert(!missing.length, `${lang}: every rule (${rules.length}) has what, plain and fix (${missing.join(", ")})`);
}

const java = (code: string, imports = "") => ({ block: "java_code", fields: { code, deps: "", imports, gen: "1.21.5" } });

/** A copy of hello with a procedure made of `code` blocks, built for real; the summary of `build` and the answer of `build_errors`. */
async function failingBuild(code: string[], env?: Record<string, string>, imports = "") {
  const project = exampleProject();
  const mcp = await connect(project, env);
  try {
    await mcp.call("write_procedure", { id: "broken", program: { format: 1, variables: [], stacks: [{ x: 0, y: 0, blocks: [{ block: "start" }, ...code.map((c) => java(c, imports))] }] } });
    const built = String(await mcp.call("build", { engine: ENGINE }, true));
    const summary = JSON.parse(built.slice(0, built.indexOf("\n\n")));
    const errors = await mcp.call("build_errors", { engine: ENGINE });
    return { summary, errors };
  } finally {
    await mcp.close();
  }
}

const idsOf = (list: { explain?: { id: string } }[]) => list.map((d) => d.explain?.id ?? "-");

// 1. Compile errors of many kinds in one build, plus one no rule knows.
{
  const { summary, errors } = await failingBuild([
    'undefinedHelper("x");', 'int a = "text";', "int n = Math.sqrt(4.0);", "Object o = new Object(); o.foo = 3;", 'int l = "a".length(2);',
    "java.util.List<String> q = new java.util.ArrayList<String>(); q.add(1, 2, 3);", 'char[] cs = new String("x").value;', "return 5;",
    'System.out.println(System.out.println("x"));',
  ], undefined, "com.nothing.Missing");
  assert(summary.ok === false && summary.sources?.length >= 9, `the build fails with mapped errors (${summary.sources?.length})`);
  const ids = idsOf(errors.diagnostics);
  assert(JSON.stringify(ids) === JSON.stringify(["packageMissing", "cannotFindSymbol", "incompatibleTypes", "lossyConversion", "cannotFindSymbol", "wrongArguments", "wrongArguments", "noAccess", "incompatibleTypes", "-"]),
    `rules matched the real compiler output: ${ids.join(", ")}`);
  assert(JSON.stringify(idsOf(summary.sources)) === JSON.stringify(ids), "build returns the same explanation ids as build_errors");
  const [pkg, symbol, , lossy] = errors.diagnostics;
  assert(pkg.explain.params.package === "com.nothing" && pkg.explain.fix.length > 10, `the package is named: ${JSON.stringify(pkg.explain)}`);
  assert(symbol.explain.params.symbol === "undefinedHelper", `the missing name is named: ${JSON.stringify(symbol.explain.params)}`);
  assert(lossy.explain.params.types === "double to int", `the types are named: ${JSON.stringify(lossy.explain.params)}`);
  assert(errors.diagnostics.slice(1).every((d: any) => d.element === "procedure/broken"), "every error still points at its procedure");
  assert(errors.diagnostics.at(-1).explain === undefined && errors.diagnostics.at(-1).message.includes("void"), "an error no rule knows has no explanation, only its raw lines");
  assert(Array.isArray(errors.failures) && errors.failures.length === 0, "a compile failure is not also reported as a Gradle failure");
}

// 2. Syntax errors stop the compiler before the rest; flow errors show only when the rest is clean.
for (const [code, id, check] of [
  ["int z = 1", "syntaxStatementEnd", (e: any) => e.params.token === ";" && e.fix.includes("';'")],
  ['String s = "abc;', "syntaxUnclosedText", () => true],
] as [string, string, (e: any) => boolean][]) {
  const { errors } = await failingBuild([code]);
  assert(errors.count === 1 && errors.diagnostics[0].explain?.id === id && check(errors.diagnostics[0].explain), `${code}: ${id} ${JSON.stringify(errors.diagnostics[0]?.explain)}`);
}
{
  const { errors } = await failingBuild(["Thread.sleep(10);", "int u; int w = u + 1;"]);
  assert(JSON.stringify(idsOf(errors.diagnostics)) === JSON.stringify(["notInitialized", "uncaughtException"]) || JSON.stringify(idsOf(errors.diagnostics)) === JSON.stringify(["uncaughtException", "notInitialized"]), `flow errors: ${idsOf(errors.diagnostics)}`);
  const init = errors.diagnostics.find((d: any) => d.explain.id === "notInitialized");
  assert(init.explain.params.variable === "u" && init.explain.fix.includes("int u = 0"), `the variable is named in the fix: ${init.explain.fix}`);
}

// 3. A failure inside Gradle: no network and an empty Gradle home, so it cannot get its plugin.
{
  const home = mkdtempSync(join(tmpdir(), "mcedge-gradle-home-"));
  const { summary, errors } = await failingBuild(["int fine = 1;"], { GRADLE_USER_HOME: home, GRADLE_OPTS: "-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=9 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=9" });
  assert(summary.ok === false && errors.count === 0, "the build fails before the compiler runs");
  assert(errors.failures.length === 1 && errors.failures[0].explain.id === "gradlePluginMissing" && errors.failures[0].explain.params.plugin === "net.neoforged.moddev",
    `build_errors lists the Gradle failure: ${JSON.stringify(errors.failures)}`);
  assert(summary.failures?.[0]?.explain.id === "gradlePluginMissing" && summary.failures[0].explain.fix.includes("internet"), "build returns it too, with the fix hint");
}
console.log("PASS");
