import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { compileProcedure, type CompileScope, type ProcEnv, type ProcedureUnit } from "../procedures/compile.ts";
import { isNode, type BlockNode, type ProcedureIR } from "../procedures/model.ts";
import { pascal } from "./java.ts";
import { procedureBuild } from "./procedures.ts";
import type { GenEnv } from "./typeModule.ts";

/**
 * Where generated Java came from (KUYRUK 145): out/<engine>/mcedge-sourcemap.json maps each generated .java file to
 * the element that made it and, for procedure classes, line ranges to procedure blocks. The Java itself is not
 * changed. Build and run tools read it to point a compile error or a stack frame at the element, field or block.
 */
export const SOURCE_MAP_FILE = "mcedge-sourcemap.json";

export interface SourceMap {
  version: 1;
  engine: string;
  /** Path relative to the engine folder ("src/main/java/com/x/procedures/FooProcedure.java"). */
  files: Record<string, { element: string; blocks?: [from: number, to: number, path: string][]; locked?: boolean }>;
}

const MARK = "//@mcedge-block ";

/**
 * Line ranges of a compiled procedure's statements: the procedure is compiled again with a marker java_code block
 * before every statement; the marker lines are removed and give the line each statement starts at. When the source
 * without markers differs from the real one (a marker changed how the code is split), there is no line map.
 */
function blockLines(unit: ProcedureUnit, scope: CompileScope, env: ProcEnv, real: { source: string; clientSource?: string }) {
  const marked = structuredClone(unit.ir) as ProcedureIR;
  const mark = (path: string): BlockNode => ({ block: "java_code", fields: { code: `${MARK}${path}`, deps: "", imports: "", gen: env.gen } });
  const markList = (list: unknown, base: string, offset = 0): unknown => {
    if (!Array.isArray(list)) return list;
    return list.flatMap((node, i) => {
      if (!isNode(node)) return [node];
      const path = `${base}[${i + offset}]`;
      for (const [name, value] of Object.entries(node.inputs ?? {})) if (Array.isArray(value)) node.inputs![name] = markList(value, `${path}.inputs.${name}`) as BlockNode[];
      return node.disabled ? [node] : [mark(path), node];
    });
  };
  marked.stacks.forEach((stack, s) => {
    const [first, ...rest] = stack.blocks ?? [];
    if (first?.block === "start") stack.blocks = [first, ...(markList(rest, `stacks[${s}].blocks`, 1) as BlockNode[])];
  });
  const out = compileProcedure({ ...unit, ir: marked }, scope, env);
  const strip = (source: string) => {
    const lines = source.split("\n");
    const kept: string[] = [];
    const starts: [number, string][] = [];
    for (let i = 0; i < lines.length; i++) {
      // A marker is "if (true) {", "//@mcedge-block <path>", "}".
      const m = lines[i + 1]?.trim().startsWith(MARK) && lines[i].trim() === "if (true) {" && lines[i + 2]?.trim() === "}" ? lines[i + 1].trim().slice(MARK.length) : undefined;
      if (m === undefined) {
        kept.push(lines[i]);
        continue;
      }
      starts.push([kept.length + 1, m]);
      i += 2;
    }
    return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n"), starts };
  };
  const ranges = (starts: [number, string][], total: number) => starts.map(([line, path], i): [number, number, string] => {
    // A statement runs to the line before the next statement that is not inside it.
    const next = starts.slice(i + 1).find(([, p]) => !p.startsWith(`${path}.`));
    return [line, (next ? next[0] : total + 1) - 1, path];
  });
  const server = strip(out.source);
  const client = out.clientSource !== undefined ? strip(out.clientSource) : undefined;
  if (server.text !== real.source || (client?.text ?? undefined) !== real.clientSource) return undefined;
  return { server: ranges(server.starts, server.text.split("\n").length), client: client && ranges(client.starts, client.text.split("\n").length) };
}

function javaFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? javaFiles(path) : name.endsWith(".java") ? [path] : [];
  });
}

/** Writes the source map of a generated engine folder. */
export function writeSourceMap(env: GenEnv, outDir: string, lockedPaths: readonly string[] = []): SourceMap {
  const build = procedureBuild(env);
  const procedureClasses = new Map<string, { id: string; client: boolean }>();
  for (const unit of build.scope.procedures.values()) {
    procedureClasses.set(unit.className, { id: unit.id, client: false });
    procedureClasses.set(`${unit.className}Client`, { id: unit.id, client: true });
  }
  // Classes of other elements start with the element's PascalCase id (RubyBlock, RubyBlockEntity, RubyBlockMenu).
  const owners: { prefix: string; type: string; id: string }[] = [];
  for (const [type, list] of Object.entries(env.generated)) if (type !== "recipe" && type !== "procedure") for (const e of list) owners.push({ prefix: pascal(e.id), type, id: e.id });
  owners.sort((a, b) => b.prefix.length - a.prefix.length);
  const lineMaps = new Map<string, ReturnType<typeof blockLines>>();
  const files: SourceMap["files"] = {};
  for (const file of javaFiles(join(outDir, "src", "main", "java"))) {
    const path = relative(outDir, file).replaceAll("\\", "/");
    const cls = path.slice(path.lastIndexOf("/") + 1, -".java".length);
    const procedure = procedureClasses.get(cls);
    if (procedure) {
      if (!lineMaps.has(procedure.id)) {
        const unit = build.scope.procedures.get(procedure.id)!;
        const compiled = build.compiled.get(procedure.id)!;
        lineMaps.set(procedure.id, blockLines(unit, build.scope, build.env, compiled));
      }
      const lines = lineMaps.get(procedure.id);
      const blocks = procedure.client ? lines?.client : lines?.server;
      // A command's argument program is the unit "command:<id>" (src/procedures/project.ts).
      const element = procedure.id.startsWith("command:") ? `command/${procedure.id.slice("command:".length)}` : `procedure/${procedure.id}`;
      files[path] = { element, ...(blocks?.length ? { blocks } : {}) };
      continue;
    }
    const candidates = owners.filter((o) => cls.startsWith(o.prefix) && (cls.length === o.prefix.length || /[A-Z]/.test(cls[o.prefix.length])));
    const best = candidates.filter((c) => c.prefix.length === candidates[0]?.prefix.length);
    const owner = best.find((c) => cls.slice(c.prefix.length).startsWith(pascal(c.type))) ?? best[0];
    if (owner) files[path] = { element: `${owner.type}/${owner.id}` };
  }
  // A locked file holds the user's code: its element stays, but generated lines no longer match blocks.
  for (const path of lockedPaths) if (files[path]) files[path] = { element: files[path].element, locked: true };
  const map: SourceMap = { version: 1, engine: env.engine.id, files };
  writeFileSync(join(outDir, SOURCE_MAP_FILE), JSON.stringify(map) + "\n");
  return map;
}

export function readSourceMap(outDir: string): SourceMap | undefined {
  const file = join(outDir, SOURCE_MAP_FILE);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SourceMap) : undefined;
}
