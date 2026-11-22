import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { displayNameField, nameLangKey, typeFields, type Element } from "../elements/model.ts";
import { typeRegistry } from "../elements/registry.ts";
import { loadIntegrations } from "../elements/integrations.ts";
import { recipeViewerOutputs } from "./integrations/recipeViewer.ts";
import { resolveTabOrder, tabSlots, type TabMember } from "../elements/tabOrder.ts";
import { engineCoverage, LAYER_MANIFEST, unsupportedReason } from "../engines/coverage.ts";
import { dependencyGradle } from "../build/modDependencies.ts";
import { layerDirs, type Engine } from "../engines/registry.ts";
import type { Dependency, ModProject } from "../ir/types.ts";
import { commonTag } from "./commonTags.ts";
import { copyDatapack, ownTags } from "./datapack.ts";
import { list, pascal, tagFolder } from "./java.ts";
import { procedureBuild } from "./procedures.ts";
import { javaModelOutputs } from "./javaModels.ts";
import { projectModelOutputs, type ModelOutputs } from "./models.ts";
import { itemPropertyOutputs } from "./states.ts";
import { projectSounds } from "./sounds.ts";
import { bubbleDataPath, bubbleOutputs } from "./bubbles.ts";
import { radialDataPath, radialOutputs } from "./radial.ts";
import { seatOutputs } from "./seats.ts";
import { readPng, remapTexture, writePng, type Rgba } from "./png.ts";
import { vanillaMcmeta } from "../resources/textureAnimation.ts";
import { applyImageFilter } from "../resources/imageFilter.ts";
import { spriteAnimationOutputs } from "./textureAnimations.ts";
import { render, type Context } from "./render.ts";
import { writeSourceMap } from "./sourceMap.ts";
import { applyLockedCode } from "./lockedCode.ts";
import { projectTags } from "./tags.ts";
import { probeOutputs } from "./probe.ts";
import { TYPE_MODULES, type ElementContext, type GenEnv, type JavaSourceFile, type ProbeOptions, type ResourceFile } from "./typeModule.ts";

/**
 * A path segment "[name]" repeats a template file once per entry of a context list: the elements of the type
 * with that id (context key = the type's folder) or the context list called `name`. "[name.key]" names the file
 * after the entry's `key` instead of its id; "[name+flag]" / "[name!flag]" keep only entries whose `flag` is
 * truthy / falsy ("?" is not allowed in Windows file names).
 */
const PER_ENTRY = /\[(\w+)(?:\.(\w+))?(?:([+!])(\w+))?\]/;

/** Language that always exists; element names fill it when no translation overrides them. */
const BASE_LANGUAGE = "en_us";
/** File name of the mod logo at the root of the generated resources. */
const LOGO_FILE = "logo.png";

export interface GenerateResult {
  /** Elements left out because the engine does not generate them (yet). */
  skipped: { typeId: string; id: string; reason: string }[];
  /** Parts of generated elements the engine leaves out (procedure blocks and triggers it does not generate). */
  warnings: string[];
}

