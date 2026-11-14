import type { Element } from "../elements/model.ts";
import { idClass, idExpr, itemExpr, jstr, list, pascal, str } from "./java.ts";
import { modelParent } from "./itemTraits.ts";
import { isJavaItemModel } from "./javaModels.ts";
import { procedureBuild, procedureCallById } from "./procedures.ts";
import { modClassName } from "./registries.ts";
import type { GenEnv, JavaSourceFile, ResourceFile } from "./typeModule.ts";

/**
 * Block and item states (MCreator's "states" lists).
 *
 * Blocks: `customProperties` become block state properties (logic: boolean, integer and number: integer, text: an
 * enum of the allowed values) with their starting value. Each `states` row names property values (custom ones or the
 * block's own: facing, axis, face, waterlogged) and gives the block another model, textures and bounding boxes while
 * they all match; the first matching row wins. The blockstate file lists every combination of the properties rows
 * name (variants), or with `multipartModel` draws each matching row's model over the block's own (multipart).
 *
 * Items: `customProperties` are numeric properties computed by procedures; each `states` row switches to its own model
 * and texture while every listed property is at least the listed value (the first matching row wins). Built-in
 * properties: damaged, damage (0-1), lefthanded, cooldown (0-1). 1.16.5 uses item model overrides and
 * ItemModelsProperties; 1.21.5 and 26.3 nest range_dispatch/condition/select item models and register the custom
 * properties as range select properties (NeoForge's event, Fabric: a client mixin).
 */

// ---- Block properties

export interface StateProperty { name: string; field: string; kind: "logic" | "integer" | "string"; values: string[]; initial: string; enumClass?: string }

/** Custom block state properties of a block; invalid ones are warned about and left out. */
export function blockProperties(env: GenEnv, block: Element): StateProperty[] {
  const warn = (t: string) => procedureBuild(env).warnings.push(`block/${block.id}: property ${t}`);
  const out: StateProperty[] = [];
  for (const row of list<Record<string, unknown>>(block.customProperties)) {
    const name = str(row.name);
    if (!/^[a-z0-9_]+$/.test(name)) { warn(`"${name}" needs a lower_snake_case name; left out`); continue; }
    if (out.some((p) => p.name === name) || ["facing", "axis", "face", "waterlogged"].includes(name)) { warn(`"${name}" is already a property of the block; left out`); continue; }
    const field = `PROPERTY_${name.toUpperCase()}`;
    const type = str(row.type) || "logic";
    const initial = str(row.value);
    if (type === "logic") out.push({ name, field, kind: "logic", values: ["false", "true"], initial: initial === "true" ? "true" : "false" });
    else if (type === "integer" || type === "number") {
      const min = Math.round(Number(row.min) || 0), max = Math.round(Number(row.max) || 0);
      if (type === "number" && (Number(row.min) % 1 || Number(row.max) % 1)) warn(`"${name}": block state numbers are whole numbers; ${row.min}-${row.max} becomes ${min}-${max}`);
      if (max <= min || max - min > 255) { warn(`"${name}": range ${min}-${max} is not usable (2 to 256 values)`); continue; }
      const values = Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
      out.push({ name, field, kind: "integer", values, initial: values.includes(String(Math.round(Number(initial)))) ? String(Math.round(Number(initial))) : String(min) });
    } else {
      const values = list<Record<string, unknown>>(row.arrayData).map((r) => str(r.value)).filter(Boolean);
      const bad = values.find((v) => !/^[a-z0-9_]+$/.test(v));
      if (values.length < 2 || bad || new Set(values).size !== values.length) { warn(`"${name}": needs two or more distinct lower_snake_case values`); continue; }
      out.push({ name, field, kind: "string", values, initial: values.includes(initial) ? initial : values[0], enumClass: `${pascal(name)}Value` });
    }
  }
  return out;
}

