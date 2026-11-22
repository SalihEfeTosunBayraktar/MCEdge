/** Q277: guiImageIssues reads PNG sizes from the header and keeps them by mtime; a changed file is seen again. */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guiImageIssues } from "../../src/ir/guiImages.ts";
import { writePng } from "../../src/generator/png.ts";
import { assert } from "./cdp.ts";

const dir = mkdtempSync(join(tmpdir(), "mcedge-guiimg-"));
mkdirSync(join(dir, "textures"));
const png = (name: string, w: number, h: number) => writeFileSync(join(dir, "textures", name), writePng({ width: w, height: h, data: new Uint8Array(w * h * 4) }));
png("a.png", 16, 16);
writeFileSync(join(dir, "textures", "broken.png"), "not a png");
const elements = (width: number) => ({ gui: [{ id: "g", components: [
  { kind: "image", image: "textures/a.png", width, height: width },
  { kind: "image", image: "textures/broken.png", width: 5, height: 5 },
  { kind: "image", image: "textures/missing.png", width: 5, height: 5 },
] }] } as never);

assert(guiImageIssues(elements(32), dir).length === 0, "16x16 drawn at 32 is a whole multiple");
assert(guiImageIssues(elements(24), dir).length === 1, "16x16 drawn at 24 blurs");
// The file changes (new size, mtime moved on): the next validation sees it.
png("a.png", 24, 24);
utimesSync(join(dir, "textures", "a.png"), new Date(), new Date(Date.now() + 5000));
assert(guiImageIssues(elements(24), dir).length === 0, "after the file became 24x24, drawing it at 24 is 1:1");
console.log("PASS");
