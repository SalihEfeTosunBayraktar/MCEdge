import type { Element } from "../../elements/model.ts";
import { idExpr, jfloat, list, str } from "../java.ts";
import type { GenEnv, JavaSourceFile } from "../typeModule.ts";
import { animatorClass, BUILTIN_MODELS, findAnimation, loadModel, modelClass, modelExists } from "./models.ts";

/**
 * Living entity renderers: the element's model (a built-in vanilla model or a project Blockbench model) with its
 * texture, extra render layers, animations, visual scale, translucency and shaking. On 1.21.5 and 26.3 the renderer
 * keeps the entity in its render state (a subclass of the model's state), so conditions and animations can read it.
 */

export interface RenderInput {
  e: Element;
  /** Entity class (fully qualified) and its renderer class name. */
  entity: string;
  cls: string;
  /** Java condition of a procedure field evaluated with `entity` in scope, or undefined. */
  condition: (field: string, entityVar: string, row?: Record<string, unknown>) => string | undefined;
  /** Number expression of a procedure field with `entity` in scope, or undefined. */
  number: (field: string, entityVar: string) => string | undefined;
  /** Synced logic data entry names. */
  logicData: Set<string>;
  warn: (text: string) => void;
}

interface Vanilla { layer: string; model215: string; model263: string; state: string; legacy: string }
const CM = "net.minecraft.client.model";
const ST = "net.minecraft.client.renderer.entity.state";
const LM = "net.minecraft.client.renderer.entity.model";
const VANILLA: Record<string, Vanilla> = {
  Chicken: { layer: "CHICKEN", model215: `${CM}.ChickenModel`, model263: `${CM}.animal.chicken.AdultChickenModel`, state: "ChickenRenderState", legacy: `new ${LM}.ChickenModel<>()` },
  Cod: { layer: "COD", model215: `${CM}.CodModel`, model263: `${CM}.animal.fish.CodModel`, state: "LivingEntityRenderState", legacy: `new ${LM}.CodModel<>()` },
  Cow: { layer: "COW", model215: `${CM}.CowModel`, model263: `${CM}.animal.cow.CowModel`, state: "LivingEntityRenderState", legacy: `new ${LM}.CowModel<>()` },
  Creeper: { layer: "CREEPER", model215: `${CM}.CreeperModel`, model263: `${CM}.monster.creeper.CreeperModel`, state: "CreeperRenderState", legacy: `new ${LM}.CreeperModel<>()` },
  Ghast: { layer: "GHAST", model215: `${CM}.GhastModel`, model263: `${CM}.monster.ghast.GhastModel`, state: "GhastRenderState", legacy: `new ${LM}.GhastModel<>()` },
  Ocelot: { layer: "OCELOT", model215: `${CM}.OcelotModel`, model263: `${CM}.animal.feline.AdultOcelotModel`, state: "FelineRenderState", legacy: `new ${LM}.OcelotModel<>(0.0F)` },
  Pig: { layer: "PIG", model215: `${CM}.PigModel`, model263: `${CM}.animal.pig.PigModel`, state: "LivingEntityRenderState", legacy: `new ${LM}.PigModel<>()` },
  Piglin: { layer: "PIGLIN", model215: `${CM}.PiglinModel`, model263: `${CM}.monster.piglin.AdultPiglinModel`, state: "PiglinRenderState", legacy: `new ${LM}.PiglinModel<>(0.0F, 64, 64)` },
  Salmon: { layer: "SALMON", model215: `${CM}.SalmonModel`, model263: `${CM}.animal.fish.SalmonModel`, state: "SalmonRenderState", legacy: `new ${LM}.SalmonModel<>()` },
  Silverfish: { layer: "SILVERFISH", model215: `${CM}.SilverfishModel`, model263: `${CM}.monster.silverfish.SilverfishModel`, state: "LivingEntityRenderState", legacy: `new ${LM}.SilverfishModel<>()` },
  Slime: { layer: "SLIME", model215: `${CM}.SlimeModel`, model263: `${CM}.monster.slime.SlimeModel`, state: "LivingEntityRenderState", legacy: `new ${LM}.SlimeModel<>(16)` },
  Spider: { layer: "SPIDER", model215: `${CM}.SpiderModel`, model263: `${CM}.monster.spider.SpiderModel`, state: "LivingEntityRenderState", legacy: `new ${LM}.SpiderModel<>()` },
  Villager: { layer: "VILLAGER", model215: `${CM}.VillagerModel`, model263: `${CM}.npc.VillagerModel`, state: "VillagerRenderState", legacy: `new ${LM}.VillagerModel<>(0.0F)` },
  Witch: { layer: "WITCH", model215: `${CM}.WitchModel`, model263: `${CM}.monster.witch.WitchModel`, state: "WitchRenderState", legacy: `new ${LM}.WitchModel<>(0.0F)` },
};