/** `lockedCode: false` leaves out the locked files of elements (KUYRUK 131); lockedCode.ts uses it to see fresh output. */
export function generateTarget(project: ModProject, projectDir: string, engine: Engine, outDir: string, options: { lockedCode?: boolean; probe?: ProbeOptions } = {}): GenerateResult {
  // Only generated sources are replaced; run/ (test worlds, options) and Gradle caches survive regeneration.
  rmSync(join(outDir, "src"), { recursive: true, force: true });
  const { generated, skipped } = generatedElements(project, engine);
  const env = genEnv(project, projectDir, engine, generated, options.probe);
  const { context, elementContexts, models } = buildContext(env);

  for (const layerDir of layerDirs(engine)) {
    for (const file of walk(layerDir)) {
      const path = relative(layerDir, file).replaceAll("\\", "/");
      if (path === LAYER_MANIFEST) continue;
      emitTemplate(path, readFileSync(file, "utf8"), context, outDir);
    }
  }
  copyTextures(project, elementContexts, projectDir, outDir);
  // Textures of project block/item models.
  const modelTextures = join(outDir, "src/main/resources/assets", project.mod.id, "textures");
  for (const { from, to } of models.textures) {
    mkdirSync(dirname(join(modelTextures, `${to}.png`)), { recursive: true });
    copyTexture(resolve(projectDir, from), join(modelTextures, `${to}.png`));
  }
  for (const { to, bytes } of models.images) {
    mkdirSync(dirname(join(modelTextures, `${to}.png`)), { recursive: true });
    writeFileSync(join(modelTextures, `${to}.png`), bytes);
  }
  for (const ctx of Object.values(elementContexts).flat()) {
    for (const { from, to } of ctx.copies ?? []) {
      const target = join(outDir, "src/main/resources", to);
      mkdirSync(dirname(target), { recursive: true });
      copyTexture(resolve(projectDir, from), target);
    }
  }
  // Status bubbles (Q206, Q216): their images and bubbles.json, the data one renderer draws every bubble from.
  const bubbles = bubbleOutputs(env, procedureBuild(env).bubbles);
  // Radial menus (Q227): their images and radial_menus.json, the data one runtime opens and draws every menu from.
  const radial = radialOutputs(env);
  for (const [outputs, dataPath] of [[bubbles, bubbleDataPath(project.mod.id)], [radial, radialDataPath(project.mod.id)]] as const) {
    for (const { to, bytes } of outputs.images) {
      mkdirSync(dirname(join(modelTextures, `${to}.png`)), { recursive: true });
      writeFileSync(join(modelTextures, `${to}.png`), bytes);
    }
    if (outputs.json) {
      const data = join(outDir, "src/main/resources", dataPath);
      mkdirSync(dirname(data), { recursive: true });
      writeFileSync(data, outputs.json);
    }
  }
  for (const { from, to } of projectSounds(env).copies) {
    const target = join(outDir, "src/main/resources", to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(projectDir, from), target);
  }
  // Project structure templates ship with the mod whether or not a structure element uses them: procedures read them by id (Q265).
  const structures = join(projectDir, "structures");
  for (const name of existsSync(structures) ? readdirSync(structures).filter((n) => n.endsWith(".nbt")) : []) {
    const target = join(outDir, "src/main/resources/data", project.mod.id, env.mc === "1.16.5" ? "structures" : "structure", name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(structures, name), target);
  }
  if (project.mod.logo) copyFileSync(resolve(projectDir, project.mod.logo), join(outDir, "src/main/resources", LOGO_FILE));
  copyDatapack(env, join(outDir, "src/main/resources/data"));
  // Locked elements keep the files the user edited instead of fresh ones (KUYRUK 131).
  const locked = options.lockedCode === false ? [] : applyLockedCode(projectDir, generated, engine, outDir);
  writeSourceMap(env, outDir, locked);
  const unresolved = dependencyGradle(project.mod.dependencies, engine).unresolved.filter((r) => r.required)
    .map((r) => `required mod ${r.modId} has no jar for dev runs on ${engine.id} (${r.message ?? r.status}); resolve_dependencies downloads it`);
  return { skipped, warnings: [...procedureBuild(env).warnings, ...bubbles.problems, ...radial.problems, ...projectTags(env).skipped, ...unresolved] };
}

export function genEnv(project: ModProject, projectDir: string, engine: Engine, generated: Record<string, Element[]>, probe?: ProbeOptions): GenEnv {
  const mc = engine.minecraft === "1.16.5" ? "1.16.5" : engine.minecraft.startsWith("1.21") ? "1.21.5" : "26.3";
  return { engine, project, projectDir, modId: project.mod.id, mc, loader: engine.loader as GenEnv["loader"], generated, ownTags: ownTags(projectDir), ...(probe ? { probe } : {}) };
}

/** Elements this engine generates, by type id; the rest are reported instead of producing broken code. */
export function generatedElements(project: ModProject, engine: Engine) {
  const registry = typeRegistry();
  const coverage = engineCoverage(engine);
  const generated: Record<string, Element[]> = {};
  const skipped: GenerateResult["skipped"] = [];
  for (const [typeId, elements] of Object.entries(project.elements)) {
    const type = registry.byId.get(typeId);
    for (const element of elements) {
      const reason = !type ? `unknown element type "${typeId}"`
        : !TYPE_MODULES.has(typeId) ? `${type.name} elements are not generated yet`
          : unsupportedReason(type, element, coverage);
      if (reason) skipped.push({ typeId, id: element.id, reason });
      else (generated[typeId] ??= []).push(element);
    }
  }
  return { generated, skipped };
}

