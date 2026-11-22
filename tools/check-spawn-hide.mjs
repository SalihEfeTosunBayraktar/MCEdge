// Fails when a child_process call in src/ or app/ can open a console window on Windows.
// Every spawn/exec/fork call must pass `windowsHide: true`. A deliberately visible GUI launch carries a
// `visible-on-purpose` comment on the line above the call and says `windowsHide: false`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const FNS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];
const MODULE = /["'](?:node:)?(?:child_process|cross-spawn|execa)["']/;
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") walk(p); }
    else if (/\.(ts|tsx|mjs|js|cjs)$/.test(name)) files.push(p);
  }
};
for (const d of ["src", "app"]) walk(join(root, d));

const problems = [];
let calls = 0, visible = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!MODULE.test(text)) continue;
  const rel = relative(root, file).split("\\").join("/");
  const imported = new Set();
  const named = /import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?child_process["']/g;
  for (const m of text.matchAll(named))
    for (const part of m[1].split(",")) {
      const [orig, alias] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if (FNS.includes(orig)) imported.add(alias ?? orig);
    }
  // Any other way of loading the module (namespace import, require, cross-spawn, execa) cannot be audited call by call.
  const other = text.replace(named, "");
  if (MODULE.test(other)) problems.push(`${rel}: load child_process with a named import so every call can be audited`);
  for (const name of imported) {
    for (const m of text.matchAll(new RegExp(`(?<![\\w.])${name}\\s*\\(`, "g"))) {
      let depth = 0, i = m.index + m[0].length - 1;
      for (; i < text.length; i++) { if (text[i] === "(") depth++; else if (text[i] === ")" && --depth === 0) break; }
      const args = text.slice(m.index, i + 1);
      const before = text.slice(0, m.index).split("\n");
      const line = before.length;
      const prev = before.length > 1 ? before[before.length - 2] : "";
      calls++;
      if (/visible-on-purpose/.test(prev)) {
        visible++;
        if (!/windowsHide:\s*false/.test(args)) problems.push(`${rel}:${line}: visible-on-purpose call must say windowsHide: false`);
      } else if (!/windowsHide:\s*true/.test(args)) problems.push(`${rel}:${line}: ${name}() lacks windowsHide: true`);
    }
  }
}
if (problems.length) { console.error(`FAIL\n${problems.join("\n")}`); process.exit(1); }
console.log(`PASS: ${calls} child_process calls audited (${visible} visible on purpose) in ${files.length} files`);
