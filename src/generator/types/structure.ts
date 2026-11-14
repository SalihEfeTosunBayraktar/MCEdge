import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Element } from "../../elements/model.ts";
import { blockExpr, list, pascal, qualify, str } from "../java.ts";
import { registryClass } from "../registries.ts";
import type { ElementContext, GenEnv, JavaSourceFile, ResourceFile, TagEntry, TypeModule } from "../typeModule.ts";

/**
 * Structures. 1.21.5+: a jigsaw structure starting from a template pool with the template (and the extra jigsaw
 * pools), its structure set (random spread placement) and a has_structure biome tag. 1.16.5 has no data-driven
 * structures: the template is placed by a feature of this mod, about once per spacing x spacing chunks, in the chosen
 * biomes (jigsaw pools, size, terrain adaptation and projection are not generated there).
 *
 * Templates are ids: "minecraft:igloo/top" uses a vanilla template; "<modid>:<path>" copies the project's
 * structures/<path>.nbt into the mod.
 */

type Row = Record<string, unknown>;
type Json = Record<string, unknown>;

/** Template id; this mod's templates are copied from the project's structures folder. */
function template(env: GenEnv, ref: string, copies: { from: string; to: string }[]): string {
  const id = qualify(env, ref);
  const [ns, path] = id.split(":");
  const from = `structures/${path}.nbt`;
  if (ns === env.modId && existsSync(join(env.projectDir, from)) && !copies.some((c) => c.from === from)) {
    copies.push({ from, to: `data/${env.modId}/${env.mc === "1.16.5" ? "structures" : "structure"}/${path}.nbt` });
  }
  return id;
}

/** Stable positive salt from the structure id. */
function salt(id: string): number {
  let h = 0;
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 1000000000;
}

function element(structure: Element, env: GenEnv): ElementContext {
  const copies: { from: string; to: string }[] = [];
  const main = template(env, str(structure.structure), copies);
  const ignored = (rows: unknown) => list<Row>(rows).map((r) => str(r.block)).filter(Boolean).map((b) => qualify(env, b));
  const biomes = list<Row>(structure.restrictionBiomes).map((r) => str(r.biome)).filter(Boolean).map((b) => qualify(env, b));
  if (env.mc === "1.16.5") return { copies, templateId: main, ignoredBlocks: ignored(structure.ignoredBlocks), biomeRefs: biomes };

  const json = (v: unknown) => JSON.stringify(v, null, 2);
  const id = qualify(env, structure.id);
  const dir = `data/${env.modId}/worldgen`;
  const files: ResourceFile[] = [];
  const tags: TagEntry[] = [];
  const blockList = (blocks: string[]) => blocks.map((b) => (env.mc === "26.3" ? b : { Name: b }));
  const pool = (fallback: string, parts: { weight: number; location: string; projection: string; ignored: string[] }[]) => ({
    fallback,
    elements: parts.map((p) => ({
      weight: p.weight,
      element: {
        element_type: "minecraft:single_pool_element",
        location: p.location,
        projection: p.projection,
        processors: { processors: p.ignored.length ? [{ processor_type: "minecraft:block_ignore", blocks: blockList(p.ignored) }] : [] },
      },
    })),
  });
  files.push({ path: `${dir}/template_pool/${structure.id}.json`, json: json(pool("minecraft:empty", [{ weight: 1, location: main, projection: str(structure.projection), ignored: ignored(structure.ignoredBlocks) }])) });
  for (const p of list<Row>(structure.jigsawPools)) {
    const name = str(p.poolName);
    if (!name) continue;
    const fallback = str(p.fallbackPool) ? qualify(env, str(p.fallbackPool)) : "minecraft:empty";
    const parts = list<Row>(p.poolParts).filter((part) => str(part.structure)).map((part) => ({
      weight: Number(part.weight), location: template(env, str(part.structure), copies), projection: str(part.projection), ignored: ignored(part.ignoredBlocks),
    }));
    files.push({ path: `${dir}/template_pool/${structure.id}_${name}.json`, json: json(pool(fallback, parts)) });
  }

  // One biome tag of this mod lists the biomes (ids and tags alike).
  const biomeTag = `${env.modId}:has_structure/${structure.id}`;
  tags.push(...(biomes.length ? biomes : [""]).map((value) => ({ registry: "worldgen/biome", tag: biomeTag, value })));
  const terrain = str(structure.terrainAdaptation);
  const start: Json = structure.useStartHeight === true
    ? { type: `minecraft:${str(structure.startHeightProviderType).toLowerCase()}`, min_inclusive: { absolute: Number(structure.startHeightMin) }, max_inclusive: { absolute: Number(structure.startHeightMax) } }
    : { absolute: 0 };
  files.push({ path: `${dir}/structure/${structure.id}.json`, json: json({
    type: "minecraft:jigsaw",
    biomes: `#${biomeTag}`,
    step: str(structure.generationStep).toLowerCase(),
    terrain_adaptation: terrain,
    spawn_overrides: {},
    start_pool: id,
    size: Number(structure.size),
    start_height: start,
    ...(structure.useStartHeight === true ? {} : { project_start_to_heightmap: str(structure.surfaceDetectionType) }),
    // Terrain adaptation only reaches 116 blocks from the start.
    max_distance_from_center: terrain !== "none" ? Math.min(Number(structure.maxDistanceFromCenter), 116) : Number(structure.maxDistanceFromCenter),
    use_expansion_hack: false,
  }) });
  files.push({ path: `${dir}/structure_set/${structure.id}.json`, json: json({
    structures: [{ structure: id, weight: 1 }],
    placement: { type: "minecraft:random_spread", spacing: Number(structure.spacing), separation: Math.min(Number(structure.separation), Math.max(0, Number(structure.spacing) - 1)), salt: salt(id) },
  }) });
  return { files, tags, copies };
}