/** Model of the element on this engine: "Biped" for unknown names (warned). */
export function mobModel(env: GenEnv, e: Element, warn: (t: string) => void): { kind: "biped" | "vanilla" | "project"; name: string } {
  const name = str(e.mobModelName) || "Biped";
  if (name === "Biped") return { kind: "biped", name };
  if (VANILLA[name]) return { kind: "vanilla", name };
  if (modelExists(env, name)) return { kind: "project", name };
  warn(`model "${name}" is neither built in nor a project model (models/${name}.java or .bbmodel); the biped model is used`);
  return { kind: "biped", name: "Biped" };
}

/** Animation rows that play: project model only, each resolved to its animation index in the model file. */
export function animationRows(env: GenEnv, e: Element, warn: (t: string) => void): { row: Record<string, unknown>; index: number; slot: number }[] {
  const model = mobModel(env, e, () => {});
  const rows = list<Record<string, unknown>>(e.animations);
  if (!rows.length) return [];
  if (model.kind !== "project") {
    warn(`animations need a project model (models/<name>.java or .bbmodel); "${model.name}" has no animations`);
    return [];
  }
  const m = loadModel(env, model.name);
  return rows.map((row, slot) => ({ row, slot, index: findAnimation(m, str(row.animation)) })).filter((r) => {
    if (r.index < 0) warn(`animation "${str(r.row.animation)}" is not in project model "${model.name}"`);
    return r.index >= 0;
  });
}

const tex = (env: GenEnv, path: string) => `${env.modId}:textures/entity/${path}.png`;

