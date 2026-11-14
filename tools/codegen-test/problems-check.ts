// KUYRUK 196: problem severities and problems.json. On a copy of examples/hello with one problem of each severity
// (a durability past its soft limit is info, a bad language code a warning, a duplicate variable an error): the
// default severities, ignoring a problem and a whole check (saved, loaded, never hiding an error), severity changes,
// and the CLI build failing on errors only.
// usage: node tools/codegen-test/problems-check.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyProblemAction, blocksBuild, classify, type ProblemAction } from "../../src/ir/problems.ts";
import { loadProblemSettings, loadProject, PROBLEMS_FILE, saveProblemSettings } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";
import { exampleProject, REPO } from "../ui-test/cdp.ts";

const dir = exampleProject();
const edit = (file: string, change: (value: any) => void) => {
  const value = JSON.parse(readFileSync(join(dir, file), "utf8"));
  change(value);
  writeFileSync(join(dir, file), JSON.stringify(value, null, 2) + "\n");
};
edit("elements/items/ruby.json", (ruby) => (ruby.damageCount = 187500));
writeFileSync(join(dir, "localization", "english.json"), JSON.stringify({ "item.hellomcedge.ruby": "Ruby" }));
edit("variables.json", (vars) => vars.variables.push({ ...vars.variables[0] }));

const rated = () => classify(validateProject(loadProject(dir), dir), loadProblemSettings(dir));
const find = (issues: { path: string; code?: string; severity: string }[], code: string) => issues.find((i) => i.code === code);
const act = (action: ProblemAction) => saveProblemSettings(dir, applyProblemAction(loadProblemSettings(dir), action));

// Default severities: the soft limit is info, the language code a warning, the duplicate an error.
let { shown, ignored } = rated();
assert.equal(find(shown, "unusualHigh")?.severity, "info");
assert.equal(find(shown, "unusualHigh")?.path, "item/ruby.damageCount");
assert.equal(find(shown, "unusualHigh")?.message, "is above 128000, which is unusual (allowed)");
assert.equal(find(shown, "languageCode")?.severity, "warning");
assert.equal(find(shown, "duplicateVariable")?.severity, "error");
assert.equal(ignored.length, 0);
assert.ok(blocksBuild(shown) && !blocksBuild(shown.filter((i) => i.severity !== "error")), "only errors block the build");
console.log("severities:", shown.map((i) => `${i.code}=${i.severity}`).join(", "));

// Errors cannot be ignored or lowered.
assert.throws(() => act({ kind: "ignore", code: "duplicateVariable", path: "variables[2].name" }), /error check/);
assert.throws(() => act({ kind: "severity", code: "duplicateVariable", severity: "info" }), /error check/);

// Ignoring one problem is saved in problems.json and hides it.
act({ kind: "ignore", code: "unusualHigh", path: "item/ruby.damageCount" });
assert.deepEqual(JSON.parse(readFileSync(join(dir, PROBLEMS_FILE), "utf8")), { ignore: [{ code: "unusualHigh", path: "item/ruby.damageCount" }] });
({ shown, ignored } = rated());
assert.ok(!find(shown, "unusualHigh") && find(ignored, "unusualHigh"), "the ignored problem moves to the ignored list");

// Ignoring the whole check; raising it to error un-hides it (an error is never ignored); default restores both.
act({ kind: "ignoreCheck", code: "languageCode" });
assert.ok(find(rated().ignored, "languageCode"), "ignored check");
act({ kind: "severity", code: "languageCode", severity: "error" });
({ shown } = rated());
assert.equal(find(shown, "languageCode")?.severity, "error", "raised to error and shown although its check is ignored");
act({ kind: "severity", code: "languageCode", severity: "default" });
assert.ok(find(rated().ignored, "languageCode") && !loadProblemSettings(dir).severity, "default removes the override");

// Undo: nothing left removes the file.
act({ kind: "unignoreCheck", code: "languageCode" });
act({ kind: "unignore", code: "unusualHigh", path: "item/ruby.damageCount" });
assert.ok(!existsSync(join(dir, PROBLEMS_FILE)) && rated().ignored.length === 0, "unignore all removes problems.json");
console.log("ignore, ignore check, severity override and undo persist in problems.json");

// CLI build: an error fails it; warnings and info print and generation goes on; a warning raised to error fails it.
const build = () => spawnSync(process.execPath, ["src/cli.ts", "build", dir, "--target", "fabric-1.21.5", "--no-gradle"], { cwd: REPO, encoding: "utf8" });
let cli = build();
assert.equal(cli.status, 1, cli.stdout);
assert.match(cli.stdout, /project is invalid:\n[\s\S]*error: variables\[2\]\.name: duplicate variable/);
edit("variables.json", (vars) => vars.variables.pop());
cli = build();
assert.equal(cli.status, 0, cli.stdout + cli.stderr);
assert.match(cli.stdout, /project has warnings \(the build goes on\):/);
assert.match(cli.stdout, /warning: localization\.english: language code like en_us/);
assert.match(cli.stdout, /info: item\/ruby\.damageCount: is above 128000/);
assert.match(cli.stdout, /\[fabric-1\.21\.5\] generated/);
console.log(cli.stdout.split("\n").slice(0, 3).join("\n"));
act({ kind: "ignore", code: "unusualHigh", path: "item/ruby.damageCount" });
assert.ok(!build().stdout.includes("damageCount"), "an ignored problem is not printed");
act({ kind: "severity", code: "languageCode", severity: "error" });
assert.equal(build().status, 1, "a warning raised to error fails the build");
console.log("PASS");
