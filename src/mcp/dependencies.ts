import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cachedModDependencies, resolveModDependencies, type DependencyResolution } from "../build/modDependencies.ts";
import { listEngines, type Engine } from "../engines/registry.ts";
import { loadProject } from "../ir/storage.ts";

/** Jars of the mods a project depends on, for dev runs (KUYRUK 152). */

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

const enginesOf = (ids?: string[]): Engine[] => {
  const all = listEngines();
  const unknown = (ids ?? []).filter((id) => !all.some((e) => e.id === id));
  if (unknown.length) throw new Error(`unknown engine ${unknown.join(", ")}; one of ${all.map((e) => e.id).join(", ")}`);
  return ids?.length ? all.filter((e) => ids.includes(e.id)) : all;
};
const shown = (r: DependencyResolution) => ({ ...r, jars: r.jars.map((j) => ({ ...j, size: `${Math.round(j.size / 1024)} KB` })) });

export function registerDependencyTools(server: McpServer, root: string, guard: Guard): void {
  server.registerTool(
    "resolve_dependencies",
    {
      description: "Download the jars of the mods the project depends on (get_mod dependencies) for dev runs: per engine, the newest Modrinth version for the engine's loader "
        + "and Minecraft version that meets the dependency's version (or its source.curseforge project, or its source.maven artifact; a mod Modrinth lacks is tried on "
        + "CurseForge when the computer has a CurseForge API key, which the user sets in the app's Preferences), plus the mods it requires. Jars are cached once per machine under "
        + "<toolchains>/mods; the generator adds them to runClient/runServer. Builds and runs do this by themselves; this tool shows the answer and can `refresh` "
        + "(look for newer versions). Each dependency: status resolved / unavailable (no version for that engine) / failed, with its jars.",
      inputSchema: { engines: z.array(z.string()).optional().describe("Engine ids; all when omitted"), refresh: z.boolean().default(false) },
    },
    ({ engines, refresh }) => guard(async () => {
      const deps = loadProject(root).mod.dependencies;
      const out: Record<string, unknown> = {};
      for (const engine of enginesOf(engines)) out[engine.id] = (await resolveModDependencies(deps, engine, { refresh })).map(shown);
      return json(out);
    }),
  );
  server.registerTool(
    "list_dependency_jars",
    {
      description: "The jars dev runs would load for the project's dependencies, per engine, from the local cache only (no network): status "
        + "(resolved, unavailable, failed, or unresolved when resolve_dependencies has not run), version, coordinates, file and the dependency it came through (via).",
      inputSchema: { engines: z.array(z.string()).optional() },
    },
    ({ engines }) => guard(() => {
      const deps = loadProject(root).mod.dependencies;
      return json(Object.fromEntries(enginesOf(engines).map((e) => [e.id, cachedModDependencies(deps, e).map(shown)])));
    }),
  );
}
