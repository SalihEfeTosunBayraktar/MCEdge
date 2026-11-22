import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Scenario, ScenarioStep } from "../build/scenario.ts";
import EN from "../../config/ui-strings/en.json" with { type: "json" };
import { ROOT } from "../paths.ts";
import { applyBatch, fillPairs, replaceText, templateToOps, type BatchOp, type BatchResult, type ElementTemplate } from "./batch.ts";

/**
 * Template gallery of verified starters (Q252): a starter is a small set of elements with its textures (a sword, an
 * ore, a mob, a machine with a GUI...) that opens as a new project or is added to the open one. The files live in
 * config/starters/: gallery.json lists them and records, per engine, whether the starter built and passed the
 * dedicated-server smoke test (tools/starters/verify.ts); only a starter that passed on every target is listed.
 */
const FOLDER = join(ROOT, "config", "starters");

/** What tools/starters/verify.ts recorded for one engine. */
export interface StarterCheck {
  build: "pass" | "fail";
  server: "pass" | "fail";
  /** ISO date of the check. */
  date: string;
  /** Why it failed, when it did. */
  note?: string;
}

interface GalleryFile {
  targets: string[];
  starters: { id: string; type: string; verified: Record<string, StarterCheck> }[];
}

/** A starter's own file: an element template, its textures (files of its folder -> project textures/), its smoke scenario. */
export interface StarterFile extends Pick<ElementTemplate, "params" | "elements"> {
  id: string;
  textures: { from: string; to: string }[];
  /** Steps of the smoke test; {{mod}} is the mod id, the other placeholders the starter's parameters. */
  scenario: ScenarioStep[];
}

export interface StarterInfo {
  id: string;
  /** English name and description (strings starter.<id>.name and .desc of config/ui-strings). */
  name: string;
  description: string;
  /** Element type whose sprite the card shows. */
  type: string;
  /** Parameter -> its example value. */
  params: Record<string, string>;
  /** "type/id" of the elements it makes, with the example values. */
  elements: string[];
  verified: Record<string, StarterCheck>;
  /** Every target built and passed the smoke test. */
  listed: boolean;
}

const text = (key: string) => (EN as Record<string, string>)[key] ?? key;
const PARAM = /^[a-z][a-z0-9_]{0,40}$/;

const gallery = (): GalleryFile => JSON.parse(readFileSync(join(FOLDER, "gallery.json"), "utf8")) as GalleryFile;

/** The engines every starter must pass on. */
export const starterTargets = (): string[] => gallery().targets;

export function loadStarter(id: string): StarterFile {
  if (!/^[a-z][a-z0-9_]*$/.test(id) || !gallery().starters.some((s) => s.id === id)) throw new Error(`no starter "${id}"; see list_starters`);
  return JSON.parse(readFileSync(join(FOLDER, id, "starter.json"), "utf8")) as StarterFile;
}

/** The starters; with `all` also those that have not passed on every target yet. */
export function listStarters(all = false): StarterInfo[] {
  const { targets, starters } = gallery();
  return starters.map((entry) => {
    const file = loadStarter(entry.id);
    const listed = targets.every((t) => entry.verified[t]?.build === "pass" && entry.verified[t]?.server === "pass");
    return { id: entry.id, name: text(`starter.${entry.id}.name`), description: text(`starter.${entry.id}.desc`), type: entry.type, params: file.params, elements: file.elements.map((e) => `${e.type}/${replaceText(e.id, fillPairs(file.params))}`), verified: entry.verified, listed };
  }).filter((s) => all || s.listed);
}

/** The parameters of a starter, checked: every one given, each a lower_snake_case word. */
function filled(starter: StarterFile, params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(starter.params)) {
    const value = (params[key] ?? "").trim();
    if (!PARAM.test(value)) throw new Error(`parameter ${key}: "${value}" must be lowercase letters, digits and _, starting with a letter`);
    out[key] = value;
  }
  return out;
}

/** Create ops of a starter with its parameters filled in (what the batch applies). */
export function starterOps(id: string, params: Record<string, string>, folder?: string): BatchOp[] {
  const starter = loadStarter(id);
  return templateToOps(starter, filled(starter, params), folder);
}

/** The textures a starter adds, as project paths (textures/ruby_sword.png). */
export function starterTextures(id: string, params: Record<string, string>): { from: string; to: string }[] {
  const starter = loadStarter(id);
  const pairs = fillPairs(filled(starter, params));
  return starter.textures.map((t) => ({ from: join(FOLDER, id, t.from), to: `textures/${replaceText(t.to, pairs)}` }));
}

/** The smoke scenario of a starter for a project with this mod id. */
export function starterScenario(id: string, params: Record<string, string>, modId: string): Scenario {
  const starter = loadStarter(id);
  const pairs = fillPairs({ ...filled(starter, params), mod: modId });
  return { name: `starter ${id}`, steps: replaceText(starter.scenario, pairs) };
}

/**
 * Adds a starter to a project as one atomic batch (checked like batch_elements). Its textures go in first, because the
 * check wants them there, and are taken out again when the batch is not applied (or is a dry run). A texture file that
 * already exists is never replaced: the batch is refused instead.
 */
export function applyStarter(dir: string, id: string, params: Record<string, string>, options: { folder?: string; dryRun?: boolean; allowProblems?: boolean } = {}): BatchResult & { textures: string[] } {
  const textures = starterTextures(id, params);
  const taken = textures.filter((t) => existsSync(join(dir, t.to)));
  if (taken.length) throw new Error(`the project already has ${taken.map((t) => t.to).join(", ")}; pick another name`);
  mkdirSync(join(dir, "textures"), { recursive: true });
  for (const t of textures) copyFileSync(t.from, join(dir, t.to));
  let result: BatchResult | undefined;
  try {
    result = applyBatch(dir, starterOps(id, params, options.folder), { dryRun: options.dryRun, allowProblems: options.allowProblems });
  } finally {
    if (!result?.applied) for (const t of textures) rmSync(join(dir, t.to), { force: true });
  }
  return { ...result, textures: result.applied ? textures.map((t) => t.to) : [] };
}