export function rendererSource(env: GenEnv, input: RenderInput): JavaSourceFile {
  const { e, entity, cls } = input;
  const legacy = env.mc === "1.16.5";
  const pkg = env.project.mod.package;
  const model = mobModel(env, e, input.warn);
  const shadow = jfloat(Number(e.modelShadowSize) || 0.5);
  const fixedScale = Number(e.visualScale) || 1;
  const anims = animationRows(env, e, input.warn);
  const layers = list<Record<string, unknown>>(e.modelLayers);
  const id = legacy ? "net.minecraft.util.ResourceLocation" : env.mc === "26.3" ? "net.minecraft.resources.Identifier" : "net.minecraft.resources.ResourceLocation";
  const texture = idExpr(env, tex(env, String(e.id)));
  const ent = legacy ? "entity" : "state.entity";
  const members: string[] = [];
  const ctor: string[] = [];

  // Visual scale, baby scale, villager size.
  const scaleProc = input.number("visualScaleProcedure", ent);
  const scaleLines: string[] = [];
  if (scaleProc) scaleLines.push(`float scale = (float) (${scaleProc});`, "pose.scale(scale, scale, scale);");
  else if (fixedScale !== 1) scaleLines.push(`pose.scale(${jfloat(fixedScale)}, ${jfloat(fixedScale)}, ${jfloat(fixedScale)});`);
  if (model.name === "Villager") scaleLines.push("pose.scale(0.9375F, 0.9375F, 0.9375F);");
  if (!legacy && e.breedable === true) scaleLines.push("pose.scale(state.ageScale, state.ageScale, state.ageScale);");

  const transparent = input.condition("transparentModelConditionProcedure", ent) ?? (e.transparentModelCondition === true ? "true" : undefined);
  const shaking = input.condition("isShakingConditionProcedure", ent) ?? (e.isShakingCondition === true ? "true" : undefined);
  const dataCond = (name: string, target: string) => {
    if (!input.logicData.has(name)) { input.warn(`"${name}" is not a logic entity data entry`); return "false"; }
    return `${target}.getEntityData().get(${entity}.DATA_${name})`;
  };
  const rowCond = (row: Record<string, unknown>, target: string) =>
    str(row.syncedDataCondition) ? dataCond(str(row.syncedDataCondition), target) : input.condition("condition", target, row);

  let code: string;
  if (legacy) {
    const R = "net.minecraft.client.renderer.entity";
    let base: string; let M: string; let modelExpr: string;
    if (model.kind === "biped") {
      M = `${LM}.BipedModel<${entity}>`; base = `${R}.BipedRenderer<${entity}, ${M}>`; modelExpr = `new ${LM}.BipedModel<>(0.0F)`;
      ctor.push(`this.addLayer(new ${R}.layers.BipedArmorLayer<>(this, new ${LM}.BipedModel<>(0.5F), new ${LM}.BipedModel<>(1.0F)));`);
    } else if (model.kind === "vanilla") {
      const v = VANILLA[model.name];
      M = `${v.legacy.replace(/^new /, "").replace(/<>.*$/, "")}<${entity}>`; base = `${R}.MobRenderer<${entity}, ${M}>`; modelExpr = v.legacy;
    } else {
      M = `${cls}.Model`; base = `${R}.MobRenderer<${entity}, ${M}>`; modelExpr = "new Model()";
      members.push(animatedModel1165(env, input, model.name, anims, rowCond));
    }
    layers.forEach((row, i) => ctor.push(layer1165(env, input, row, i, M, rowCond)));
    if (scaleLines.length) members.push(`    @Override\n    protected void scale(${entity} entity, com.mojang.blaze3d.matrix.MatrixStack pose, float partialTick) {\n${scaleLines.map((l) => `        ${l}`).join("\n")}\n    }`);
    if (transparent) members.push(`    @Override\n    protected boolean isBodyVisible(${entity} entity) {\n        return !(${transparent});\n    }`);
    if (shaking) members.push(`    @Override\n    protected boolean isShaking(${entity} entity) {\n        return ${shaking};\n    }`);
    code = `package ${pkg}.client;

/** Generated by MCEdge. */
public class ${cls} extends ${base} {
    private static final ${id} TEXTURE = ${texture};

    public ${cls}(${R}.EntityRendererManager manager) {
        super(manager, ${modelExpr}, ${shadow});
${ctor.map((l) => `        ${l}`).join("\n")}
    }

    @Override
    public ${id} getTextureLocation(${entity} entity) {
        return TEXTURE;
    }

${members.join("\n\n")}
}
`;
  } else {
    const R = "net.minecraft.client.renderer.entity";
    let base: string; let M: string; let modelExpr: string; let stateBase: string;
    if (model.kind === "biped") {
      stateBase = `${ST}.HumanoidRenderState`;
      M = `${CM}.HumanoidModel<${cls}.State>`; base = `${R}.HumanoidMobRenderer<${entity}, ${cls}.State, ${M}>`;
      modelExpr = `new ${CM}.HumanoidModel<>(context.bakeLayer(${CM}.geom.ModelLayers.PLAYER))`;
      ctor.push(env.mc === "26.3"
        ? `this.addLayer(new ${R}.layers.HumanoidArmorLayer<>(this, ${R}.ArmorModelSet.bake(${CM}.geom.ModelLayers.PLAYER_ARMOR, context.getModelSet(), ${CM}.HumanoidModel::new), context.getEquipmentRenderer()));`
        : `this.addLayer(new ${R}.layers.HumanoidArmorLayer<>(this, new ${CM}.HumanoidArmorModel<>(context.bakeLayer(${CM}.geom.ModelLayers.PLAYER_INNER_ARMOR)), new ${CM}.HumanoidArmorModel<>(context.bakeLayer(${CM}.geom.ModelLayers.PLAYER_OUTER_ARMOR)), context.getEquipmentRenderer()));`);
    } else if (model.kind === "vanilla") {
      const v = VANILLA[model.name];
      stateBase = `${ST}.${v.state}`;
      M = env.mc === "26.3" ? v.model263 : v.model215; base = `${R}.MobRenderer<${entity}, ${cls}.State, ${M}>`;
      modelExpr = `new ${M}(context.bakeLayer(${CM}.geom.ModelLayers.${v.layer}))`;
      // Raw type: the vanilla layer is typed with the vanilla state, ours is a subclass of it.
      if (model.name === "Villager" || model.name === "Witch") ctor.push(`this.addLayer(new ${R}.layers.CrossedArmsItemLayer(this));`);
    } else {
      stateBase = `${ST}.LivingEntityRenderState`;
      M = `${cls}.Model`; base = `${R}.MobRenderer<${entity}, ${cls}.State, ${M}>`;
      modelExpr = `new Model(context.bakeLayer(${modelClass(env, model.name)}.LAYER_LOCATION))`;
      members.push(animatedModelModern(env, input, model.name, anims, rowCond));
    }
    layers.forEach((row, i) => ctor.push(layerModern(env, input, row, i, M, rowCond)));
    const holding = model.name === "Villager" || model.name === "Witch"
      ? `\n        ${ST}.HoldingEntityRenderState.extractHoldingEntityRenderState(entity, state, this.itemModelResolver);` : "";
    if (scaleLines.length) members.push(`    @Override\n    protected void scale(State state, com.mojang.blaze3d.vertex.PoseStack pose) {\n${scaleLines.map((l) => `        ${l}`).join("\n")}\n    }`);
    if (transparent) members.push(`    @Override\n    protected boolean isBodyVisible(State state) {\n        ${entity} entity = state.entity;\n        return entity == null || !(${transparent.replaceAll("state.entity", "entity")});\n    }`);
    if (shaking) members.push(`    @Override\n    protected boolean isShaking(State state) {\n        ${entity} entity = state.entity;\n        return entity != null && (${shaking.replaceAll("state.entity", "entity")});\n    }`);
    code = `package ${pkg}.client;

/** Generated by MCEdge. */
public class ${cls} extends ${base} {
    private static final ${id} TEXTURE = ${texture};

    /** The model's render state plus the entity, for conditions and animations. */
    public static class State extends ${stateBase} {
        public ${entity} entity;
    }

    public ${cls}(${R}.EntityRendererProvider.Context context) {
        super(context, ${modelExpr}, ${shadow});
${ctor.map((l) => `        ${l}`).join("\n")}
    }

    @Override
    public State createRenderState() {
        return new State();
    }

    @Override
    public void extractRenderState(${entity} entity, State state, float partialTicks) {
        super.extractRenderState(entity, state, partialTicks);
        state.entity = entity;${holding}
    }

    @Override
    public ${id} getTextureLocation(State state) {
        return TEXTURE;
    }

${members.join("\n\n")}
}
`;
  }
  return { path: `${pkg.replaceAll(".", "/")}/client/${cls}.java`, code };
}

