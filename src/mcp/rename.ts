import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { changeModIdentity } from "../ir/modIdentity.ts";
import { renameElement, renameSummary } from "../ir/rename.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/** Rename an element together with everything that names it (src/ir/renamePlan.ts computes it, src/ir/rename.ts writes it). */
export function registerRenameTool(server: McpServer, root: string, guard: Guard): void {
  server.registerTool(
    "rename_element",
    {
      description: "Rename an element and update everything that names it: fields and procedure blocks that refer to it, java_code class names and quoted ids, tags, raw datapack files, "
        + "translation keys (\"item.<mod>.<id>\", \"gui.<mod>.<id>.*\"), folders.json, and texture files named after it when nothing else uses them. "
        + "Everything is computed first and checked (no reference may be lost; the project is left unchanged when a write fails). `dryRun` only reports what would change. "
        + "Plain words in java_code that are not class names or quoted ids are reported as warnings, not changed. Ids are lower_snake_case and unique.",
      inputSchema: { type: z.string(), id: z.string(), newId: z.string(), dryRun: z.boolean().default(false) },
    },
    ({ type, id, newId, dryRun }) => guard(() => json({ ...renameSummary(renameElement(root, type, id, newId, { dryRun })), dryRun })),
  );
  server.registerTool(
    "change_mod_identity",
    {
      description: "Change the mod id and/or the Java package (Workspace settings > Mod > Change id and package). A new mod id rewrites every \"<old>:\" id in "
        + "elements, procedures, tags, variables, models and datapack files, renames the translation keys that carry it (\"item.<old>.ruby\" -> \"item.<new>.ruby\") "
        + "and moves datapack/<old> to datapack/<new>. A new package is rewritten in element code (custom elements, java_code). Everything is checked first and "
        + "a failed write leaves the project unchanged. `dryRun` only reports what would change. Mod ids are 2-64 lowercase letters, digits and _.",
      inputSchema: { modId: z.string().optional(), package: z.string().optional(), dryRun: z.boolean().default(false) },
    },
    ({ modId, package: pkg, dryRun }) => guard(() => {
      const { written: _written, ...result } = changeModIdentity(root, { modId, package: pkg }, { dryRun });
      return json(result);
    }),
  );
}
