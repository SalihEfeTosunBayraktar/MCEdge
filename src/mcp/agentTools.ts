import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { typeRegistry } from "../elements/registry.ts";
import { applyBatch, cloneOps, listTemplates, saveTemplate, templateOps, type BatchOp } from "../ir/batch.ts";
import { findElements, PREDICATE_OPS } from "../ir/elementSearch.ts";
import { projectSummary } from "../ir/projectSummary.ts";
import { applyStarter, listStarters } from "../ir/starters.ts";
import { loadProject } from "../ir/storage.ts";

/** Whole-job tools for agents (KUYRUK 145): project summary, field search, atomic batches, clones and templates. */

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown, isError = false): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });
/** A value longer than this (as JSON) is shown by its size only; read_element gives it whole. */
const MAX_VALUE_CHARS = 600;

const writeOptions = {
  dryRun: z.boolean().default(false).describe("Check and report only; nothing is written"),
  allowProblems: z.boolean().default(false).describe("Write even if the result has validation problems the project did not have"),
};
const batchAnswer = (result: ReturnType<typeof applyBatch>) => json(result, !result.applied && !result.dryRun);

export function registerAgentTools(server: McpServer, root: string, guard: Guard): void {
  server.registerTool(
    "project_summary",
    {
      description: "One look at the whole project: element counts per type, problems (total, per element, the first ones), what each engine leaves out of THIS project "
        + "(skipped elements, fields set away from their default that it does not generate, procedure blocks/triggers it does not generate) and the biggest procedures. Generates nothing on disk.",
      inputSchema: { engines: z.array(z.string()).optional().describe("Engine ids; all when omitted") },
    },
    ({ engines }) => guard(() => json(projectSummary(root, engines))),
  );

  server.registerTool(
    "find_elements",
    {
      description: "Elements whose field values pass every condition (and). `field` is a dot path; a list on the way is entered row by row (\"drops.item\"), any row may match. "
        + `ops: ${PREDICATE_OPS.join(", ")} (contains: case-insensitive substring or list entry; matches: case-insensitive regex; a missing field counts as empty). `
        + "Returns type, id, name, folder and the values of the condition fields and of `select`.",
      inputSchema: {
        type: z.string().optional(),
        where: z.array(z.object({ field: z.string(), op: z.enum(PREDICATE_OPS), value: z.unknown().optional() })).default([]),
        select: z.array(z.string()).optional().describe("More fields to return"),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      },
    },
    ({ type, where, select, limit, offset }) => guard(() => {
      if (type && !typeRegistry().byId.has(type)) throw new Error(`unknown element type "${type}"; see list_element_types`);
      const all = findElements(loadProject(root), typeRegistry().byId, { type, where, select });
      const end = offset + limit;
      const shorten = (v: unknown) => {
        const text = JSON.stringify(v);
        return text && text.length > MAX_VALUE_CHARS ? `<${text.length} chars; read_element>` : v;
      };
      const elements = all.slice(offset, end).map((m) => ({ ...m, values: Object.fromEntries(Object.entries(m.values).map(([k, v]) => [k, shorten(v)])) }));
      return json({ total: all.length, offset, limit, ...(end < all.length ? { next: end } : {}), elements });
    }),
  );

  const op = z.discriminatedUnion("op", [
    z.object({ op: z.literal("create"), type: z.string(), id: z.string(), values: z.record(z.string(), z.unknown()).optional(), folder: z.string().optional() }),
    z.object({ op: z.literal("update"), type: z.string(), id: z.string(), values: z.record(z.string(), z.unknown()) }),
    z.object({ op: z.literal("delete"), type: z.string(), id: z.string() }),
  ]);
  server.registerTool(
    "batch_elements",
    {
      description: "Create, update and delete many elements as one atomic change. Ops run in order against the project as the earlier ops leave it (create: type defaults plus values, "
        + "optionally into a folder; update: the given top-level keys replace theirs; delete). Everything is checked first: an op that cannot run, or validation problems the "
        + "project did not have before (unless allowProblems), write nothing. Returns applied, errors by op index, newProblems and how many problems it fixed.",
      inputSchema: { ops: z.array(op).min(1).max(500), ...writeOptions },
    },
    ({ ops, dryRun, allowProblems }) => guard(() => batchAnswer(applyBatch(root, ops as BatchOp[], { dryRun, allowProblems }))),
  );

  server.registerTool(
    "clone_elements",
    {
      description: "Copy a set of elements under new ids in one atomic change (a block with its procedures and GUI, say). A reference from one copy to another element of the set "
        + "points at that element's copy; references to elements outside the set stay. `replace` swaps text in every string of the copies afterwards (display names: "
        + "\"Ruby\" -> \"Sapphire\"); `values` per element override fields. Copies go into their source's folder and share its textures. Checked like batch_elements.",
      inputSchema: {
        elements: z.array(z.object({ type: z.string(), id: z.string(), newId: z.string(), values: z.record(z.string(), z.unknown()).optional() })).min(1).max(200),
        replace: z.array(z.object({ from: z.string().min(1), to: z.string() })).optional(),
        ...writeOptions,
      },
    },
    ({ elements, replace, dryRun, allowProblems }) => guard(() => batchAnswer(applyBatch(root, cloneOps(root, { elements, replace }), { dryRun, allowProblems }))),
  );

  server.registerTool("list_templates", { description: "Element templates of the project (templates/<name>.json): name, description, parameters with the example value each replaced, and the elements." },
    () => guard(() => json(listTemplates(root))));
  server.registerTool(
    "save_template",
    {
      description: "Save elements as a reusable template in templates/<name>.json. Each parameter's value is replaced by a placeholder wherever it appears in ids and strings, "
        + "in four spellings: {{p}} ruby_gem, {{P}} RubyGem, {{P Words}} Ruby Gem, {{P_UPPER}} RUBY_GEM (for a parameter \"name\": {{name}}, {{Name}}, {{Name Words}}, {{NAME}}). "
        + "Replaces a template of the same name.",
      inputSchema: {
        name: z.string(), description: z.string().optional(),
        params: z.record(z.string(), z.string().min(1)).describe("Parameter -> the value it replaces, e.g. { \"name\": \"ruby\" }"),
        elements: z.array(z.object({ type: z.string(), id: z.string() })).min(1),
      },
    },
    (input) => guard(() => {
      const saved = saveTemplate(root, input);
      return json({ saved: `templates/${saved.name}.json`, params: saved.params, elements: saved.elements.map((e) => `${e.type}/${e.id}`) });
    }),
  );
  server.registerTool(
    "create_from_template",
    {
      description: "Create the elements of a template with its parameters filled in (every spelling), as one atomic change checked like batch_elements; optionally into a folder.",
      inputSchema: { name: z.string(), params: z.record(z.string(), z.string().min(1)), folder: z.string().optional(), ...writeOptions },
    },
    ({ name, params, folder, dryRun, allowProblems }) => guard(() => batchAnswer(applyBatch(root, templateOps(root, name, params, folder), { dryRun, allowProblems }))),
  );

  server.registerTool("list_starters", { description: "The template gallery (Q252): starters (a sword, an ore, a mob, a machine with a GUI...) that built on every target engine and passed a dedicated-server smoke test: id, name, description, parameters with their example value, the elements it creates, and the engines it was verified on. Add one with create_from_starter; File > New project can start from one (create_project starter)." },
    () => guard(() => json(listStarters().map((s) => ({ id: s.id, name: s.name, description: s.description, params: s.params, elements: s.elements, verifiedOn: Object.keys(s.verified) })))));
  server.registerTool(
    "create_from_starter",
    {
      description: "Add a starter of the gallery (list_starters) to this project, with its textures, as one atomic change checked like batch_elements. params: every parameter of the starter (lowercase letters, digits, _), e.g. { \"name\": \"ruby\" } makes ruby_sword. Textures are copied to textures/; an existing texture file is never replaced.",
      inputSchema: { id: z.string(), params: z.record(z.string(), z.string().min(1)), folder: z.string().optional(), ...writeOptions },
    },
    ({ id, params, folder, dryRun, allowProblems }) => guard(() => {
      if (!listStarters().some((s) => s.id === id)) throw new Error(`no starter "${id}" in the gallery; see list_starters`);
      return batchAnswer(applyStarter(root, id, params, { folder, dryRun, allowProblems }));
    }),
  );
}