type RowCond = (row: Record<string, unknown>, target: string) => string | undefined;
type Anim = { row: Record<string, unknown>; index: number; slot: number };

/** Animation statements applying the element's animations to `this.bones` with `entity` (may be null) in scope. */
function animationCode(env: GenEnv, input: RenderInput, name: string, anims: Anim[], rowCond: RowCond, age: string, walkPos: string, walkSpeed: string): string[] {
  const A = animatorClass(env);
  const M = modelClass(env, name);
  return anims.map(({ row, index, slot }) => {
    const speed = jfloat(Number(row.speed) || 1);
    if (row.walking === true) {
      const cond = rowCond(row, "entity");
      const apply = `${A}.apply(this.bones, ${M}.ANIMATIONS[${index}], ${walkPos} * 0.05F * ${speed}, Math.min(${walkSpeed} * ${jfloat(Number(row.amplitude) || 1)}, 1.0F));`;
      return cond ? `if (entity != null && (${cond})) ${apply}` : apply;
    }
    // Non-walking animations run while the entity's condition holds, timed from when it started (client tick).
    return `if (entity != null && entity.mcedgeAnimationStart[${slot}] >= 0) ${A}.apply(this.bones, ${M}.ANIMATIONS[${index}], (${age} - entity.mcedgeAnimationStart[${slot}]) / 20.0F * ${speed}, 1.0F);`;
  });
}

