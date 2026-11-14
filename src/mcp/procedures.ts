import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newElement, type Element } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import { listEngines } from "../engines/registry.ts";
import { genEnv } from "../generator/generate.ts";
import { procEnv } from "../generator/procedures.ts";
import { loadProject, saveElement } from "../ir/storage.ts";
import { ROOT } from "../paths.ts";
import { analyzeProcedure, blockGenerated } from "../procedures/analyze.ts";
import { BLOCKS, BLOCKS_BY_ID } from "../procedures/blocks/index.ts";
import { CATEGORIES, type Loader } from "../procedures/blockTypes.ts";
import { compileProcedure } from "../procedures/compile.ts";
import type { Gen } from "../procedures/javaNames.ts";
import { asProgram, countBlocks, IR_FORMAT, isNode, LOCAL_TYPES, walkNodes, type ProcedureIR } from "../procedures/model.ts";
import { compileScope, globalVars, procedureFieldUses, procedureLookup, providedDependencies, PROGRAM_FIELD } from "../procedures/project.ts";
import { GLOBAL_TRIGGERS, triggerCode } from "../procedures/triggers.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

const ID = /^[a-z0-9_]+$/;

/** Generation and loader of each engine, for coverage listings. */
function engineTargets(): { id: string; gen: Gen; loader: Loader }[] {
  return listEngines().map((e) => ({
    id: e.id,
    gen: (e.minecraft === "1.16.5" ? "1.16.5" : e.minecraft.startsWith("1.21") ? "1.21.5" : "26.3") as Gen,
    loader: e.loader as Loader,
  }));
}

/** Structural problems of an IR written by an agent: unknown blocks, inputs, fields or variables. */
export function checkProgram(ir: ProcedureIR): string[] {
  const problems: string[] = [];
  if (ir.format !== IR_FORMAT) problems.push(`format must be ${IR_FORMAT}`);
  if (!Array.isArray(ir.variables) || !Array.isArray(ir.stacks)) return [...problems, "variables and stacks must be arrays"];
  for (const v of ir.variables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name ?? "")) problems.push(`variable "${v.name}": not a Java identifier`);
    if (!(LOCAL_TYPES as readonly string[]).includes(v.type)) problems.push(`variable "${v.name}": unknown type "${v.type}"`);
  }
  if (ir.stacks.filter((s) => s.blocks?.[0]?.block === "start").length > 1) problems.push("only one stack may start with the start block");
  for (const { node, path } of walkNodes(ir)) {
    const def = BLOCKS_BY_ID.get(node.block);
    if (!def) {
      problems.push(`${path}: unknown block "${node.block}"`);
      continue;
    }
    for (const name of Object.keys(node.inputs ?? {})) {
      const input = def.inputs?.find((i) => i.name === name);
      const value = node.inputs![name];
      if (!input) problems.push(`${path}: block "${node.block}" has no input "${name}"`);
      else if (input.type === "statements" && !Array.isArray(value)) problems.push(`${path}.inputs.${name}: must be a list of statement blocks`);
      else if (input.type !== "statements" && Array.isArray(value)) problems.push(`${path}.inputs.${name}: takes one value, not a list`);
      else if (isNode(value)) {
        const inner = BLOCKS_BY_ID.get(value.block);
        if (inner && !inner.output) problems.push(`${path}.inputs.${name}: "${value.block}" is a statement block`);
        else if (inner?.output && input.type !== "any" && inner.output !== "any" && input.type !== "statements" && inner.output !== input.type) {
          problems.push(`${path}.inputs.${name}: expects ${input.type}, "${value.block}" gives ${inner.output}`);
        }
      }
    }
    for (const name of Object.keys(node.fields ?? {})) {
      const field = def.fields?.find((f) => f.name === name);
      if (!field) problems.push(`${path}: block "${node.block}" has no field "${name}"`);
      else if (field.kind === "dropdown" && !field.options?.includes(String(node.fields![name]))) problems.push(`${path}.fields.${name}: one of ${field.options?.join(", ")}`);
    }
  }
  return problems;
}

