import type { Element } from "../../elements/model.ts";
import { chain, readBlocklyXml, type XmlBlock } from "../blocklyXml.ts";
import { derivedConstant, idExpr, list, pascal, qualify, str } from "../java.ts";
import { procedureBuild, procedureCall } from "../procedures.ts";
import { registryClass } from "../registries.ts";
import type { ElementContext, GenEnv, JavaSourceFile, ResourceFile, TypeModule } from "../typeModule.ts";

/**
 * Features (1.21.5+): the configured feature and its placement read from the feature definition (MCreator feature
 * blocks; MCEdge has no feature block set yet, so only definitions imported from MCreator are read, and only the
 * blocks listed in FEATURES / PLACEMENTS below), the placed feature added to the chosen biomes at the generation
 * step, and the generate condition procedure as a placement filter. 1.16.5 builds features in code and is not
 * generated.
 */

type Json = Record<string, unknown>;

class Unsupported extends Error {}

/** MCreator block reference ("Blocks.STONE", "CUSTOM:RubyOre", "minecraft:stone") as a registry id. */
function blockId(env: GenEnv, value: string): string {
  const v = value.replace(/#.*$/, "").trim();
  if (v.startsWith("Blocks.")) return `minecraft:${v.slice(7).toLowerCase()}`;
  if (v.startsWith("CUSTOM:")) return `${env.modId}:${v.slice(7).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`;
  return qualify(env, v.toLowerCase());
}

const tagId = (tag: string) => (tag.includes(":") ? tag : `minecraft:${tag}`).replace(/^#/, "");

function need(block: XmlBlock | undefined, what: string): XmlBlock {
  if (!block) throw new Unsupported(`missing ${what}`);
  return block;
}

/** Block state: {Name} on 1.21.5, an id string or {id, properties} on 26.x. */
function blockState(env: GenEnv, b: XmlBlock): unknown {
  if (b.type !== "blockstate_selector") throw new Unsupported(b.type);
  const id = blockId(env, b.fields.block ?? "");
  const props: Record<string, string> = {};
  for (let i = 0; `property${i}` in b.fields; i++) props[b.fields[`property${i}`]] = b.fields[`value${i}`];
  const has = Object.keys(props).length > 0;
  if (env.mc === "26.3") return has ? { id, properties: props } : id;
  return has ? { Name: id, Properties: props } : { Name: id };
}

function stateProvider(env: GenEnv, b: XmlBlock): unknown {
  const state = blockState(env, b);
  // 26.x registers state providers: an inline one must be a state object, a bare id would be a reference.
  if (env.mc === "26.3") return typeof state === "string" ? { id: state } : state;
  return { type: "minecraft:simple_state_provider", state };
}

function ruleTest(env: GenEnv, b: XmlBlock): Json {
  switch (b.type) {
    case "rule_test_always_true": return { predicate_type: "minecraft:always_true" };
    case "rule_test_tag_match": return { predicate_type: "minecraft:tag_match", tag: tagId(b.fields.tag ?? "") };
    case "rule_test_block_match": return { predicate_type: "minecraft:block_match", block: blockId(env, b.fields.block ?? "") };
    default: throw new Unsupported(b.type);
  }
}

function intProvider(b: XmlBlock): unknown {
  switch (b.type) {
    case "int_provider_constant": return Number(b.fields.value);
    case "int_provider_uniform": return { type: "minecraft:uniform", min_inclusive: Number(b.fields.min), max_inclusive: Number(b.fields.max) };
    case "int_provider_biased_to_bottom": return { type: "minecraft:biased_to_bottom", min_inclusive: Number(b.fields.min), max_inclusive: Number(b.fields.max) };
    default: throw new Unsupported(b.type);
  }
}

function anchor(b: XmlBlock): Json {
  switch (b.type) {
    case "vertical_anchor_absolute": return { absolute: Number(b.fields.value) };
    case "vertical_anchor_above_bottom": return { above_bottom: Number(b.fields.value) };
    case "vertical_anchor_below_top": return { below_top: Number(b.fields.value) };
    default: throw new Unsupported(b.type);
  }
}

/** Configured feature type and configuration of a feature block. */
const FEATURES: Record<string, (env: GenEnv, b: XmlBlock) => { type: string; config: Json }> = {
  feature_no_op: () => ({ type: "minecraft:no_op", config: {} }),
  feature_simple_block: (env, b) => ({ type: "minecraft:simple_block", config: { to_place: stateProvider(env, need(b.values.block, "block")) } }),
  feature_ore: (env, b) => ({ type: "minecraft:ore", config: oreConfig(env, b) }),
  feature_scattered_ore: (env, b) => ({ type: "minecraft:scattered_ore", config: oreConfig(env, b) }),
};

function oreConfig(env: GenEnv, b: XmlBlock): Json {
  const targets = Object.keys(b.values).filter((k) => /^target\d+$/.test(k)).sort((a, c) => Number(a.slice(6)) - Number(c.slice(6))).map((k) => {
    const t = b.values[k];
    if (t.type !== "ore_target") throw new Unsupported(t.type);
    return { target: ruleTest(env, need(t.values.target, "rule test")), state: blockState(env, need(t.values.state, "block state")) };
  });
  return { size: Number(b.fields.size), discard_chance_on_air_exposure: Number(b.fields.discardOnAirChance ?? 0), targets };
}

const PLACEMENTS: Record<string, (b: XmlBlock) => Json> = {
  placement_count: (b) => ({ type: "minecraft:count", count: intProvider(need(b.values.count, "count")) }),
  placement_in_square: () => ({ type: "minecraft:in_square" }),
  placement_biome_filter: () => ({ type: "minecraft:biome" }),
  placement_rarity: (b) => ({ type: "minecraft:rarity_filter", chance: Number(b.fields.rarity) }),
  placement_heightmap: (b) => ({ type: "minecraft:heightmap", heightmap: b.fields.heightmap }),
  placement_height_uniform: (b) => ({ type: "minecraft:height_range", height: { type: "minecraft:uniform", min_inclusive: anchor(need(b.values.min, "min")), max_inclusive: anchor(need(b.values.max, "max")) } }),
  placement_height_triangular: (b) => ({ type: "minecraft:height_range", height: { type: "minecraft:trapezoid", min_inclusive: anchor(need(b.values.min, "min")), max_inclusive: anchor(need(b.values.max, "max")) } }),
};

interface Definition {
  /** Configured feature JSON, or the id of an existing configured feature. */
  feature: Json | string;
  placement: Json[];
}

function definition(env: GenEnv, xml: string): Definition {
  const container = readBlocklyXml(xml).find((b) => b.type === "feature_container");
  if (!container) throw new Unsupported("no feature container");
  const featureBlock = need(container.values.feature, "feature");
  let feature: Json | string;
  if (featureBlock.type === "configured_feature_reference") {
    feature = tagId((featureBlock.fields.feature ?? "").toLowerCase());
  } else {
    const make = FEATURES[featureBlock.type];
    if (!make) throw new Unsupported(featureBlock.type);
    const { type, config } = make(env, featureBlock);
    feature = env.mc === "26.3" ? { type, ...config } : { type, config };
  }
  const placement = chain(container.next).map((b) => {
    const make = PLACEMENTS[b.type];
    if (!make) throw new Unsupported(b.type);
    return make(b);
  });
  return { feature, placement };
}

const conditionClass = (env: GenEnv, id: string) => `${pascal(id)}FeatureCondition`;

function element(feature: Element, env: GenEnv): ElementContext {
  let def: Definition;
  try {
    def = definition(env, str(feature.featurexml));
  } catch (e) {
    if (!(e instanceof Unsupported)) throw e;
    procedureBuild(env).warnings.push(`feature/${feature.id}: feature definition not generated (${e.message})`);
    return {};
  }
  const id = qualify(env, feature.id);
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const files: ResourceFile[] = [];
  const init: string[] = [];
  const dir = `data/${env.modId}/worldgen`;
  if (typeof def.feature !== "string") files.push({ path: `${dir}/${env.mc === "26.3" ? "feature" : "configured_feature"}/${feature.id}.json`, json: json(def.feature) });

  // The generate condition becomes a placement filter of this mod.
  const pkg = env.project.mod.package;
  const cls = conditionClass(env, feature.id);
  const test = procedureCall(env, "feature", feature, "generateCondition", { x: "pos.getX()", y: "pos.getY()", z: "pos.getZ()", world: "context.getLevel()" });
  let source: JavaSourceFile | undefined;
  const placement = [...def.placement];
  if (test) {
    const P = "net.minecraft.world.level.levelgen.placement";
    const sig = "boolean shouldPlace(net.minecraft.world.level.levelgen.placement.PlacementContext context, net.minecraft.util.RandomSource random, net.minecraft.core.BlockPos pos)";
    const code = env.mc === "26.3"
      ? `package ${pkg}.worldgen;

/** Generated by MCEdge. Places the feature only where its generate condition holds. */
public final class ${cls} implements ${P}.PlacementFilter {
    public static final ${cls} INSTANCE = new ${cls}();
    public static final com.mojang.serialization.MapCodec<${cls}> CODEC = com.mojang.serialization.MapCodec.unit(INSTANCE);

    @Override
    public ${sig} {
        return ${test};
    }

    @Override
    public com.mojang.serialization.MapCodec<${cls}> codec() {
        return CODEC;
    }
}
`
      : `package ${pkg}.worldgen;

/** Generated by MCEdge. Places the feature only where its generate condition holds. */
public final class ${cls} extends ${P}.PlacementFilter {
    public static final ${cls} INSTANCE = new ${cls}();
    public static final ${P}.PlacementModifierType<${cls}> TYPE = () -> com.mojang.serialization.MapCodec.unit(INSTANCE);

    @Override
    protected ${sig} {
        return ${test};
    }

    @Override
    public ${P}.PlacementModifierType<?> type() {
        return TYPE;
    }
}
`;
    source = { path: `${pkg.replaceAll(".", "/")}/worldgen/${cls}.java`, code };
    placement.push({ type: `${env.modId}:${feature.id}_condition` });
  }
  files.push({ path: `${dir}/placed_feature/${feature.id}.json`, json: json({ feature: typeof def.feature === "string" ? def.feature : id, placement }) });

  if (feature.skipPlacement !== true) {
    const step = str(feature.generationStep);
    const biomes = list<Record<string, unknown>>(feature.restrictionBiomes).map((r) => str(r.biome)).filter(Boolean).map((b) => qualify(env, b));
    const biomeTag = biomes.find((b) => b.startsWith("#"));
    if (env.loader === "neoforge") {
      const set = biomeTag ?? (biomes.length ? biomes : { type: "neoforge:any" });
      files.push({ path: `data/${env.modId}/neoforge/biome_modifier/${feature.id}.json`, json: json({ type: "neoforge:add_features", biomes: set, features: id, step: step.toLowerCase() }) });
    } else {
      const reg = "net.minecraft.core.registries.Registries";
      const selectors = "net.fabricmc.fabric.api.biome.v1.BiomeSelectors";
      const selector = biomeTag ? `${selectors}.tag(net.minecraft.tags.TagKey.create(${reg}.BIOME, ${idExpr(env, biomeTag.slice(1))}))`
        : biomes.length ? `${selectors}.includeByKey(${biomes.map((b) => `net.minecraft.resources.ResourceKey.create(${reg}.BIOME, ${idExpr(env, b)})`).join(", ")})`
          : `${selectors}.all()`;
      init.push(`net.fabricmc.fabric.api.biome.v1.BiomeModifications.addFeature(${selector}, net.minecraft.world.level.levelgen.GenerationStep.Decoration.${step}, net.minecraft.resources.ResourceKey.create(${reg}.PLACED_FEATURE, ${idExpr(env, id)}));`);
    }
  }
  return { files, init, conditionSource: source, conditionClass: source ? `${pkg}.worldgen.${cls}` : "" };
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => {
    const conditions = contexts.filter((c) => c.conditionSource);
    if (!conditions.length) return {};
    const mc26 = env.mc === "26.3";
    const reg = registryClass(env, {
      name: "PlacementModifiers",
      valueType: mc26 ? "com.mojang.serialization.MapCodec<? extends net.minecraft.world.level.levelgen.placement.PlacementModifier>" : "net.minecraft.world.level.levelgen.placement.PlacementModifierType<?>",
      key: "PLACEMENT_MODIFIER_TYPE",
      entries: conditions.map((c) => ({ constant: derivedConstant(String(c.constant), "Condition"), id: `${c.id}_condition`, factory: `${c.conditionClass}.${mc26 ? "CODEC" : "TYPE"}` })),
    });
    return { sources: [reg.source, ...conditions.map((c) => c.conditionSource as JavaSourceFile)], init: [reg.init] };
  },
} satisfies TypeModule;