function emitTemplate(path: string, template: string, context: Context, outDir: string): void {
  const marker = PER_ENTRY.exec(path);
  let contexts = [context];
  if (marker) {
    const [, name, nameKey = "id", sign, flag] = marker;
    const folder = typeRegistry().byId.get(name)?.folder;
    const entries = (context[folder ?? name] ?? []) as Context[];
    if (!Array.isArray(entries)) throw new Error(`template ${path}: "${name}" is not a list`);
    contexts = entries
      .filter((entry) => !flag || Boolean(entry[flag]) === (sign === "+"))
      .map((entry) => ({ ...context, ...entry, "@file": String(entry[nameKey]) }));
  }
  for (const ctx of contexts) {
    const target = join(outDir, render(marker ? path.replace(marker[0], String(ctx["@file"])) : path, ctx));
    mkdirSync(dirname(target), { recursive: true });
    try { writeFileSync(target, render(template, ctx)); } catch (e) { throw new Error(`${path}: ${(e as Error).message}`); }
  }
}

function buildContext(env: GenEnv): { context: Context; elementContexts: Record<string, ElementContext[]>; models: ModelOutputs } {
  const { project, engine } = env;
  const { mod } = project;
  const registry = typeRegistry();
  // Optional mod integrations the project uses and this engine has (KUYRUK 101): the other mod as a dependency, its
  // Gradle lines and repositories, and the integration's code.
  const integrations = (mod.integrations ?? []).flatMap((use) => {
    const def = loadIntegrations().integrations.find((i) => i.id === use.id);
    const on = def?.engines[engine.id];
    return def && on ? [{ use, def, on }] : [];
  });
  // A dependency's jar for this engine may carry another mod id ("geckolib3" on Forge 1.16.5): the metadata asks for that.
  const modJars = dependencyGradle(mod.dependencies, engine);
  const dependencies = [
    ...mod.dependencies.map((d) => ({ ...d, modId: modJars.modIds[d.modId] ?? d.modId })),
    ...integrations.filter((i) => !mod.dependencies.some((d) => d.modId === i.on.modId))
      .map((i) => ({ modId: i.on.modId, version: i.on.version, required: i.use.required, side: "both" as const })),
  ].map(toDependencyContext);
  const integrationCode = integrations.map((i) => (INTEGRATION_CODE[i.def.id] ?? (() => ({ sources: [], entrypoints: [] })))(env));

  const elementContexts: Record<string, ElementContext[]> = {};
  const perType: Context = {};
  const resourceFiles: ResourceFile[] = [];
  const javaSources: JavaSourceFile[] = [];
  const runtimeInit: string[] = [];
  const clientInit: string[] = [];
  // Types rendered as another type join that type's elements.
  const byType: Record<string, Element[]> = {};
  for (const [typeId, elements] of Object.entries(env.generated)) {
    const as = TYPE_MODULES.get(typeId)!.renderAs;
    if (as) (byType[as.type] ??= []).push(...elements.map((element) => as.element(element, env)));
    else (byType[typeId] ??= []).push(...elements);
  }
  // A command's argument program is a procedure unit: the procedure runtime writes its class even when the project
  // has no procedure elements.
  if (byType.command?.length) byType.procedure ??= [];
  // Radial menus (Q227) run on the procedure runtime (packets, bubbles) even in a mod without procedures.
  if (byType.radial_menu?.length) byType.procedure ??= [];
  for (const [typeId, elements] of Object.entries(byType)) {
    const module = TYPE_MODULES.get(typeId)!;
    const contexts = elements.map((element) => ({
      ...element,
      constant: element.id.toUpperCase(),
      className: pascal(element.id) + pascal(typeId),
      ...module.element(element, env),
    }));
    elementContexts[typeId] = contexts;
    perType[registry.byId.get(typeId)!.folder] = contexts;
    Object.assign(perType, module.global?.(contexts, env));
    resourceFiles.push(...contexts.flatMap((ctx) => ctx.files ?? []), ...(module.files?.(contexts, env) ?? []));
    const runtime = module.runtime?.(contexts, env);
    javaSources.push(...(runtime?.sources ?? []));
    runtimeInit.push(...(runtime?.init ?? []));
    clientInit.push(...(runtime?.clientInit ?? []));
  }
  // Project sounds (sounds/*.ogg): copied, listed in sounds.json and registered.
  const sounds = projectSounds(env);
  resourceFiles.push(...sounds.files);
  javaSources.push(...sounds.sources);
  runtimeInit.push(...sounds.init);
  // Seatable blocks (Q225): seats.json and one shared seat runtime reading it.
  const seats = seatOutputs(env);
  resourceFiles.push(...seats.files);
  javaSources.push(...seats.sources);
  runtimeInit.push(...seats.init);
  clientInit.push(...seats.clientInit);
  // Project block/item models the elements use (models/*.json, .obj): written once.
  const models = projectModelOutputs(env);
  resourceFiles.push(...models.files);
  javaSources.push(...models.sources);
  clientInit.push(...models.clientInit);
  // Block entity and item renderers of Java models.
  const javaModels = javaModelOutputs(env);
  javaSources.push(...javaModels.sources);
  clientInit.push(...javaModels.clientInit);
  // Item properties computed by procedures (item states, 1.21.5+).
  const itemProperties = itemPropertyOutputs(env);
  javaSources.push(...itemProperties.sources);
  clientInit.push(...itemProperties.clientInit);
  javaSources.push(...integrationCode.flatMap((c) => c.sources));
  // Block and item textures that play once start again at world join (Q229).
  const sprites = spriteAnimationOutputs(env);
  javaSources.push(...sprites.sources);
  clientInit.push(...sprites.clientInit);
  // The test probe of dev builds (Q218, Q219).
  const probe = probeOutputs(env);
  javaSources.push(...probe.sources);
  runtimeInit.push(...probe.init);
  const allMixins = [...Object.values(elementContexts).flat().flatMap((ctx) => ctx.mixins ?? []), ...javaModels.mixins, ...itemProperties.mixins, ...seats.mixins, ...procedureBuild(env).mixins];
  // Every type's list exists so templates can loop over types the project does not use.
  for (const type of registry.types) perType[type.folder] ??= [];

  const clientCode = (kind: "colors" | "itemColors" | "setup") =>
    Object.values(elementContexts).flat().flatMap((ctx) => ctx.client?.[kind] ?? []).map((code) => ({ code }));
  const tabMembers = Object.entries(elementContexts).flatMap(([type, contexts]) => contexts.flatMap((ctx) =>
    list<string>(ctx.tabItems).map((ref) => ({ ref, type, id: ctx.id as string, tabs: list<string>(ctx.creativeTabs) }))));
  /**
   * A mod tab's items in its order (KUYRUK 98): `entries` for 1.20+ display lists, `slots` for 1.16.5 with the empty
   * slots of its sections and spacers.
   */
  const tabContents = (tab: ElementContext) => {
    const inTab = tabMembers.filter((m) => m.tabs.includes(tab.id as string));
    const members: TabMember[] = [...new Map(inTab.map((m) => [`${m.type}/${m.id}`, { type: m.type, id: m.id }])).values()];
    const refsOf = (m: TabMember) => inTab.filter((x) => x.type === m.type && x.id === m.id).map((x) => x.ref);
    const order = resolveTabOrder(tab.order, members);
    return {
      entries: order.flatMap((e) => (e.kind === "element" ? refsOf(e) : [])).map((ref) => ({ ref })),
      slots: tabSlots(order, refsOf).map((ref) => ({ stack: ref === null ? "ItemStack.EMPTY" : `new ItemStack(${ref})` })),
    };
  };
  const vanillaTab = (tab: string) => engine.creativeTabs[tab];

  return {
    elementContexts,
    models,
    context: {
      mod,
      // JSON string literals double as TOML basic strings for the metadata files.
      nameJson: JSON.stringify(mod.name),
      descriptionJson: JSON.stringify(mod.description),
      websiteJson: JSON.stringify(mod.website),
      creditsJson: JSON.stringify(mod.credits),
      licenseJson: JSON.stringify(mod.license),
      logoFile: mod.logo ? LOGO_FILE : "",
      // NeoForge 26.x warns on logoFile at every start; a wide logo is its banner.
      logoKey: env.mc === "26.3" ? "bannerFile" : "logoFile",
      dependencies,
      // Other mods the project depends on, from the local cache of resolved jars, so dev runs load them (KUYRUK 152).
      integrationRepositories: [...new Set([...integrations.flatMap((i) => i.on.repositories), ...modJars.repositories])].map((url) => ({ url })),
      integrationGradle: [...integrations.flatMap((i) => i.on.gradle), ...modJars.lines].map((line) => ({ line })),
      extraEntrypoints: integrationCode.flatMap((c) => c.entrypoints),
      requiredDependencies: dependencies.filter((d) => d.required),
      optionalDependencies: dependencies.filter((d) => !d.required),
      languages: buildLanguages(project, env.generated, elementContexts),
      modClass: pascal(mod.id) + "Mod",
      packagePath: mod.package.replaceAll(".", "/"),
      authorsJson: JSON.stringify(mod.authors),
      authorsJoinedJson: JSON.stringify(mod.authors.join(", ")),
      minecraft: engine.minecraft,
      java: engine.java,
      versions: engine.versions,
      api: withSimpleNames(engine.api),
      ...perType,
      tagFiles: buildTags(env, elementContexts),
      clientColors: clientCode("colors"),
      clientItemColors: clientCode("itemColors"),
      clientSetup: clientCode("setup"),
      mixins: [...new Map(allMixins.map((m) => [m.id, m])).values()],
      commonMixins: [...new Set(allMixins.filter((m) => !m.client).map((m) => m.id))].map((id) => ({ id })),
      clientMixins: [...new Set(allMixins.filter((m) => m.client).map((m) => m.id))].map((id) => ({ id })),
      commonInit: [...Object.values(elementContexts).flat().flatMap((ctx) => ctx.init ?? []), ...runtimeInit].map((code) => ({ code })),
      clientInit: clientInit.map((code) => ({ code })),
      javaSources: [...new Map(javaSources.map((file) => [file.path, { ...file, id: file.path }])).values()],
      resourceFiles: resourceFiles.map((file) => ({ ...file, id: file.path })),
      tabs: list<ElementContext>(perType.creative_tabs).map((tab) => ({ ...tab, ...tabContents(tab) })),
      vanillaTabs: [...new Set(Object.values(engine.creativeTabs))]
        .map((tab) => ({ tab, entries: tabMembers.filter((m) => m.tabs.some((t) => vanillaTab(t) === tab)).map((m) => ({ ref: m.ref })) }))
        .filter((group) => group.entries.length > 0),
    },
  };
}