/** Fields, enum classes, default state calls and state definition entries of the custom properties. */
export function propertyCode(env: GenEnv, props: StateProperty[]): { fields: string[]; members: string[]; defaults: string[]; stateProps: string[] } {
  const legacy = env.mc === "1.16.5";
  const P = legacy ? "net.minecraft.state" : "net.minecraft.world.level.block.state.properties";
  const SR = legacy ? "net.minecraft.util.IStringSerializable" : "net.minecraft.util.StringRepresentable";
  const fields: string[] = [], members: string[] = [], defaults: string[] = [];
  for (const p of props) {
    if (p.kind === "logic") {
      fields.push(`public static final ${P}.BooleanProperty ${p.field} = ${P}.BooleanProperty.create(${jstr(p.name)});`);
      defaults.push(`.setValue(${p.field}, ${p.initial})`);
    } else if (p.kind === "integer") {
      fields.push(`public static final ${P}.IntegerProperty ${p.field} = ${P}.IntegerProperty.create(${jstr(p.name)}, ${p.values[0]}, ${p.values[p.values.length - 1]});`);
      defaults.push(`.setValue(${p.field}, ${p.initial})`);
    } else {
      members.push(`
    /** Values of the "${p.name}" property. */
    public enum ${p.enumClass} implements ${SR} {
        ${p.values.map((v) => `${v.toUpperCase()}(${jstr(v)})`).join(", ")};

        private final String name;

        ${p.enumClass}(String name) {
            this.name = name;
        }

        @Override
        public String getSerializedName() {
            return this.name;
        }
    }
`);
      fields.push(`public static final ${P}.EnumProperty<${p.enumClass}> ${p.field} = ${P}.EnumProperty.create(${jstr(p.name)}, ${p.enumClass}.class);`);
      defaults.push(`.setValue(${p.field}, ${p.enumClass}.${p.initial.toUpperCase()})`);
    }
  }
  return { fields, members, defaults, stateProps: props.map((p) => p.field) };
}

// ---- Block state rows

export interface StateRow { index: number; when: Record<string, string>; row: Record<string, unknown> }

/**
 * State rows whose properties exist with those values (others are warned about); `known` maps every property of the
 * block (custom and built in) to its values.
 */
export function stateRows(env: GenEnv, block: Element, known: Map<string, string[]>): StateRow[] {
  const warn = (t: string) => procedureBuild(env).warnings.push(`block/${block.id}: state ${t}`);
  const rows: StateRow[] = [];
  list<Record<string, unknown>>(block.states).forEach((row, index) => {
    const when: Record<string, string> = {};
    for (const [prop, value] of Object.entries((row.stateMap ?? {}) as Record<string, unknown>)) {
      const values = known.get(prop);
      if (!values) { warn(`${index + 1}: the block has no property "${prop}"; row left out`); return; }
      if (!values.includes(String(value))) { warn(`${index + 1}: ${prop} has no value "${value}" (${values.join(", ")}); row left out`); return; }
      when[prop] = String(value);
    }
    if (!Object.keys(when).length) { warn(`${index + 1}: names no property; row left out`); return; }
    rows.push({ index, when, row });
  });
  return rows;
}

/** Java condition: every property of the row has its value (by name, so built-in and custom properties work alike). */
export const stateCondition = (r: StateRow) => Object.entries(r.when).map(([p, v]) => `is(state, ${jstr(p)}, ${jstr(v)})`).join(" && ");

/** Block member reading a property value by name: is(state, "facing", "north"). */
export function stateHelper(env: GenEnv): string {
  const S = env.mc === "1.16.5" ? "net.minecraft.block.BlockState" : "net.minecraft.world.level.block.state.BlockState";
  const P = env.mc === "1.16.5" ? "net.minecraft.state.Property" : "net.minecraft.world.level.block.state.properties.Property";
  return `
    /** Whether the state's property \`name\` has the value \`value\` (as written in blockstate files). */
    private static boolean is(${S} state, String name, String value) {
        for (${P}<?> property : state.getProperties()) if (property.getName().equals(name)) return value.equals(valueName(state, property));
        return false;
    }

    private static <T extends Comparable<T>> String valueName(${S} state, ${P}<T> property) {
        return property.getName(state.getValue(property));
    }
`;
}

