// MCreator 1.16.5 import, particles (KUYRUK #11): every MCreator particle class (a BasicParticleType registered with
// a name and a CustomParticle) becomes a particle element: texture, size, scale, lifetime, gravity, collision,
// speed, render type and "always show".
// usage: node tools/import-mcreator/particles.ts <legacy mod dir> <project dir>
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newElement } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";

const [legacyDir, projectDir] = process.argv.slice(2);
if (!legacyDir || !projectDir) {
  console.log("usage: node tools/import-mcreator/particles.ts <legacy mod dir> <project dir>");
  process.exit(1);
}
const main = join(legacyDir, "src/main");
const modId = /^modId\s*=\s*"([^"]*)"/m.exec(readFileSync(join(main, "resources/META-INF/mods.toml"), "utf8"))![1];
const javaRoot = join(main, "java");
const dir = join(javaRoot, readdirSync(javaRoot)[0], "particle");
const textures = join(main, "resources/assets", modId, "textures/particle");
const type = typeRegistry().byId.get("particle")!;
mkdirSync(join(projectDir, "elements/particles"), { recursive: true });
mkdirSync(join(projectDir, "textures/particle"), { recursive: true });
const num = (code: string, re: RegExp, fallback: number) => Number(re.exec(code)?.[1] ?? fallback);
let count = 0;
for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".java")) : []) {
  const code = readFileSync(join(dir, file), "utf8");
  const id = /setRegistryName\("(\w+)"\)/.exec(code)?.[1];
  if (!id) continue;
  const source = join(textures, `${id}.png`);
  const texture = existsSync(source) ? `textures/particle/${id}.png` : "";
  if (texture) copyFileSync(source, join(projectDir, texture));
  const size = /setSize\(([\d.]+)F?,\s*([\d.]+)F?\)/.exec(code);
  const element = {
    ...newElement(type, id),
    texture,
    animate: /setSpriteFromAge/.test(code),
    renderType: /PARTICLE_SHEET_TRANSLUCENT/.test(code) ? "TRANSLUCENT" : "OPAQUE",
    width: size ? Number(size[1]) : 0.2,
    height: size ? Number(size[2]) : 0.2,
    scale: num(code, /quadSize \*= ([\d.]+)F?/, 1),
    maxAge: num(code, /this\.lifetime = (\d+)/, 7),
    gravity: num(code, /this\.gravity = (-?[\d.]+)F?/, 0),
    canCollide: !/hasPhysics = false/.test(code),
    speedFactor: num(code, /this\.xd = vx \* ([\d.]+)/, 1),
    alwaysShow: /new BasicParticleType\(true\)/.test(code),
  };
  writeFileSync(join(projectDir, "elements/particles", `${id}.json`), JSON.stringify(element, null, 2));
  count++;
}
console.log(`imported ${count} particles`);