/** Tag files: every element's tag memberships, grouped by registry and tag id. */
function buildTags(env: GenEnv, elementContexts: Record<string, ElementContext[]>): Context[] {
  const files = new Map<string, Set<string>>();
  // The elements' own tag memberships, then the project's element tags (Element tags section, ./tags.ts).
  for (const ctx of [...Object.values(elementContexts).flat(), { tags: projectTags(env).tags }]) {
    for (const entry of ctx.tags ?? []) {
      // Forge tags follow the engine here as in procedures and item fields ("forge:ores" is "c:ores" from 1.21).
      const [ns, path] = commonTag(env, entry.tag.replace(/^#/, "")).split(":");
      const file = `${ns}/tags/${tagFolder(env, entry.registry)}/${path}`;
      const values = files.get(file) ?? files.set(file, new Set()).get(file)!;
      // An empty value only makes sure the tag exists (a material can name a tag nothing is in yet).
      if (entry.value) values.add(entry.value.startsWith("#") ? `#${commonTag(env, entry.value.slice(1))}` : entry.value);
    }
  }
  return [...files].map(([path, values]) => ({
    id: path,
    path,
    json: JSON.stringify({ replace: false, values: [...values] }, null, 2),
  }));
}

/** One entry per language: generated element names, overridden or extended by the project's translations. */
function buildLanguages(project: ModProject, generated: Record<string, Element[]>, elementContexts: Record<string, ElementContext[]>): Context[] {
  const { mod } = project;
  const registry = typeRegistry();
  const names: Record<string, string> = {};
  for (const [typeId, elements] of Object.entries(generated)) {
    const type = registry.byId.get(typeId);
    const field = displayNameField(type);
    for (const element of elements) {
      const key = nameLangKey(type, mod.id, element);
      if (key && field) names[key] = String(element[field.key]);
    }
  }
  for (const ctx of Object.values(elementContexts).flat()) Object.assign(names, ctx.lang);
  const languages = { [BASE_LANGUAGE]: {}, ...project.localization };
  return Object.entries(languages).map(([code, entries]) => {
    const merged = code === BASE_LANGUAGE ? { ...names, ...entries } : entries;
    return {
      id: code,
      entries: Object.entries(merged)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ keyJson: JSON.stringify(key), valueJson: JSON.stringify(value) })),
    };
  });
}