function animatedModel1165(env: GenEnv, input: RenderInput, name: string, anims: Anim[], rowCond: RowCond): string {
  const lines = animationCode(env, input, name, anims, rowCond, "ageInTicks", "limbSwing", "limbSwingAmount");
  return `    /** The project model with this entity's animations. */
    public static class Model extends ${modelClass(env, name)}<${input.entity}> {
        @Override
        public void setupAnim(${input.entity} entity, float limbSwing, float limbSwingAmount, float ageInTicks, float netHeadYaw, float headPitch) {
            super.setupAnim(entity, limbSwing, limbSwingAmount, ageInTicks, netHeadYaw, headPitch);
${lines.map((l) => `            ${l}`).join("\n")}
        }
    }`;
}

function animatedModelModern(env: GenEnv, input: RenderInput, name: string, anims: Anim[], rowCond: RowCond): string {
  const lines = animationCode(env, input, name, anims, rowCond, "state.ageInTicks", "state.walkAnimationPos", "state.walkAnimationSpeed");
  const S = `${ST}.LivingEntityRenderState`;
  return `    /** The project model with this entity's animations. */
    public static class Model extends ${modelClass(env, name)} {
        public Model(net.minecraft.client.model.geom.ModelPart root) {
            super(root);
        }

        @Override
        public void setupAnim(${S} state) {
            super.setupAnim(state);
            ${input.entity} entity = state instanceof State s ? s.entity : null;
${lines.map((l) => `            ${l}`).join("\n")}
        }
    }`;
}

/** Layer model: the parent model ("Default") or another project model. */
function layerModel(env: GenEnv, input: RenderInput, row: Record<string, unknown>): string | undefined {
  const m = str(row.model) || "Default";
  if (m === "Default") return undefined;
  if (modelExists(env, m)) return modelClass(env, m);
  input.warn(`layer model "${m}" is not a project model (models/${m}.java or .bbmodel)${BUILTIN_MODELS.includes(m) ? "; built-in models cannot be layers" : ""}; the entity's own model is used`);
  return undefined;
}

function layerTexture(env: GenEnv, row: Record<string, unknown>, e: Element, i: number): string {
  return tex(env, str(row.texture) ? `${e.id}_layer_${i}` : String(e.id));
}