/**
 * Blockstate file with the state rows: variants for every combination of the properties the rows name, on top of
 * the block's own variants; multipart: the block's own model plus each row's model where it matches.
 */
export function blockstateWithStates(base: Record<string, unknown>, rows: StateRow[], known: Map<string, string[]>, model: (r: StateRow) => string, multipart: boolean): Record<string, unknown> {
  const variants = (base.variants ?? {}) as Record<string, Record<string, unknown>>;
  const keyOf = (parts: Record<string, string>) => Object.entries(parts).map(([k, v]) => `${k}=${v}`).join(",");
  const parse = (key: string) => Object.fromEntries(key.split(",").filter(Boolean).map((kv) => kv.split("=") as [string, string]));
  if (multipart) {
    const parts: Record<string, unknown>[] = [];
    for (const [key, variant] of Object.entries(variants)) {
      const own = parse(key);
      parts.push(Object.keys(own).length ? { when: own, apply: variant } : { apply: variant });
      for (const r of rows) {
        // A row naming a value the variant fixes differently never applies under it.
        if (Object.entries(r.when).some(([p, v]) => own[p] !== undefined && own[p] !== v)) continue;
        parts.push({ when: { ...own, ...r.when }, apply: { ...variant, model: model(r) } });
      }
    }
    return { multipart: parts };
  }
  const named = [...new Set(rows.flatMap((r) => Object.keys(r.when)))];
  const out: Record<string, unknown> = {};
  for (const [key, variant] of Object.entries(variants)) {
    const own = parse(key);
    const free = named.filter((p) => own[p] === undefined);
    let combos: Record<string, string>[] = [{}];
    for (const p of free) combos = combos.flatMap((c) => known.get(p)!.map((v) => ({ ...c, [p]: v })));
    for (const c of combos) {
      const state = { ...own, ...c };
      const hit = rows.find((r) => Object.entries(r.when).every(([p, v]) => state[p] === v));
      out[keyOf(state)] = hit ? { ...variant, model: model(hit) } : variant;
    }
  }
  return { variants: out };
}

// ---- Items

interface ItemPropertyUse { id: string; item: string; name: string; procedure: string }
const usages = new WeakMap<object, Map<string, ItemPropertyUse[]>>();
function itemProps(env: GenEnv): ItemPropertyUse[] {
  const perProject = usages.get(env.generated) ?? new Map<string, ItemPropertyUse[]>();
  usages.set(env.generated, perProject);
  let known = perProject.get(env.engine.id);
  if (!known) perProject.set(env.engine.id, (known = []));
  return known;
}

const BUILTIN_ITEM_PROPS = ["damaged", "damage", "lefthanded", "cooldown"];

export interface ItemStates {
  /** 1.16.5: overrides for the item model. */
  overrides: Record<string, unknown>[];
  /** 1.21.5+: the "model" value of the item definition. */
  definition?: Record<string, unknown>;
  files: ResourceFile[];
  textures: { from: string; to: string }[];
  /** 1.16.5 client setup: property registrations. */
  setup: string[];
}