/** Procedure tools of the MCP server: the block catalog and reading and writing procedures through the IR. */
export function registerProcedureTools(server: McpServer, root: string, guard: (fn: () => Promise<Text> | Text) => Promise<Text>): void {
  const labels = JSON.parse(readFileSync(join(ROOT, "config/procedure-blocks/en.json"), "utf8")) as { blocks: Record<string, string>; tips: Record<string, string> };
  const types = () => typeRegistry().byId;

  server.registerTool(
    "procedure_blocks",
    {
      description: "List procedure blocks: id, label, category, side (server/client/both), output type, inputs, fields, dependencies and the engines that generate it. Filter by category or a search text.",
      inputSchema: { category: z.enum(CATEGORIES).optional(), query: z.string().optional() },
    },
    ({ category, query }) =>
      guard(() => {
        const targets = engineTargets();
        const q = query?.toLowerCase();
        const blocks = BLOCKS
          .filter((b) => !category || b.category === category)
          .filter((b) => !q || `${b.id} ${labels.blocks[b.id] ?? ""}`.toLowerCase().includes(q))
          .map((b) => ({
            id: b.id,
            label: labels.blocks[b.id],
            ...(labels.tips[b.id] ? { tip: labels.tips[b.id] } : {}),
            category: b.category,
            side: b.side,
            ...(b.output ? { output: b.output } : { statement: true, ...(b.terminal ? { terminal: true } : {}) }),
            inputs: (b.inputs ?? []).map((i) => ({ name: i.name, type: i.type, ...(i.default !== undefined ? { default: i.default } : {}) })),
            fields: (b.fields ?? []).map((f) => ({ name: f.name, kind: f.kind, ...(f.options ? { options: f.options } : {}), ...(f.registry ? { registry: f.registry } : {}), ...(f.varType ? { varType: f.varType } : {}), ...(f.scope ? { scope: f.scope } : {}), ...(f.default !== undefined ? { default: f.default } : {}) })),
            ...(b.deps?.length ? { dependencies: b.deps } : {}),
            ...(b.depField ? { dependencyFromField: b.depField } : {}),
            engines: targets.filter((t) => blockGenerated(b, t.gen, t.loader)).map((t) => t.id),
          }));
        return json({ count: blocks.length, irFormat: "see read_procedure; inputs hold a block, a list of blocks (statements) or a JSON literal", blocks });
      }),
  );

  server.registerTool(
    "procedure_triggers",
    { description: "List global procedure triggers with the dependencies they provide, their side and the engines that generate them." },
    () =>
      guard(() => {
        const targets = engineTargets();
        return json(GLOBAL_TRIGGERS.map((t) => ({ id: t.id, side: t.side, provides: t.deps, engines: targets.filter((e) => triggerCode(t.code, e.gen, e.loader)).map((e) => e.id) })));
      }),
  );

  server.registerTool(
    "read_procedure",
    {
      description: "Read a procedure: its settings, its block program as IR JSON, the dependencies it needs, what its trigger provides and the warnings an engine would report.",
      inputSchema: { id: z.string(), engine: z.string().optional().describe("Engine id for coverage warnings and the generated Java") , java: z.boolean().optional().describe("Include the generated Java (needs engine)") },
    },
    ({ id, engine, java }) =>
      guard(() => {
        const project = loadProject(root);
        const element = (project.elements.procedure ?? []).find((p) => p.id === id);
        if (!element) throw new Error(`no procedure "${id}"; procedures: ${(project.elements.procedure ?? []).map((p) => p.id).join(", ")}`);
        const ir = asProgram(element[PROGRAM_FIELD]);
        const uses = procedureFieldUses(project, types());
        const target = engine ? engineTargets().find((t) => t.id === engine) : undefined;
        if (engine && !target) throw new Error(`unknown engine ${engine}`);
        const globals = globalVars(project);
        const analysis = analyzeProcedure(ir, {
          lookup: procedureLookup(project),
          provided: providedDependencies(element, uses),
          engine: target && { gen: target.gen, loader: target.loader, name: target.id },
          globals: (scope, type) => [...globals.values()].filter((g) => g.player === (scope === "player") && g.type === type).map((g) => g.name),
        });
        let generated: unknown;
        if (java && target) {
          // Same environment the generator uses, so tags map ("forge:crops" is "c:crops" on NeoForge and Fabric).
          const env = procEnv(genEnv(project, root, listEngines().find((e) => e.id === target.id)!, project.elements));
          const { scope } = compileScope(project, types(), env.modClass);
          const out = compileProcedure(scope.procedures.get(id)!, scope, env);
          generated = { source: out.source, clientSource: out.clientSource, packets: out.segments.map((s) => s.name) };
        }
        return json({
          id, title: element.title, globalTrigger: element.globalTrigger, returnType: element.returnType, skipDependencyNullCheck: element.skipDependencyNullCheck,
          blocks: countBlocks(ir), dependencies: analysis.deps, provided: providedDependencies(element, uses) ?? "parameters (no trigger)",
          calledBy: uses.filter((u) => u.procedureId === id).map((u) => `${u.typeId}/${u.elementId}.${u.fieldKey}`),
          warnings: analysis.warnings, program: ir, ...(generated ? { java: generated } : {}),
        });
      }),
  );

  server.registerTool(
    "write_procedure",
    {
      description: "Create or replace a procedure from IR JSON. program = { format: 1, variables: [{name, type}], stacks: [{ x, y, blocks: [{ block: \"start\" }, ...] }] }; a block is { block, fields?, inputs? } where an input holds a value block, a list of statement blocks, or a number/string/boolean literal. Returns the warnings of the saved procedure.",
      inputSchema: {
        id: z.string(),
        program: z.record(z.string(), z.unknown()),
        title: z.string().optional(),
        globalTrigger: z.string().optional(),
        returnType: z.string().optional(),
      },
    },
    ({ id, program, title, globalTrigger, returnType }) =>
      guard(() => {
        if (!ID.test(id)) throw new Error("id must be lowercase snake_case");
        const ir = program as unknown as ProcedureIR;
        const problems = checkProgram(ir);
        if (problems.length) return { ...json({ saved: false, problems }), isError: true };
        const type = types().get("procedure")!;
        const project = loadProject(root);
        const existing = (project.elements.procedure ?? []).find((p) => p.id === id);
        const element: Element = { ...(existing ?? newElement(type, id)), [PROGRAM_FIELD]: ir };
        if (title !== undefined) element.title = title;
        if (globalTrigger !== undefined) element.globalTrigger = globalTrigger;
        if (returnType !== undefined) element.returnType = returnType;
        saveElement(root, "procedure", element);
        const after = loadProject(root);
        const saved = after.elements.procedure!.find((p) => p.id === id)!;
        const analysis = analyzeProcedure(ir, { lookup: procedureLookup(after), provided: providedDependencies(saved, procedureFieldUses(after, types())) });
        return json({ saved: true, created: !existing, blocks: countBlocks(ir), dependencies: analysis.deps, warnings: analysis.warnings });
      }),
  );
}
