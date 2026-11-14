/**
 * KUYRUK #145 part 3: compile errors pointed back at their source. The generator writes out/<engine>/mcedge-sourcemap.json
 * (generated class -> element, procedure lines -> blocks); build_errors maps javac errors of the build log through it.
 * Without Gradle: a log with javac errors at known lines is written and mapped. `--build` runs a real Gradle build
 * of a procedure with broken Java on neoforge-1.21.5 and checks `build` returns the mapped error (heavy).
 *   node tools/mcp-test/build-errors.ts [--build]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listEngines } from "../../src/engines/registry.ts";
import { generateTarget } from "../../src/generator/generate.ts";
import { loadProject } from "../../src/ir/storage.ts";
import { exampleProject } from "../ui-test/cdp.ts";
import { assert, connect } from "./client.ts";

const ENGINE = "neoforge-1.21.5";
const project = exampleProject();
const mcp = await connect(project);
try {
  await mcp.call("write_procedure", {
    id: "broken_java",
    program: { format: 1, variables: [{ name: "n", type: "number" }], stacks: [{ x: 0, y: 0, blocks: [
      { block: "start" },
      { block: "local_number_set", fields: { var: "n" }, inputs: { value: 3 } },
      { block: "if", inputs: { cond: true, then: [
        { block: "log", inputs: { text: "inside" } },
        { block: "java_code", fields: { code: "undefinedHelper(\"ruby_marker\");", deps: "", imports: "", gen: "1.21.5" } },
      ] } },
    ] }] },
  });
  const engine = listEngines().find((e) => e.id === ENGINE)!;
  const outDir = join(project, "out", ENGINE);
  generateTarget(loadProject(project), project, engine, outDir);
  const map = JSON.parse(readFileSync(join(outDir, "mcedge-sourcemap.json"), "utf8"));
  const procFile = Object.keys(map.files).find((f) => f.endsWith("/BrokenJavaProcedure.java"))!;
  assert(procFile && map.files[procFile].element === "procedure/broken_java" && map.files[procFile].blocks.length >= 4, "source map: procedure class with block lines");
  const itemFile = Object.keys(map.files).find((f) => map.files[f].element === "item/ruby");
  assert(itemFile, `source map: a class of item/ruby (${itemFile})`);

  const source = readFileSync(join(outDir, procFile), "utf8").split("\n");
  const bad = source.findIndex((l) => l.includes("undefinedHelper")) + 1;
  const log = join(outDir, "build", "mcedge-build.log");
  mkdirSync(join(outDir, "build"), { recursive: true });
  const abs = (f: string) => join(outDir, f).replaceAll("/", "\\");
  writeFileSync(log, [
    "> Task :compileJava",
    `${abs(procFile)}:${bad}: error: cannot find symbol`,
    `        undefinedHelper("ruby_marker");`,
    "        ^",
    "  symbol:   method undefinedHelper(String)",
    `${abs(itemFile!)}:1: error: something about the item class`,
    "2 errors",
    "> Task :compileJava FAILED",
  ].join("\n"));
  const result = await mcp.call("build_errors", { engine: ENGINE });
  assert(result.count === 2, `build_errors reads the log (${result.count})`);
  const [proc, item] = result.diagnostics;
  assert(proc.element === "procedure/broken_java" && proc.line === bad && proc.code.includes("undefinedHelper"), "build_errors: procedure error mapped to the procedure");
  assert(proc.block?.path === "stacks[0].blocks[2].inputs.then[1]" && proc.block.block === "java_code", `build_errors: mapped to the java_code block (${JSON.stringify(proc.block?.path)})`);
  assert(proc.fields?.includes("stacks[0].blocks[2].inputs.then[1].fields.code"), "build_errors: the block field on the line");
  assert(proc.detail.some((d: string) => d.includes("symbol:")), "build_errors: javac detail lines kept");
  assert(item.element === "item/ruby" && !item.block, "build_errors: element class error mapped to the element");
  // The generated Java is the same with and without the map: generating twice gives the same file.
  generateTarget(loadProject(project), project, engine, outDir);
  assert(readFileSync(join(outDir, procFile), "utf8").split("\n").join("\n") === source.join("\n"), "generated Java has no markers");
  assert(!source.some((l) => l.includes("@mcedge-block")), "no marker text in the procedure class");

  if (process.argv.includes("--build")) {
    if (existsSync("C:/BrainOS/.ingame")) throw new Error("game mode is on; skip --build");
    const built = await mcp.call("build", { engine: ENGINE }, true);
    const json = JSON.parse(String(built).slice(0, String(built).indexOf("\n\n")));
    assert(json.ok === false && json.sources?.length >= 1, `real build fails with mapped sources (${json.sources?.length})`);
    const first = json.sources[0];
    assert(first.element === "procedure/broken_java" && first.block?.block === "java_code" && first.block.path === "stacks[0].blocks[2].inputs.then[1]", `real javac error mapped to the java_code block (${JSON.stringify(first)})`);
  }
  console.log("PASS");
} finally {
  await mcp.close();
}
