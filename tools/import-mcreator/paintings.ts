// MCreator 1.16.5 import, paintings (KUYRUK #11): every `new PaintingType(w, h).setRegistryName("x")` of the
// decompiled mod becomes a painting element with its texture (textures/painting/x.png).
// usage: node tools/import-mcreator/paintings.ts <legacy mod dir> <project dir>
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newElement } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";

const [legacyDir, projectDir] = process.argv.slice(2);
if (!legacyDir || !projectDir) {
  console.log("usage: node tools/import-mcreator/paintings.ts <legacy mod dir> <project dir>");
  process.exit(1);
}
const main = join(legacyDir, "src/main");
const modId = /^modId\s*=\s*"([^"]*)"/m.exec(readFileSync(join(main, "resources/META-INF/mods.toml"), "utf8"))![1];
const textures = join(main, "resources/assets", modId, "textures/painting");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : n.endsWith(".java") ? [join(dir, n)] : []));
const PAINTING = /new PaintingType\((\d+),\s*(\d+)\)\.setRegistryName\("(\w+)"\)/g;
const type = typeRegistry().byId.get("painting")!;
mkdirSync(join(projectDir, "elements/paintings"), { recursive: true });
mkdirSync(join(projectDir, "textures/painting"), { recursive: true });
let count = 0;
for (const file of walk(join(main, "java"))) {
  for (const [, width, height, id] of readFileSync(file, "utf8").matchAll(PAINTING)) {
    const source = join(textures, `${id}.png`);
    const texture = existsSync(source) ? `textures/painting/${id}.png` : "";
    if (texture) copyFileSync(source, join(projectDir, texture));
    const element = { ...newElement(type, id), texture, width: Number(width), height: Number(height) };
    writeFileSync(join(projectDir, "elements/paintings", `${id}.json`), JSON.stringify(element, null, 2));
    count++;
  }
}
console.log(`imported ${count} paintings`);