/** Item states of an item whose plain model is `<modid>:item/<id>`. */
export function itemStates(env: GenEnv, item: Element, plain: Record<string, unknown>): ItemStates | undefined {
  const rows = list<Record<string, unknown>>(item.states);
  if (!rows.length) return undefined;
  const warn = (t: string) => procedureBuild(env).warnings.push(`item/${item.id}: ${t}`);
  const custom = (item.customProperties ?? {}) as Record<string, unknown>;
  const legacy = env.mc === "1.16.5";
  const out: ItemStates = { overrides: [], files: [], textures: [], setup: [] };
  // Custom properties: registered once per item.
  for (const [name, procedure] of Object.entries(custom)) {
    if (!/^[a-z0-9_]+$/.test(name) || BUILTIN_ITEM_PROPS.includes(name)) { warn(`custom property "${name}" needs another lower_snake_case name`); continue; }
    const id = `${env.modId}:${item.id}/${name}`;
    if (legacy) {
      const call = procedureCallById(env, procedure, { x: "entity.getX()", y: "entity.getY()", z: "entity.getZ()", world: "entity.level", entity: "entity", itemstack: "stack" }, `item/${item.id}: property ${name}`, "number");
      if (call) out.setup.push(`net.minecraft.item.ItemModelsProperties.register(${itemExpr(env, item.id)}, ${idExpr(env, id)}, (stack, world, entity) -> entity == null ? 0F : (float) (${call}));`);
    } else itemProps(env).push({ id, item: item.id, name, procedure: str(procedure) });
  }
  const valid = rows.map((row, i) => ({ row, i, when: Object.entries((row.stateMap ?? {}) as Record<string, unknown>).map(([p, v]) => [p, Number(v)] as [string, number]) }))
    .filter(({ when, i }) => {
      const unknown = when.find(([p]) => !BUILTIN_ITEM_PROPS.includes(p) && !(p in custom));
      if (unknown) warn(`state ${i + 1}: property "${unknown[0]}" is neither built in (${BUILTIN_ITEM_PROPS.join(", ")}) nor a custom property; row left out`);
      if (!when.length) warn(`state ${i + 1}: names no property; row left out`);
      return !unknown && when.length > 0;
    });
  for (const { row, i } of valid) {
    const name = `${item.id}_state${i}`;
    const model = str(row.model);
    if (isJavaItemModel(env, model)) warn(`state ${i + 1}: Java models are not used for item states; the item shape is used`);
    const parent = modelParent(env, `item/${item.id} state ${i + 1}`, isJavaItemModel(env, model) ? "Normal" : model);
    if (str(row.texture)) out.textures.push({ from: str(row.texture), to: `item/${name}` });
    out.files.push({ path: `assets/${env.modId}/models/item/${name}.json`, json: JSON.stringify({ parent, textures: { layer0: `${env.modId}:item/${str(row.texture) ? name : item.id}` } }, null, 2) });
  }
  const stateModel = (i: number) => `${env.modId}:item/${item.id}_state${i}`;
  const propId = (p: string) => (BUILTIN_ITEM_PROPS.includes(p) ? `minecraft:${p}` : `${env.modId}:${item.id}/${p}`);
  if (legacy) {
    // The last matching override wins, so the first row goes last.
    out.overrides = valid.slice().reverse().map(({ when, i }) => ({ predicate: Object.fromEntries(when.map(([p, v]) => [propId(p), v])), model: stateModel(i) }));
    return out;
  }
  // Nested selection: each row tests its properties (value at least the listed one), else the next row, else the plain model.
  const test = (p: string, v: number, then: unknown, other: unknown): unknown => {
    if (p === "damaged") return v > 0 ? { type: "minecraft:condition", property: "minecraft:damaged", on_true: then, on_false: other } : then;
    if (p === "lefthanded") return v > 0 ? { type: "minecraft:select", property: "minecraft:main_hand", cases: [{ when: "left", model: then }], fallback: other } : then;
    return { type: "minecraft:range_dispatch", property: propId(p), entries: [{ threshold: v, model: then }], fallback: other };
  };
  let definition: unknown = plain;
  for (const { when, i } of valid.slice().reverse()) {
    let then: unknown = { type: "minecraft:model", model: stateModel(i) };
    for (const [p, v] of when.slice().reverse()) then = test(p, v, then, definition);
    definition = then;
  }
  out.definition = definition as Record<string, unknown>;
  return out;
}

