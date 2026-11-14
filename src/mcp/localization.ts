import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { typeRegistry } from "../elements/registry.ts";
import { listEngines } from "../engines/registry.ts";
import { generatedLangKeys } from "../generator/langKeys.ts";
import { LANGUAGE_CODE, MINECRAFT_LANGUAGES } from "../ir/languages.ts";
import {
  addLanguage, BASE_LANGUAGE, elementNameKeys, hasPlaceholderIssue, keyMatches, keySearch, removeLanguage, renameLanguage, translationTable,
  type KeyFilter,
} from "../ir/localization.ts";
import {
  applyImport, csvTranslations, exportCsv, exportLangJson, jsonTranslations, languageOfFile, planImport, type Incoming,
} from "../ir/localizationIO.ts";
import { loadProject, saveLocalization } from "../ir/storage.ts";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
type Guard = (fn: () => Promise<Text> | Text) => Promise<Text>;
const json = (value: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

const FILTER = z.string().regex(/^(all|missingAny|sourceEmpty|placeholder|edited|elements|missing:[a-z]{2,3}_[a-z]{2,3})$/);

/** The Localization screen's key list for agents: the same table, filters and checks (src/ir/localization.ts). */
export function registerLocalizationTools(server: McpServer, root: string, guard: Guard): void {
  /** Keys elements create: names, and what the generator of the engine (default: the app's first) writes (KUYRUK 117). */
  const elementKeys = (project: ReturnType<typeof loadProject>, engineId?: string) => {
    const registry = typeRegistry();
    const engine = engineId ? listEngines().find((e) => e.id === engineId) : listEngines()[0];
    if (!engine) throw new Error(`unknown engine ${engineId}`);
    return { ...elementNameKeys(project, (id) => registry.byId.get(id)), ...generatedLangKeys(project, root, engine) };
  };
  const table = (engineId?: string) => {
    const project = loadProject(root);
    return translationTable(project.localization, elementKeys(project, engineId));
  };
  const code = z.string().regex(LANGUAGE_CODE);
  const languages = () => {
    const t = table();
    return t.languages.map((l) => ({
      code: l, name: MINECRAFT_LANGUAGES[l] ?? null, texts: t.keys.filter((k) => t.shown(l, k)).length, keys: t.keys.length,
    }));
  };

  server.registerTool(
    "list_languages",
    {
      description: "The project's languages (en_us first) with their name, how many keys have text and the key count; "
        + "`available: true` adds Minecraft's language codes and names the project does not have yet.",
      inputSchema: { available: z.boolean().optional() },
    },
    ({ available }) => guard(() => {
      const have = languages();
      return json({
        languages: have,
        ...(available ? { available: Object.entries(MINECRAFT_LANGUAGES).filter(([c]) => !have.some((l) => l.code === c)).map(([c, name]) => ({ code: c, name })) } : {}),
      });
    }),
  );
  server.registerTool(
    "add_language",
    {
      description: "Add a language (Localization > Language > Add). copyFrom starts it with another language's texts "
        + "(from en_us that includes the element names); without it the language starts empty.",
      inputSchema: { code, copyFrom: code.optional() },
    },
    ({ code: lang, copyFrom }) => guard(() => {
      const project = loadProject(root);
      saveLocalization(root, addLanguage(project.localization, lang, copyFrom, elementKeys(project)));
      return json(languages());
    }),
  );
  server.registerTool(
    "rename_language",
    { description: "Move a language's texts to another code (the file is renamed). en_us cannot be renamed.", inputSchema: { from: code, to: code } },
    ({ from, to }) => guard(() => {
      saveLocalization(root, renameLanguage(loadProject(root).localization, from, to), [from]);
      return json(languages());
    }),
  );
  server.registerTool(
    "remove_language",
    { description: "Remove a language and its file with all its texts (the app asks first). en_us cannot be removed.", inputSchema: { code } },
    ({ code: lang }) => guard(() => {
      saveLocalization(root, removeLanguage(loadProject(root).localization, lang), [lang]);
      return json(languages());
    }),
  );

  server.registerTool(
    "list_translation_keys",
    {
      description: "Lang keys as the Localization screen lists them: typed translations plus the name keys elements create "
        + "(en_us falls back to the element's name). filter: all, missing:<lang> (no text in that language), missingAny, "
        + "sourceEmpty (no en_us text), placeholder (a translation's %s/%d differ from en_us), edited (text typed in the "
        + "project), elements (keys elements create). query matches keys and texts; prefix keeps keys starting with it. "
        + "Each key lists its texts per language, the element it comes from, the languages it is missing in and those "
        + "with a placeholder mismatch. Element keys include everything the generator writes (GUI labels, tooltips, "
        + "advancement texts...) for `engine` (default: the first engine).",
      inputSchema: {
        filter: FILTER.optional(), query: z.string().optional(), prefix: z.string().optional(),
        limit: z.number().int().positive().max(5000).optional(), offset: z.number().int().min(0).optional(), engine: z.string().optional(),
      },
    },
    ({ filter, query, prefix, limit, offset, engine }) => guard(() => {
      const t = table(engine);
      const matching = t.keys.filter((key) => (!prefix || key.startsWith(prefix)) && keySearch(t, key, query ?? "")
        && keyMatches(t, key, (filter ?? "all") as KeyFilter));
      const start = offset ?? 0;
      const page = matching.slice(start, start + (limit ?? 200));
      return json({
        languages: t.languages,
        total: t.keys.length,
        matching: matching.length,
        offset: start,
        keys: page.map((key) => {
          const element = t.element(key);
          return {
            key,
            ...(element ? { element: { type: element.typeId, id: element.id } } : {}),
            texts: Object.fromEntries(t.languages.map((l) => [l, t.shown(l, key)])),
            ...(element && !t.text(BASE_LANGUAGE, key) ? { inheritedSource: true } : {}),
            missing: t.languages.filter((l) => !t.shown(l, key)),
            placeholderMismatch: t.languages.filter((l) => l !== BASE_LANGUAGE && hasPlaceholderIssue(t, key, l)),
          };
        }),
      });
    }),
  );

  server.registerTool(
    "export_translations",
    {
      description: "Localization > Export: write translations to an absolute file path outside the project. format csv: "
        + "one row per key, one column per language (UTF-8 with BOM, CRLF), en_us includes element names; format json: one "
        + "language as a Minecraft lang file. languages (csv) defaults to all; filter and query pick rows like list_translation_keys.",
      inputSchema: {
        path: z.string(), format: z.enum(["csv", "json"]), languages: z.array(code).optional(), language: code.optional(),
        filter: FILTER.optional(), query: z.string().optional(),
      },
    },
    ({ path, format, languages: chosen, language, filter, query }) => guard(() => {
      if (!isAbsolute(path)) throw new Error("path must be absolute");
      const t = table();
      const keys = t.keys.filter((key) => keySearch(t, key, query ?? "") && keyMatches(t, key, (filter ?? "all") as KeyFilter));
      const unknown = [...(chosen ?? []), ...(language ? [language] : [])].filter((l) => !t.languages.includes(l));
      if (unknown.length) throw new Error(`the project has no ${unknown.join(", ")}`);
      if (format === "json" && !language) throw new Error("format json needs language");
      writeFileSync(path, format === "csv" ? exportCsv(t, keys, chosen ?? t.languages) : exportLangJson(t, keys, language!));
      return json({ path, keys: keys.length });
    }),
  );
  server.registerTool(
    "import_translations",
    {
      description: "Localization > Import: read a CSV (header key,en_us,tr_tr,...) or a Minecraft lang JSON file (language "
        + "from `language` or the file name) and report per language what is added, changed and unchanged, plus keys the "
        + "project does not have. Nothing is written unless apply is true; unknown keys are added only with addUnknown. "
        + "Empty cells never clear a text.",
      inputSchema: { path: z.string(), language: code.optional(), apply: z.boolean().optional(), addUnknown: z.boolean().optional() },
    },
    ({ path, language, apply, addUnknown }) => guard(() => {
      const text = readFileSync(path, "utf8");
      let incoming: Incoming;
      if (/\.json$/i.test(path)) {
        const lang = language ?? languageOfFile(path);
        if (!lang) throw new Error("give language: the file name is not a language code");
        incoming = jsonTranslations(text, lang);
      } else incoming = csvTranslations(text);
      const project = loadProject(root);
      const t = translationTable(project.localization, elementKeys(project));
      const plan = planImport(t, incoming);
      if (apply) {
        const next = applyImport(project.localization, t, incoming, addUnknown ?? false);
        saveLocalization(root, next);
      }
      return json({ applied: apply ?? false, languages: plan.languages, unknownKeys: plan.unknownKeys, changes: plan.changes.slice(0, 100), totalChanges: plan.changes.length });
    }),
  );
}
