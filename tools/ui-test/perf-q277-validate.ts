/** Q277: times loadProject and validateProject (and guiImageIssues, when the build has it) in Node on a project folder. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadProject } from "../../src/ir/storage.ts";
import { validateProject } from "../../src/ir/validate.ts";

const dir = process.argv[2];
const time = <T>(fn: () => T): [T, number] => {
  const s = performance.now();
  const v = fn();
  return [v, Math.round(performance.now() - s)];
};
const [project, loadMs] = time(() => loadProject(dir));
const runs = [0, 1, 2, 3, 4].map(() => time(() => validateProject(project, dir))[1]);
const out: Record<string, unknown> = { loadMs, validateMs: runs };
if (existsSync(resolve(import.meta.dirname, "../../src/ir/guiImages.ts"))) {
  const { guiImageIssues } = await import("../../src/ir/guiImages.ts");
  out.guiImageIssuesMs = [0, 1, 2].map(() => time(() => guiImageIssues(project.elements, dir))[1]);
}
console.log(JSON.stringify(out));
