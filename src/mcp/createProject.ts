import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createProject, PROJECT_TEMPLATES, suggestPackage } from "../ir/createProject.ts";
import { loadProject } from "../ir/storage.ts";
import { importWorkspace } from "../resources/files.ts";
import { isAbsolute } from "node:path";

/** File > New project for agents (KUYRUK 126). */

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

export function registerCreateProjectTool(server: McpServer, guard: Guard): void {
  server.registerTool(
    "create_project",
    {
      description: "Create a new MCEdge project folder (File > New project): <parent>/<folder or modId> with the mod id, name, package and target engines. Template \"empty\" has no "
        + "elements; \"example\" starts from the bundled example (item, block, tool, recipes, creative tab) renamed to the new mod id and package. The folder must not exist or be empty. "
        + "This server stays on its own project; start `mcedge mcp <new folder>` to work in the new one.",
      inputSchema: {
        parent: z.string().describe("Absolute folder the project folder is made in"),
        name: z.string().min(1),
        modId: z.string(),
        package: z.string().optional().describe("Java package; com.<author or example>.<modId> when left out"),
        engines: z.array(z.string()).optional().describe("Engine ids the project targets; all when left out"),
        template: z.enum(PROJECT_TEMPLATES).default("empty"),
        folder: z.string().optional(),
        author: z.string().optional(),
      },
    },
    (input) => guard(() => {
      const dir = createProject({ ...input, package: input.package ?? suggestPackage(input.modId, input.author) });
      const project = loadProject(dir);
      return json({ dir, mod: project.mod, elements: Object.fromEntries(Object.entries(project.elements).map(([t, list]) => [t, list.map((e) => e.id)])) });
    }),
  );
  server.registerTool(
    "import_workspace_zip",
    {
      description: "File > Import project from ZIP (KUYRUK 135): extract a workspace export (File > Export workspace / export_workspace) into a new folder under parent, "
        + "named like the project folder in the zip. An existing folder is never replaced. This server stays on its own project.",
      inputSchema: { zip: z.string().describe("Absolute path of the .zip"), parent: z.string().describe("Absolute folder the project folder is made in") },
    },
    ({ zip, parent }) => guard(() => {
      if (!isAbsolute(zip) || !isAbsolute(parent)) throw new Error("zip and parent must be absolute paths");
      const dir = importWorkspace(zip, parent);
      return json({ dir, mod: loadProject(dir).mod });
    }),
  );
}