/** Translates the engine-neutral version syntax into Maven ranges (Forge/NeoForge) and semver (Fabric). */
/** Code of an integration (src/generator/integrations/), by integration id; one without code adds only the dependency. */
const INTEGRATION_CODE: Record<string, (env: GenEnv) => { sources: JavaSourceFile[]; entrypoints: { name: string; classes: string }[] }> = {
  recipe_viewer: recipeViewerOutputs,
};

function toDependencyContext(dep: Dependency): Context {
  const version = dep.version.trim();
  const minimum = version.startsWith(">=") ? version.slice(2).trim() : version.startsWith(">") ? version.slice(1).trim() : undefined;
  const mavenRange = version === "*" ? "[0,)" : minimum ? `[${minimum},)` : `[${version}]`;
  const fabricRange = version === "*" ? "*" : minimum ? `>=${minimum}` : version;
  return {
    ...dep,
    mavenRange,
    fabricRangeJson: JSON.stringify(fabricRange),
    sideUpper: dep.side.toUpperCase(),
    neoforgeType: dep.required ? "required" : "optional",
  };
}

/**
 * Textures of generated elements: the "texture" field goes to textures/<its textureKind>/<id>.png unless the
 * type module lists the element's textures itself.
 */
function copyTextures(project: ModProject, elementContexts: Record<string, ElementContext[]>, projectDir: string, outDir: string): void {
  const assets = join(outDir, "src/main/resources/assets", project.mod.id, "textures");
  const registry = typeRegistry();
  for (const [typeId, contexts] of Object.entries(elementContexts)) {
    const field = typeFields(registry.byId.get(typeId)!).find((f) => f.key === "texture" && f.type === "texture");
    for (const ctx of contexts) {
      const copies = ctx.textures ?? (field && typeof ctx.texture === "string" && ctx.texture
        ? [{ from: ctx.texture, to: `${field.textureKind ?? "other"}/${ctx.id}` }] : []);
      for (const { from, to, remap, half, below, filter } of copies) {
        const target = join(assets, `${to}.png`);
        mkdirSync(dirname(target), { recursive: true });
        const png = (path: string) => readPng(readFileSync(resolve(projectDir, path)));
        if (remap) writeFileSync(target, writePng(remapTexture(png(from), remap)));
        else if (half) writeFileSync(target, writePng(halfOf(png(from), half)));
        else if (below) writeFileSync(target, writePng(stacked(png(from), png(below))));
        else copyTexture(resolve(projectDir, from), target);
        // Q273: a GUI image's opacity and tint, on its visible pixels only.
        if (filter) {
          const image = readPng(readFileSync(target));
          applyImageFilter(image.data, filter);
          writeFileSync(target, writePng(image));
        }
      }
    }
  }
}