/** Custom item properties of 1.21.5 and 26.3: the range select property class and its registration. */
export function itemPropertyOutputs(env: GenEnv): { sources: JavaSourceFile[]; clientInit: string[]; mixins: { id: string; code: string; client?: boolean }[] } {
  const props = itemProps(env);
  if (!props.length) return { sources: [], clientInit: [], mixins: [] };
  const pkg = `${env.project.mod.package}.client`;
  const cls = `${modClassName(env)}ItemProperties`;
  const v26 = env.mc === "26.3";
  const id = idClass(env);
  const R = "net.minecraft.client.renderer.item.properties.numeric.RangeSelectItemModelProperty";
  const deps = v26
    ? { x: "owner.position().x()", y: "owner.position().y()", z: "owner.position().z()", world: "owner.level()", entity: "owner.asLivingEntity()", itemstack: "stack" }
    : { x: "entity.getX()", y: "entity.getY()", z: "entity.getZ()", world: "entity.level()", entity: "entity", itemstack: "stack" };
  const records = props.map((p, i) => {
    const call = procedureCallById(env, p.procedure, deps, `item/${p.item}: property ${p.name}`, "number") ?? "0";
    return `    /** ${p.id} */
    public record Property${i}() implements ${R} {
        public static final com.mojang.serialization.MapCodec<Property${i}> MAP_CODEC = com.mojang.serialization.MapCodec.unit(new Property${i}());

        @Override
        public float get(net.minecraft.world.item.ItemStack stack, net.minecraft.client.multiplayer.ClientLevel level, ${v26 ? "net.minecraft.world.entity.ItemOwner owner" : "net.minecraft.world.entity.LivingEntity entity"}, int seed) {
            if (${v26 ? "owner" : "entity"} == null) return 0.0F;
            return (float) (${call});
        }

        @Override
        public com.mojang.serialization.MapCodec<Property${i}> type() {
            return MAP_CODEC;
        }
    }`;
  });
  const code = `package ${pkg};

/** Generated by MCEdge: item properties computed by procedures, for item state models. */
public final class ${cls} {
    private ${cls}() {}

${records.join("\n\n")}
}
`;
  const entries = props.map((p, i) => [`${idExpr(env, p.id)}`, `${pkg}.${cls}.Property${i}.MAP_CODEC`]);
  if (env.loader === "neoforge") {
    return {
      sources: [{ path: `${pkg.replaceAll(".", "/")}/${cls}.java`, code }],
      clientInit: [`modBus.addListener(net.neoforged.neoforge.client.event.RegisterRangeSelectItemModelPropertyEvent.class, event -> {
${entries.map(([k, v]) => `            event.register(${k}, ${v});`).join("\n")}
        });`],
      mixins: [],
    };
  }
  const mixin = "org.spongepowered.asm.mixin";
  const mixinCode = `package ${env.project.mod.package}.mixin;

/** Generated by MCEdge. Registers the mod's item properties for range_dispatch item models (Fabric has no API for it). */
@${mixin}.Mixin(net.minecraft.client.renderer.item.properties.numeric.RangeSelectItemModelProperties.class)
public abstract class RangeSelectItemModelPropertiesMixin {
    @${mixin}.Shadow
    @${mixin}.Final
    private static net.minecraft.util.ExtraCodecs.LateBoundIdMapper<${id}, com.mojang.serialization.MapCodec<? extends ${R}>> ID_MAPPER;

    @${mixin}.injection.Inject(method = "bootstrap", at = @${mixin}.injection.At("TAIL"))
    private static void ${env.modId}$register(org.spongepowered.asm.mixin.injection.callback.CallbackInfo info) {
${entries.map(([k, v]) => `        ID_MAPPER.put(${k}, ${v});`).join("\n")}
    }
}
`;
  return { sources: [{ path: `${pkg.replaceAll(".", "/")}/${cls}.java`, code }], clientInit: [], mixins: [{ id: "RangeSelectItemModelPropertiesMixin", code: mixinCode, client: true }] };
}