/** 1.16.5: a feature placing the template, registered and added to the chosen biomes. */
function feature1165(env: GenEnv, s: ElementContext): { source: JavaSourceFile; cls: string } {
  const pkg = env.project.mod.package;
  const cls = `${pascal(String(s.id))}StructureFeature`;
  const spacing = Math.max(1, Number(s.spacing));
  const ignored = (s.ignoredBlocks as string[]).map((b) => blockExpr(env, b));
  const height = s.useStartHeight === true
    ? `${Number(s.startHeightMin)} + random.nextInt(Math.max(1, ${Number(s.startHeightMax) - Number(s.startHeightMin)} + 1))`
    : `world.getHeight(net.minecraft.world.gen.Heightmap.Type.${str(s.surfaceDetectionType)}, x, z)`;
  const rl = (id: string) => `new net.minecraft.util.ResourceLocation(${JSON.stringify(id)})`;
  const category = (name: string) => `event.getCategory() == net.minecraft.world.biome.Biome.Category.${name}`;
  const tests = (s.biomeRefs as string[]).map((b) => b === "#minecraft:is_nether" ? category("NETHER") : b === "#minecraft:is_end" ? category("THEEND")
    : b === "#minecraft:is_overworld" ? `!(${category("NETHER")} || ${category("THEEND")} || ${category("NONE")})`
      : b.startsWith("#") ? "false" : `${rl(b)}.equals(event.getName())`);
  const code = `package ${pkg}.worldgen;

/** Generated by MCEdge. Places the ${s.id} structure template. */
public class ${cls} extends net.minecraft.world.gen.feature.Feature<net.minecraft.world.gen.feature.NoFeatureConfig> {
    private static net.minecraft.world.gen.feature.ConfiguredFeature<?, ?> configured;

    public ${cls}() {
        super(net.minecraft.world.gen.feature.NoFeatureConfig.CODEC);
    }

    @Override
    public boolean place(net.minecraft.world.ISeedReader world, net.minecraft.world.gen.ChunkGenerator generator, java.util.Random random, net.minecraft.util.math.BlockPos pos, net.minecraft.world.gen.feature.NoFeatureConfig config) {
        if (random.nextInt(${spacing * spacing}) != 0) return false;
        net.minecraft.world.gen.feature.template.Template template = world.getLevel().getStructureManager().get(${rl(String(s.templateId))});
        if (template == null) return false;
        int x = pos.getX() + random.nextInt(16), z = pos.getZ() + random.nextInt(16);
        int y = ${height};
        net.minecraft.world.gen.feature.template.PlacementSettings settings = new net.minecraft.world.gen.feature.template.PlacementSettings()
                .setRotation(net.minecraft.util.Rotation.getRandom(random)).setRandom(random)${ignored.length ? `
                .addProcessor(new net.minecraft.world.gen.feature.template.BlockIgnoreStructureProcessor(java.util.Arrays.asList(${ignored.join(", ")})))` : ""};
        net.minecraft.util.math.BlockPos at = new net.minecraft.util.math.BlockPos(x, y, z);
        return template.placeInWorld(world, at, at, settings, random, 2);
    }

    public static void register(net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent event) {
        event.enqueueWork(() -> {
            configured = ${pkg}.init.${pascal(env.modId)}ModStructureFeatures.${s.constant}.get().configured(net.minecraft.world.gen.feature.IFeatureConfig.NONE);
            net.minecraft.util.registry.Registry.register(net.minecraft.util.registry.WorldGenRegistries.CONFIGURED_FEATURE, ${rl(`${env.modId}:${s.id}`)}, configured);
        });
    }

    public static void addToBiome(net.minecraftforge.event.world.BiomeLoadingEvent event) {
        if (configured != null${tests.length ? ` && (${tests.join(" || ")})` : ""}) {
            event.getGeneration().addFeature(net.minecraft.world.gen.GenerationStage.Decoration.${str(s.generationStep)}, configured);
        }
    }
}
`;
  return { source: { path: `${pkg.replaceAll(".", "/")}/worldgen/${cls}.java`, code }, cls: `${pkg}.worldgen.${cls}` };
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => {
    if (env.mc !== "1.16.5" || !contexts.length) return {};
    const features = contexts.map((s) => feature1165(env, s));
    const reg = registryClass(env, {
      name: "StructureFeatures",
      valueType: "net.minecraft.world.gen.feature.Feature<net.minecraft.world.gen.feature.NoFeatureConfig>",
      registryType: "net.minecraft.world.gen.feature.Feature<?>",
      forge: "net.minecraftforge.registries.ForgeRegistries.FEATURES",
      entries: contexts.map((s, i) => ({ constant: String(s.constant), id: String(s.id), factory: `new ${features[i].cls}()` })),
    });
    return {
      sources: [reg.source, ...features.map((f) => f.source)],
      init: [reg.init, ...features.flatMap((f) => [`modBus.addListener(${f.cls}::register);`, `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(${f.cls}::addToBiome);`])],
    };
  },
} satisfies TypeModule;


