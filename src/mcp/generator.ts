import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { typeFields } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import { engineCoverage } from "../engines/coverage.ts";
import { listEngines } from "../engines/registry.ts";
import { loadModel, type Part } from "../generator/mob/models.ts";
import type { GenEnv } from "../generator/typeModule.ts";
import { loadProject, saveElement } from "../ir/storage.ts";
import { asProgram, countBlocks, mainStack, type ProcedureIR } from "../procedures/model.ts";
import { checkProgram } from "./procedures.ts";

/** Generator tools for agents: what each engine generates, project entity models, mob AI goals. */

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

export function registerGeneratorTools(server: McpServer, root: string, guard: (fn: () => Text) => Promise<Text> | Text): void {
  server.registerTool(
    "coverage",
    {
      description: "Fields each engine does not generate (the editor's \"not generated\" badges): per element type, field -> engines that skip it, or the only values they generate. Empty for a type means every engine generates all its fields.",
      inputSchema: { type: z.string().optional().describe("Element type id, e.g. living_entity; all types when omitted") },
    },
    ({ type }) =>
      guard(() => {
        const engines = listEngines();
        const coverage = new Map(engines.map((e) => [e.id, engineCoverage(e)]));
        const out: Record<string, Record<string, Record<string, string>>> = {};
        for (const t of typeRegistry().byId.values()) {
          if (type && t.id !== type) continue;
          const rows: Record<string, Record<string, string>> = {};
          const keys = typeFields(t).flatMap((f) => [f.key, ...(f.fields ?? []).map((s) => `${f.key}.${s.key}`)]);
          for (const key of keys) {
            for (const e of engines) {
              const c = coverage.get(e.id)![t.id];
              const v = c?.[key];
              if (v === true) continue;
              (rows[key] ??= {})[e.id] = !c ? "type not generated" : v ? `only ${v.join(", ")}` : "not generated";
            }
          }
          out[t.id] = rows;
        }
        if (type && !out[type]) throw new Error(`unknown type "${type}"`);
        return json(out);
      }),
  );

  server.registerTool(
    "entity_models",
    {
      description: "Project entity models (models/<name>.java Blockbench export or <name>.bbmodel) usable in living entity model fields: parts, texture size, animations (by the name an animation row may use) and reading problems.",
      inputSchema: {},
    },
    () =>
      guard(() => {
        const dir = join(root, "models");
        const env = { projectDir: root, project: loadProject(root) } as unknown as GenEnv;
        const names = existsSync(dir) ? [...new Set(readdirSync(dir).filter((n) => /^[A-Za-z0-9_]+\.(java|bbmodel)$/.test(n)).map((n) => n.replace(/\.(java|bbmodel)$/, "")))] : [];
        const flat = (parts: Part[]): string[] => parts.flatMap((p) => [p.name, ...flat(p.children)]);
        return json(names.map((name) => {
          const m = loadModel(env, name);
          return { name, parts: flat(m.parts), texture: `${m.texW}x${m.texH}`, animations: m.animations.filter((a) => a.channels.length).map((a) => a.name), warnings: m.warnings };
        }).filter((m) => m.parts.length || m.animations.length));
      }),
  );

  server.registerTool(
    "write_ai_goals",
    {
      description: "Set a living entity's AI goals (field aixml) from IR JSON: the start block followed by goal blocks (category \"ai\" in procedure_blocks), highest priority first. Each goal takes optional procedure fields condition and continueCondition. With an empty program the mob keeps the default goals.",
      inputSchema: { entity: z.string(), program: z.record(z.string(), z.unknown()) },
    },
    ({ entity, program }) =>
      guard(() => {
        const ir = program as unknown as ProcedureIR;
        const problems = checkProgram(ir);
        const goals = (mainStack(asProgram(ir))?.blocks ?? []).slice(1);
        for (const g of goals) if (!g.block.startsWith("ai_")) problems.push(`${g.block}: not an AI goal block`);
        if (problems.length) return { ...json({ saved: false, problems }), isError: true };
        const element = (loadProject(root).elements.living_entity ?? []).find((e) => e.id === entity);
        if (!element) throw new Error(`no living entity "${entity}"`);
        saveElement(root, "living_entity", { ...element, aixml: ir });
        return json({ saved: true, goals: goals.map((g) => g.block), blocks: countBlocks(ir) });
      }),
  );
}
