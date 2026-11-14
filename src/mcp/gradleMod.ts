import { copyFileSync, mkdirSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildProject, type GradleSetup } from "../build/gradle.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/** Code project mode's Export jar for agents: build the Gradle mod with its wrapper and copy the jar. */
export function registerGradleModTools(server: McpServer, setupFor: () => Promise<GradleSetup>, guard: Guard): void {
  server.registerTool(
    "export_jar",
    {
      description: "Build the mod with its own Gradle wrapper and copy the jar into `folder` (absolute). Waits for the build.",
      inputSchema: { folder: z.string() },
    },
    ({ folder }) => guard(async () => {
      if (!isAbsolute(folder)) throw new Error("folder must be an absolute path");
      const lines: string[] = [];
      const result = await buildProject(await setupFor(), (line) => lines.push(line));
      if (!result.ok || !result.jar) return { ...json({ ok: false, log: result.logFile, errors: lines.filter((l) => /error:|FAILED|What went wrong/.test(l)).slice(0, 40) }), isError: true };
      mkdirSync(folder, { recursive: true });
      const jar = join(folder, basename(result.jar));
      copyFileSync(result.jar, jar);
      return json({ ok: true, jar });
    }),
  );
}
