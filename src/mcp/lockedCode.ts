import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listEngines } from "../engines/registry.ts";
import { generateTarget } from "../generator/generate.ts";
import { LOCK_DIR, lockedChanges, lockedElements, lockElementCode, unlockElementCode } from "../generator/lockedCode.ts";
import { loadProject } from "../ir/storage.ts";

/** Locked generated code per element and Build > Regenerate code, for agents (KUYRUK 131). */

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown, isError = false): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

export function registerLockedCodeTools(server: McpServer, root: string, guard: Guard): void {
  server.registerTool(
    "lock_element_code",
    {
      description: `Lock an element's generated code: the files the generator makes for it alone (its classes, models, loot table... not shared registries or lang files) are written once per engine into ${LOCK_DIR}/<type>/<id>/<engine>/ and from then on every generation uses them instead of fresh ones. `
        + "Edit them there (read_file / edit_file); they are versioned with the project. Rename is refused while locked. Returns the locked files per engine.",
      inputSchema: { type: z.string(), id: z.string() },
    },
    ({ type, id }) => guard(() => {
      const locked = lockElementCode(loadProject(root), root, type, id);
      return json({ ...locked, folder: `${LOCK_DIR}/${type}/${id}` });
    }),
  );
  server.registerTool(
    "unlock_element_code",
    {
      description: "Unlock an element's generated code so generation writes it fresh again. When a locked file differs from what the generator makes now, the element stays locked "
        + "and the differences are returned (per file: changed line count, the first changed line in both versions); call again with force to unlock and drop those edits.",
      inputSchema: { type: z.string(), id: z.string(), force: z.boolean().default(false) },
    },
    ({ type, id, force }) => guard(() => {
      const result = unlockElementCode(loadProject(root), root, type, id, force);
      return json({ ...result, changes: result.changes.filter((c) => c.status !== "same") }, !result.unlocked);
    }),
  );
  server.registerTool(
    "list_locked_code",
    {
      description: "Elements with locked generated code and their files per engine; with `changes`, also how each file differs from fresh generation (edited, same, gone).",
      inputSchema: { changes: z.boolean().default(false) },
    },
    ({ changes }) => guard(() => {
      const project = loadProject(root);
      return json(lockedElements(root).map((l) => ({
        ...l,
        exists: !!project.elements[l.type]?.some((e) => e.id === l.id),
        ...(changes ? { changes: lockedChanges(project, root, l.type, l.id).filter((c) => c.status !== "same") } : {}),
      })));
    }),
  );
  server.registerTool(
    "regenerate_code",
    {
      description: "Build > Regenerate code: generate the engines' Gradle projects into out/<engine> without building (locked elements keep their locked files). "
        + "Returns per engine the skipped elements, the warnings and the locked files written.",
      inputSchema: { engines: z.array(z.string()).optional().describe("Engine ids; all when omitted") },
    },
    ({ engines }) => guard(() => {
      const all = listEngines();
      const chosen = engines?.length ? all.filter((e) => engines.includes(e.id)) : all;
      if (engines?.length && chosen.length !== engines.length) throw new Error(`unknown engine; one of ${all.map((e) => e.id).join(", ")}`);
      const project = loadProject(root);
      const locked = lockedElements(root);
      return json(chosen.map((engine) => {
        const { skipped, warnings } = generateTarget(project, root, engine, join(root, "out", engine.id));
        const lockedFiles = locked.flatMap((l) => l.engines.find((e) => e.engine === engine.id)?.files ?? []);
        return { engine: engine.id, out: `out/${engine.id}`, skipped, warnings, lockedFiles: lockedFiles.length };
      }));
    }),
  );
}
