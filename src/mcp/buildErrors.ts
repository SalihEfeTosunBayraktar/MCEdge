import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseJavacDiagnostics, type JavacDiagnostic } from "../build/javacErrors.ts";
import type { Element } from "../elements/model.ts";
import { listEngines } from "../engines/registry.ts";
import { readSourceMap, type SourceMap } from "../generator/sourceMap.ts";
import { loadProject } from "../ir/storage.ts";
import { asProgram, type BlockNode } from "../procedures/model.ts";
import { PROGRAM_FIELD } from "../procedures/project.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/** A compile diagnostic with where it came from in the project. */
export interface MappedDiagnostic {
  severity: JavacDiagnostic["severity"];
  message: string;
  /** Generated file, relative to the engine folder, and its line. */
  file: string;
  line: number;
  /** The Java line, trimmed. */
  code?: string;
  detail: string[];
  /** "type/id" of the element whose generated class it is. */
  element?: string;
  /** Procedure block the line belongs to: IR path, block id and the block's fields. */
  block?: { path: string; block: string; fields?: Record<string, unknown> };
  /** Fields of the element (or block) whose value appears on the Java line: likely the cause. */
  fields?: string[];
}

/** The node at an IR path ("stacks[0].blocks[2].inputs.do[1]"). */
function nodeAt(program: unknown, path: string): BlockNode | undefined {
  let current: unknown = program;
  for (const part of path.split(".")) {
    const m = /^(\w+)(?:\[(\d+)\])?$/.exec(part);
    if (!m || !current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[m[1]];
    if (m[2] !== undefined) current = Array.isArray(current) ? current[Number(m[2])] : undefined;
  }
  return current as BlockNode | undefined;
}

/** Dot paths of the string values of an object ("name", "drops[0].item"), skipping the block program. */
function stringFields(value: unknown, prefix = ""): [string, string][] {
  if (typeof value === "string") return [[prefix, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringFields(v, `${prefix}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => (k === PROGRAM_FIELD || k === "$schema" ? [] : stringFields(v, prefix ? `${prefix}.${k}` : k)));
  }
  return [];
}

/** Fields whose text (or its local part after "modid:") shows on the Java line. */
function fieldsOnLine(values: unknown, code: string | undefined): string[] {
  if (!code) return [];
  return stringFields(values)
    .filter(([key, v]) => key && key !== "id" && v.length >= 3 && (code.includes(v) || (v.includes(":") && code.includes(v.slice(v.indexOf(":") + 1)))))
    .map(([key]) => key);
}

/** Points javac diagnostics of an engine folder at elements, procedure blocks and fields through its source map. */
export function mapDiagnostics(root: string, outDir: string, diagnostics: JavacDiagnostic[], map: SourceMap | undefined = readSourceMap(outDir)): MappedDiagnostic[] {
  const project = loadProject(root);
  const find = (ref: string): Element | undefined => {
    const [type, id] = ref.split("/");
    return project.elements[type]?.find((e) => e.id === id);
  };
  return diagnostics.map((d) => {
    const abs = isAbsolute(d.file) ? d.file : resolve(outDir, d.file);
    const file = relative(outDir, abs).replaceAll("\\", "/");
    const lines = existsSync(abs) ? readFileSync(abs, "utf8").split("\n") : [];
    const code = lines[d.line - 1]?.trim() ?? d.detail[0]?.trim();
    const out: MappedDiagnostic = { severity: d.severity, message: d.message, file, line: d.line, ...(code ? { code } : {}), detail: d.detail };
    const entry = map?.files[file];
    if (!entry) return out;
    out.element = entry.element;
    const element = find(entry.element);
    const range = entry.blocks?.filter(([from, to]) => d.line >= from && d.line <= to).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]))[0];
    if (range && element) {
      const node = nodeAt(asProgram(entry.element.startsWith("command/") ? element.argsxml : element[PROGRAM_FIELD]), range[2]);
      out.block = { path: range[2], block: node?.block ?? "?", ...(node?.fields ? { fields: node.fields } : {}) };
      const fields = fieldsOnLine(node?.fields, code).map((f) => `${range[2]}.fields.${f}`);
      if (fields.length) out.fields = fields;
    } else if (element) {
      const fields = fieldsOnLine(element, code);
      if (fields.length) out.fields = fields;
    }
    return out;
  });
}

/** Build log errors of one engine folder, mapped; warnings only when asked. */
export function buildDiagnostics(root: string, engine: string, lines?: string[], warnings = false): MappedDiagnostic[] {
  const outDir = join(root, "out", engine);
  const logFile = join(outDir, "build", "mcedge-build.log");
  const log = lines ?? (existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n") : undefined);
  if (!log) throw new Error(`no build log for ${engine}; run build first`);
  return mapDiagnostics(root, outDir, parseJavacDiagnostics(log).filter((d) => warnings || d.severity === "error"));
}

export function registerBuildErrorTools(server: McpServer, root: string, guard: Guard): void {
  server.registerTool(
    "build_errors",
    {
      description: "Compile errors of the engine's last build (out/<engine>/build/mcedge-build.log), each pointed back at its source through the generator's source map: "
        + "the element whose class it is, for procedures the block (IR path as in read_procedure, block id and fields), and the fields whose value is on the failing Java line. "
        + "Does not build; `build` returns the same list.",
      inputSchema: { engine: z.string(), warnings: z.boolean().default(false).describe("Include javac warnings") },
    },
    ({ engine, warnings }) => guard(() => {
      if (!listEngines().some((e) => e.id === engine)) throw new Error(`unknown engine ${engine}`);
      const all = buildDiagnostics(root, engine, undefined, warnings);
      return json({ count: all.length, diagnostics: all.slice(0, 100) });
    }),
  );
}