function layer1165(env: GenEnv, input: RenderInput, row: Record<string, unknown>, i: number, M: string, rowCond: RowCond): string {
  const own = layerModel(env, input, row);
  const cond = rowCond(row, "entity");
  const overlay = row.disableHurtOverlay === true ? "net.minecraft.client.renderer.texture.OverlayTexture.NO_OVERLAY" : "net.minecraft.client.renderer.entity.LivingRenderer.getOverlayCoords(entity, 0.0F)";
  const type = row.glow === true ? "eyes" : "entityCutoutNoCull";
  const draw = own
    ? `this.getParentModel().copyPropertiesTo(this.model);
                this.model.prepareMobModel(entity, limbSwing, limbSwingAmount, partialTicks);
                this.model.setupAnim(entity, limbSwing, limbSwingAmount, ageInTicks, netHeadYaw, headPitch);
                this.model.renderToBuffer(pose, buffer, light, ${overlay}, 1.0F, 1.0F, 1.0F, 1.0F);`
    : `this.getParentModel().renderToBuffer(pose, buffer, light, ${overlay}, 1.0F, 1.0F, 1.0F, 1.0F);`;
  return `this.addLayer(new net.minecraft.client.renderer.entity.layers.LayerRenderer<${input.entity}, ${M}>(this) {
            private final net.minecraft.util.ResourceLocation texture = ${idExpr(env, layerTexture(env, row, input.e, i))};${own ? `\n            private final ${own}<${input.entity}> model = new ${own}<>();` : ""}

            @Override
            public void render(com.mojang.blaze3d.matrix.MatrixStack pose, net.minecraft.client.renderer.IRenderTypeBuffer buffers, int light, ${input.entity} entity, float limbSwing, float limbSwingAmount, float partialTicks, float ageInTicks, float netHeadYaw, float headPitch) {
                ${cond ? `if (!(${cond})) return;\n                ` : ""}com.mojang.blaze3d.vertex.IVertexBuilder buffer = buffers.getBuffer(net.minecraft.client.renderer.RenderType.${type}(this.texture));
                ${draw}
            }
        });`;
}

function layerModern(env: GenEnv, input: RenderInput, row: Record<string, unknown>, i: number, M: string, rowCond: RowCond): string {
  const own = layerModel(env, input, row);
  const cond = rowCond(row, "state.entity");
  const id = env.mc === "26.3" ? "net.minecraft.resources.Identifier" : "net.minecraft.resources.ResourceLocation";
  const overlay = row.disableHurtOverlay === true ? "net.minecraft.client.renderer.texture.OverlayTexture.NO_OVERLAY" : "net.minecraft.client.renderer.entity.LivingEntityRenderer.getOverlayCoords(state, 0.0F)";
  const types = env.mc === "26.3" ? "net.minecraft.client.renderer.rendertype.RenderTypes" : "net.minecraft.client.renderer.RenderType";
  const type = row.glow === true ? "eyes" : env.mc === "26.3" ? "entityCutout" : "entityCutoutNoCull";
  const model = own ? "this.model" : "this.getParentModel()";
  const setup = own ? "this.model.setupAnim(state);\n                " : "";
  const guard = cond ? `if (state.entity == null || !(${cond})) return;\n                ` : "";
  const body = env.mc === "26.3"
    ? `${guard}${setup}collector.submitModel(${model}, state, pose, ${types}.${type}(this.texture), light, ${overlay}, state.outlineColor);`
    : `${guard}${setup}${model}.renderToBuffer(pose, buffers.getBuffer(${types}.${type}(this.texture)), light, ${overlay});`;
  const signature = env.mc === "26.3"
    ? "public void submit(com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.SubmitNodeCollector collector, int light, State state, float yRot, float xRot)"
    : "public void render(com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.MultiBufferSource buffers, int light, State state, float yRot, float xRot)";
  return `this.addLayer(new net.minecraft.client.renderer.entity.layers.RenderLayer<State, ${M}>(this) {
            private final ${id} texture = ${idExpr(env, layerTexture(env, row, input.e, i))};${own ? `\n            private final ${own} model = new ${own}(context.bakeLayer(${own}.LAYER_LOCATION));` : ""}

            @Override
            ${signature} {
                ${body}
            }
        });`;
}

/** Textures a renderer uses besides the main one: layer textures. */
export function layerTextures(e: Element): { from: string; to: string }[] {
  return list<Record<string, unknown>>(e.modelLayers).map((row, i) => ({ row, i })).filter(({ row }) => str(row.texture)).map(({ row, i }) => ({ from: str(row.texture), to: `entity/${e.id}_layer_${i}` }));
}