/** The top or bottom half of an image; an image one pixel high stays whole. */
function halfOf(image: Rgba, half: "top" | "bottom"): Rgba {
  const height = Math.max(1, Math.floor(image.height / 2));
  if (image.height < 2) return image;
  const row = image.width * 4;
  const start = half === "top" ? 0 : (image.height - height) * row;
  return { width: image.width, height, data: image.data.slice(start, start + height * row) };
}

/** `top` above `bottom` in one image twice its height; `bottom` is scaled (nearest neighbour) to the size of `top`. */
function stacked(top: Rgba, bottom: Rgba): Rgba {
  const { width, height } = top;
  const data = new Uint8Array(width * height * 8);
  data.set(top.data.subarray(0, width * height * 4));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (Math.floor((y * bottom.height) / height) * bottom.width + Math.floor((x * bottom.width) / width)) * 4;
      data.set(bottom.data.subarray(i, i + 4), ((height + y) * width + x) * 4);
    }
  }
  return { width, height: height * 2, data };
}

/**
 * Copies a file with the .mcmeta beside it, which is what makes a texture animated; a playback mode (Q229) becomes the
 * vanilla frame list that plays it, so the game needs no code of ours for it.
 */
function copyTexture(from: string, to: string): void {
  copyFileSync(from, to);
  if (!existsSync(`${from}.mcmeta`)) return;
  const text = readFileSync(`${from}.mcmeta`, "utf8");
  if (!text.includes('"mcedge"')) return copyFileSync(`${from}.mcmeta`, `${to}.mcmeta`);
  const png = readPng(readFileSync(from));
  writeFileSync(`${to}.mcmeta`, vanillaMcmeta(text, png.width, png.height));
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Adds "<key>Simple" (the unqualified class name) next to every API entry. */
function withSimpleNames(api: Record<string, string>): Record<string, string> {
  const simple = Object.entries(api).map(([key, value]) => [`${key}Simple`, value.slice(value.lastIndexOf(".") + 1)]);
  return { ...api, ...Object.fromEntries(simple) };
}
