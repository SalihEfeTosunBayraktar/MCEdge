import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Element } from "../elements/model.ts";
import { beClass, typeExpr } from "./blockInventory.ts";
import { idClass, idExpr, jfloat, jstr, pascal } from "./java.ts";
import { animatorClass, findAnimation, loadModel, modelClass, modelExists, modelOutputs } from "./mob/models.ts";
import { projectModelKind } from "./models.ts";
import { procedureBuild, procedureCallById } from "./procedures.ts";
import type { GenEnv, JavaSourceFile } from "./typeModule.ts";

/**
 * Java (entity) models on blocks and items: a Blockbench Java model (models/<name>.java, or a .bbmodel for blocks)
 * drawn with the element's texture, like MCreator's "Java model" type.
 *
 * Blocks (model type 4) get a block entity (the inventory block entity, without slots when the block has none) and a
 * block entity renderer that draws the model turned to the block's facing, with the element's animations playing
 * while their condition holds (MCEdge's keyframe sampler, <Mod>Animator). Items, tools (also a shield's blocking
 * model) and the items of such blocks are drawn by an item renderer: Forge 1.16.5's ItemStackTileEntityRenderer
 * (builtin/entity item model), and on 1.21.5 and 26.3 a special model renderer ("minecraft:special" item model)
 * registered through NeoForge's event or, on Fabric, which has no API for it, a client mixin.
 *
 * The model's root sits on the floor of the block (entity space: 24 pixels up is the ground), centred, its front
 * facing north when the block has no facing.
 */

const usages = new WeakMap<object, Map<string, Uses>>();
interface ItemUse { key: string; model: string; texture: string; blocking?: { model: string }; animations?: Record<string, unknown>[] }
interface BlockUse { block: Element; model: string; texture: string; translucent: boolean }
interface Uses { items: ItemUse[]; blocks: BlockUse[] }
function uses(env: GenEnv): Uses {
  const perProject = usages.get(env.generated) ?? new Map<string, Uses>();
  usages.set(env.generated, perProject);
  let known = perProject.get(env.engine.id);
  if (!known) perProject.set(env.engine.id, (known = { items: [], blocks: [] }));
  return known;
}

/** Whether an item model field names a Java model (models/<name>.java with no JSON/OBJ model of that name). */
export const isJavaItemModel = (env: GenEnv, name: string) =>
  !!name && /^[A-Za-z0-9_]+$/.test(name) && !projectModelKind(env, name) && existsSync(join(env.projectDir, "models", `${name}.java`));

/** Project models drawn by block entity and item renderers, for the model classes. */
export function javaModelNames(env: GenEnv): string[] {
  const names: string[] = [];
  for (const b of env.generated.block ?? []) if (!String(b.blockBase ?? "") && Number(b.renderType) === 4) names.push(String(b.customModelName ?? ""));
  for (const i of env.generated.item ?? []) if (isJavaItemModel(env, String(i.model ?? ""))) names.push(String(i.model));
  for (const t of env.generated.tool ?? []) for (const k of ["model", "blockingModel"]) if (isJavaItemModel(env, String(t[k] ?? ""))) names.push(String(t[k]));
  return names.filter((n) => modelExists(env, n));
}

const DISPLAY = {
  gui: { rotation: [30, 45, 0], translation: [0, -1.5, 0], scale: [0.5, 0.5, 0.5] },
  ground: { translation: [0, 3, 0], scale: [0.25, 0.25, 0.25] },
  fixed: { scale: [0.5, 0.5, 0.5] },
  head: { translation: [0, 13, 7], scale: [1, 1, 1] },
  thirdperson_righthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
  thirdperson_lefthand: { rotation: [75, 45, 0], translation: [0, 2.5, 0], scale: [0.375, 0.375, 0.375] },
  firstperson_righthand: { rotation: [0, 45, 0], scale: [0.4, 0.4, 0.4] },
  firstperson_lefthand: { rotation: [0, 225, 0], scale: [0.4, 0.4, 0.4] },
};

export interface JavaItemModel {
  /** Item.Properties calls (1.16.5: the item renderer). */
  props: string[];
  /** models/item/<key>.json: transforms and particle texture. */
  modelJson: Record<string, unknown>;
  /** 1.21.5+ items/<id>.json "model" value. */
  definition: Record<string, unknown>;
}

const rendererClass = (env: GenEnv, key: string) => `${env.project.mod.package}.client.${pascal(key)}ItemRenderer`;

/**
 * An item drawn with a Java model (`model`), its texture `texture` ("<modid>:textures/item/x.png"); `key` names
 * the renderer and item model ("ruby_wand"). On 1.16.5 a shield's one renderer can also draw `blocking` while the
 * local player blocks with it; later versions register a renderer per model (`<key>_blocking`).
 */
export function javaItemModel(env: GenEnv, key: string, model: string, texture: string, blocking?: string, animations?: unknown): JavaItemModel {
  uses(env).items.push({ key, model, texture, blocking: blocking ? { model: blocking } : undefined, animations: Array.isArray(animations) ? (animations as Record<string, unknown>[]) : [] });
  const particle = texture.replace(/^(\w+):textures\/(.*)\.png$/, "$1:$2");
  const special = (k: string) => ({ type: "minecraft:special", base: `${env.modId}:item/${k}`, model: { type: `${env.modId}:${k}` } });
  return {
    props: env.mc === "1.16.5" ? [`.setISTER(() -> ${rendererClass(env, key)}::new)`] : [],
    modelJson: env.mc === "1.16.5" ? { parent: "builtin/entity", textures: { particle }, display: DISPLAY } : { textures: { particle }, gui_light: "front", display: DISPLAY },
    definition: special(key),
  };
}

/** A block drawn by a block entity renderer with its Java model; returns false (warned) when the model is missing. */
export function javaBlockModel(env: GenEnv, block: Element, texture: string): boolean {
  const model = String(block.customModelName ?? "");
  if (!modelExists(env, model)) {
    procedureBuild(env).warnings.push(`block/${block.id}: Java model "${model}" is not a project model (models/${model}.java or .bbmodel); the block is drawn as a cube`);
    return false;
  }
  uses(env).blocks.push({ block, model, texture, translucent: block.hasTransparency === true && block.transparencyType === "TRANSLUCENT" });
  return true;
}

export interface JavaModelOutputs { sources: JavaSourceFile[]; clientInit: string[]; mixins: { id: string; code: string; client?: boolean }[] }

export function javaModelOutputs(env: GenEnv): JavaModelOutputs {
  const { items, blocks } = uses(env);
  const out: JavaModelOutputs = { sources: [], clientInit: [], mixins: [] };
  // Model classes and the animator, when no entity or armor type wrote them.
  const models = modelOutputs(env, "models");
  out.sources.push(...models.sources);
  out.clientInit.push(...models.clientInit);
  for (const b of blocks) {
    out.sources.push(blockRenderer(env, b));
    out.clientInit.push(...blockRegistration(env, b));
  }
  const renderers = items;
  for (const r of renderers) out.sources.push(itemRenderer(env, r));
  if (env.mc !== "1.16.5" && renderers.length) {
    if (env.loader === "neoforge") {
      out.clientInit.push(`modBus.addListener(net.neoforged.neoforge.client.event.RegisterSpecialModelRendererEvent.class, event -> {
${renderers.map((r) => `            event.register(${idExpr(env, `${env.modId}:${r.key}`)}, ${rendererClass(env, r.key)}.Unbaked.MAP_CODEC);`).join("\n")}
        });`);
    } else out.mixins.push({ id: "SpecialModelRenderersMixin", code: specialRenderersMixin(env, renderers.map((r) => r.key)), client: true });
  }
  return out;
}

// ---- Blocks

const rendererName = (b: BlockUse) => `${pascal(b.block.id)}BlockRenderer`;

/** Animation statements for `bones` at `seconds`, each guarded by its condition flag `playing[i]`. */
function animations(env: GenEnv, b: BlockUse): { index: number; speed: string; cond?: string }[] {
  const m = loadModel(env, b.model);
  const rows = Array.isArray(b.block.animations) ? (b.block.animations as Record<string, unknown>[]) : [];
  const deps = { x: "pos.getX()", y: "pos.getY()", z: "pos.getZ()", world: "world", blockstate: "blockstate" };
  return rows.flatMap((row) => {
    const index = findAnimation(m, String(row.animation ?? ""));
    if (index < 0) {
      procedureBuild(env).warnings.push(`block/${b.block.id}: animation "${String(row.animation ?? "")}" is not in project model "${b.model}"`);
      return [];
    }
    const cond = procedureCallById(env, row.condition, deps, `block/${b.block.id}: animation condition`, "logic");
    return [{ index, speed: jfloat(Number(row.speed) || 1), cond }];
  });
}

/** Animations of an item's Java model; conditions run on the client with the local player and the stack. */
function itemAnimations(env: GenEnv, r: ItemUse): { index: number; speed: string; cond?: string }[] {
  if (!r.animations?.length) return [];
  const m = loadModel(env, r.model);
  const deps = { x: "entity.getX()", y: "entity.getY()", z: "entity.getZ()", world: "world", entity: "entity", itemstack: "stack" };
  return r.animations.flatMap((row) => {
    const index = findAnimation(m, String(row.animation ?? ""));
    if (index < 0) {
      procedureBuild(env).warnings.push(`item/${r.key}: animation "${String(row.animation ?? "")}" is not in project model "${r.model}"`);
      return [];
    }
    const cond = procedureCallById(env, row.condition, deps, `item/${r.key}: animation condition`, "logic");
    return [{ index, speed: jfloat(Number(row.speed) || 1), cond }];
  });
}

/** Facing of a block state in degrees (vanilla yaw), 180 (north) when it has no horizontal facing. */
function yawMethod(env: GenEnv): string {
  const legacy = env.mc === "1.16.5";
  const S = legacy ? "net.minecraft.block.BlockState" : "net.minecraft.world.level.block.state.BlockState";
  const P = legacy ? "net.minecraft.state.properties.BlockStateProperties" : "net.minecraft.world.level.block.state.properties.BlockStateProperties";
  return `    private static float yaw(${S} state) {
        if (state.hasProperty(${P}.HORIZONTAL_FACING)) return state.getValue(${P}.HORIZONTAL_FACING).toYRot();
        if (state.hasProperty(${P}.FACING) && state.getValue(${P}.FACING).getAxis().isHorizontal()) return state.getValue(${P}.FACING).toYRot();
        return 180.0F;
    }`;
}

function blockRenderer(env: GenEnv, b: BlockUse): JavaSourceFile {
  const pkg = `${env.project.mod.package}.client`;
  const cls = rendererName(b);
  const M = modelClass(env, b.model);
  const A = animatorClass(env);
  const BE = `${env.project.mod.package}.block.entity.${beClass(b.block)}`;
  const anims = animations(env, b);
  const id = idClass(env);
  const texture = idExpr(env, b.texture);
  const apply = (bones: string, seconds: string, playing: (i: number) => string) => anims.map((a, i) => {
    const call = `${A}.apply(${bones}, ${M}.ANIMATIONS[${a.index}], ${seconds} * ${a.speed}, 1.0F);`;
    return a.cond ? `if (${playing(i)}) ${call}` : call;
  });
  let code: string;
  if (env.mc === "1.16.5") {
    const type = b.translucent ? "entityTranslucent" : "entityCutoutNoCull";
    code = `package ${pkg};

/** Generated by MCEdge: draws ${b.block.id} with its Java model (models/${b.model}). */
public class ${cls} extends net.minecraft.client.renderer.tileentity.TileEntityRenderer<${BE}> {
    private static final ${id} TEXTURE = ${texture};
    private final ${M}<net.minecraft.entity.Entity> model = new ${M}<>();

    public ${cls}(net.minecraft.client.renderer.tileentity.TileEntityRendererDispatcher dispatcher) {
        super(dispatcher);
    }

    @Override
    public void render(${BE} blockEntity, float partialTicks, com.mojang.blaze3d.matrix.MatrixStack pose, net.minecraft.client.renderer.IRenderTypeBuffer buffers, int light, int overlay) {
        net.minecraft.world.World world = blockEntity.getLevel();
        net.minecraft.util.math.BlockPos pos = blockEntity.getBlockPos();
        net.minecraft.block.BlockState blockstate = blockEntity.getBlockState();
        float seconds = world == null ? 0.0F : (world.getGameTime() + partialTicks) / 20.0F;
        this.model.resetBones();
${world(anims.length, apply("this.model.bones", "seconds", (i) => `(${anims[i].cond})`))}
        pose.pushPose();
        pose.translate(0.5D, 0.0D, 0.5D);
        pose.mulPose(net.minecraft.util.math.vector.Vector3f.YP.rotationDegrees(180.0F - yaw(blockstate)));
        pose.translate(0.0D, 1.5D, 0.0D);
        pose.scale(-1.0F, -1.0F, 1.0F);
        this.model.renderToBuffer(pose, buffers.getBuffer(net.minecraft.client.renderer.RenderType.${type}(TEXTURE)), light, overlay, 1.0F, 1.0F, 1.0F, 1.0F);
        pose.popPose();
    }

${yawMethod(env)}
}
`;
  } else if (env.mc === "1.21.5") {
    const type = b.translucent ? "entityTranslucent" : "entityCutoutNoCull";
    code = `package ${pkg};

/** Generated by MCEdge: draws ${b.block.id} with its Java model (models/${b.model}). */
public class ${cls} implements net.minecraft.client.renderer.blockentity.BlockEntityRenderer<${BE}> {
    private static final ${id} TEXTURE = ${texture};
    private final ${M} model = new ${M}(${M}.createBodyLayer().bakeRoot());

    public ${cls}(net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider.Context context) {
    }

    @Override
    public void render(${BE} blockEntity, float partialTicks, com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.MultiBufferSource buffers, int light, int overlay, net.minecraft.world.phys.Vec3 camera) {
        net.minecraft.world.level.Level world = blockEntity.getLevel();
        net.minecraft.core.BlockPos pos = blockEntity.getBlockPos();
        net.minecraft.world.level.block.state.BlockState blockstate = blockEntity.getBlockState();
        float seconds = world == null ? 0.0F : (world.getGameTime() + partialTicks) / 20.0F;
        this.model.resetBones();
${world(anims.length, apply("this.model.bones", "seconds", (i) => `(${anims[i].cond})`))}
        pose.pushPose();
        pose.translate(0.5D, 0.0D, 0.5D);
        pose.mulPose(com.mojang.math.Axis.YP.rotationDegrees(180.0F - yaw(blockstate)));
        pose.translate(0.0D, 1.5D, 0.0D);
        pose.scale(-1.0F, -1.0F, 1.0F);
        this.model.renderToBuffer(pose, buffers.getBuffer(net.minecraft.client.renderer.RenderType.${type}(TEXTURE)), light, overlay);
        pose.popPose();
    }

${yawMethod(env)}
}
`;
  } else {
    const type = b.translucent ? "entityTranslucent" : "entityCutout";
    const S = "net.minecraft.client.renderer.entity.state.LivingEntityRenderState";
    code = `package ${pkg};

/** Generated by MCEdge: draws ${b.block.id} with its Java model (models/${b.model}). */
public class ${cls} implements net.minecraft.client.renderer.blockentity.BlockEntityRenderer<${BE}, ${cls}.State> {
    private static final ${id} TEXTURE = ${texture};
    private final Model model = new Model(${M}.createBodyLayer().bakeRoot());

    /** What the renderer needs from the block entity: its facing and the animation time and flags. */
    public static class State extends net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState {
        float yaw = 180.0F;
        final Pose pose = new Pose();
    }

    /** The model's state: animation time and which animations play. */
    public static class Pose extends ${S} {
        float seconds;
        final boolean[] playing = new boolean[${Math.max(1, anims.length)}];
    }

    /** The project model with the block's animations. */
    static class Model extends ${M} {
        Model(net.minecraft.client.model.geom.ModelPart root) {
            super(root);
        }

        @Override
        public void setupAnim(${S} state) {
            super.setupAnim(state);
            if (!(state instanceof Pose p)) return;
${apply("this.bones", "p.seconds", (i) => `p.playing[${i}]`).map((l) => `            ${l}`).join("\n")}
        }
    }

    public ${cls}(net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider.Context context) {
    }

    @Override
    public State createRenderState() {
        return new State();
    }

    @Override
    public void extractRenderState(${BE} blockEntity, State state, float partialTicks, net.minecraft.world.phys.Vec3 camera, net.minecraft.client.renderer.feature.ModelFeatureRenderer.CrumblingOverlay breakProgress) {
        net.minecraft.client.renderer.blockentity.BlockEntityRenderer.super.extractRenderState(blockEntity, state, partialTicks, camera, breakProgress);
        net.minecraft.world.level.Level world = blockEntity.getLevel();
        net.minecraft.core.BlockPos pos = blockEntity.getBlockPos();
        net.minecraft.world.level.block.state.BlockState blockstate = blockEntity.getBlockState();
        state.yaw = yaw(blockstate);
        state.pose.seconds = world == null ? 0.0F : (world.getGameTime() + partialTicks) / 20.0F;
${anims.map((a, i) => `        state.pose.playing[${i}] = ${a.cond ? `world != null && (${a.cond})` : "true"};`).join("\n")}
    }

    @Override
    public void submit(State state, com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.SubmitNodeCollector collector, net.minecraft.client.renderer.state.level.CameraRenderState camera) {
        pose.pushPose();
        pose.translate(0.5D, 0.0D, 0.5D);
        pose.rotate(com.mojang.math.Axis.YP.rotationDegrees(180.0F - state.yaw));
        pose.translate(0.0D, 1.5D, 0.0D);
        pose.scale(-1.0F, -1.0F, 1.0F);
        collector.submitModel(this.model, state.pose, pose, net.minecraft.client.renderer.rendertype.RenderTypes.${type}(TEXTURE), state.lightCoords, net.minecraft.client.renderer.texture.OverlayTexture.NO_OVERLAY, 0);
        pose.popPose();
    }

${yawMethod(env)}
}
`;
  }
  return { path: `${pkg.replaceAll(".", "/")}/${cls}.java`, code };
}

/** Statements run with world, pos and blockstate in scope; conditions only when the world is known. */
function world(count: number, lines: string[]): string {
  if (!count) return "";
  return `        if (world != null) {\n${lines.map((l) => `            ${l}`).join("\n")}\n        }`;
}

function blockRegistration(env: GenEnv, b: BlockUse): string[] {
  const R = `${env.project.mod.package}.client.${rendererName(b)}`;
  const type = typeExpr(env, b.block);
  if (env.mc === "1.16.5") return [`modBus.addListener((net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent event) -> net.minecraftforge.fml.client.registry.ClientRegistry.bindTileEntityRenderer(${type}, ${R}::new));`];
  if (env.loader === "neoforge") {
    return [`modBus.addListener(net.neoforged.neoforge.client.event.EntityRenderersEvent.RegisterRenderers.class, event -> event.registerBlockEntityRenderer(${type}, ${R}::new));`];
  }
  return [`net.minecraft.client.renderer.blockentity.BlockEntityRenderers.register(${type}, ${R}::new);`];
}

// ---- Items

/** Pose of an item model: the model's floor at the bottom of the item space, centred. */
const ITEM_POSE = ["pose.translate(0.5D, 1.5D, 0.5D);", "pose.scale(1.0F, -1.0F, -1.0F);"];

function itemRenderer(env: GenEnv, r: ItemUse): JavaSourceFile {
  const pkg = `${env.project.mod.package}.client`;
  const cls = rendererClass(env, r.key).slice(pkg.length + 1);
  const M = modelClass(env, r.model);
  // Item animations play on real time; each row's condition is read from the local player and the stack.
  const anims = itemAnimations(env, r);
  const A = anims.length ? animatorClass(env) : "";
  const legacy = env.mc === "1.16.5";
  const mc = "net.minecraft.client.Minecraft.getInstance()";
  const clientVars = `${legacy ? "net.minecraft.entity.Entity" : "net.minecraft.world.entity.Entity"} entity = ${mc}.player;
        ${legacy ? "net.minecraft.world.World" : "net.minecraft.world.level.Level"} world = ${mc}.level;
        float seconds = (System.currentTimeMillis() % 3600000L) / 1000.0F;`;
  const pose = (bones: string) => anims.length ? `
        ${clientVars}
        this.model.resetBones();
        if (world != null && entity != null) {
${anims.map((a) => `            ${a.cond ? `if (${a.cond}) ` : ""}${A}.apply(${bones}, ${M}.ANIMATIONS[${a.index}], seconds * ${a.speed}, 1.0F);`).join("\n")}
        }` : "";
  const id = idClass(env);
  const texture = idExpr(env, r.texture);
  let code: string;
  if (env.mc === "1.16.5") {
    const B = r.blocking ? modelClass(env, r.blocking.model) : "";
    const pick = r.blocking
      ? `net.minecraft.client.entity.player.ClientPlayerEntity player = net.minecraft.client.Minecraft.getInstance().player;
        net.minecraft.client.renderer.entity.model.EntityModel<net.minecraft.entity.Entity> model = player != null && player.isUsingItem() && player.getUseItem() == stack ? this.blocking : this.model;`
      : "net.minecraft.client.renderer.entity.model.EntityModel<net.minecraft.entity.Entity> model = this.model;";
    code = `package ${pkg};

/** Generated by MCEdge: draws the item with its Java model (models/${r.model}). */
public class ${cls} extends net.minecraft.client.renderer.tileentity.ItemStackTileEntityRenderer {
    private static final ${id} TEXTURE = ${texture};
    private final ${M}<net.minecraft.entity.Entity> model = new ${M}<>();${r.blocking ? `\n    private final ${B}<net.minecraft.entity.Entity> blocking = new ${B}<>();` : ""}

    @Override
    public void renderByItem(net.minecraft.item.ItemStack stack, net.minecraft.client.renderer.model.ItemCameraTransforms.TransformType transform, com.mojang.blaze3d.matrix.MatrixStack pose, net.minecraft.client.renderer.IRenderTypeBuffer buffers, int light, int overlay) {
        ${pick}${pose("this.model.bones")}
        pose.pushPose();
        ${ITEM_POSE.join("\n        ")}
        model.renderToBuffer(pose, net.minecraft.client.renderer.ItemRenderer.getFoilBufferDirect(buffers, net.minecraft.client.renderer.RenderType.entityCutoutNoCull(TEXTURE), false, stack.hasFoil()), light, overlay, 1.0F, 1.0F, 1.0F, 1.0F);
        pose.popPose();
    }
}
`;
  } else if (env.mc === "1.21.5") {
    code = `package ${pkg};

/** Generated by MCEdge: draws the item with its Java model (models/${r.model}). */
public class ${cls} implements net.minecraft.client.renderer.special.SpecialModelRenderer<Object> {
    private static final ${id} TEXTURE = ${texture};
    private final ${M} model = new ${M}(${M}.createBodyLayer().bakeRoot());

    @Override
    public void render(Object argument, net.minecraft.world.item.ItemDisplayContext context, com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.MultiBufferSource buffers, int light, int overlay, boolean glint) {
        this.model.resetBones();${anims.length ? `
        net.minecraft.world.item.ItemStack stack = (net.minecraft.world.item.ItemStack) argument;${pose("this.model.bones")}` : ""}
        pose.pushPose();
        ${ITEM_POSE.join("\n        ")}
        this.model.renderToBuffer(pose, net.minecraft.client.renderer.entity.ItemRenderer.getFoilBuffer(buffers, net.minecraft.client.renderer.RenderType.entityCutoutNoCull(TEXTURE), false, glint), light, overlay);
        pose.popPose();
    }

    @Override
    public Object extractArgument(net.minecraft.world.item.ItemStack stack) {
        return ${anims.length ? "stack" : "null"};
    }

    public record Unbaked() implements net.minecraft.client.renderer.special.SpecialModelRenderer.Unbaked {
        public static final com.mojang.serialization.MapCodec<Unbaked> MAP_CODEC = com.mojang.serialization.MapCodec.unit(new Unbaked());

        @Override
        public net.minecraft.client.renderer.special.SpecialModelRenderer<?> bake(net.minecraft.client.model.geom.EntityModelSet models) {
            return new ${cls}();
        }

        @Override
        public com.mojang.serialization.MapCodec<Unbaked> type() {
            return MAP_CODEC;
        }
    }
}
`;
  } else {
    code = `package ${pkg};

/** Generated by MCEdge: draws the item with its Java model (models/${r.model}). */
public class ${cls} implements net.minecraft.client.renderer.special.SpecialModelRenderer<Object> {
    private static final ${id} TEXTURE = ${texture};
${anims.length ? `    private final Model model = new Model(${M}.createBodyLayer().bakeRoot());

    /** Animation time and which animations play, read when the item is drawn. */
    public static class Pose extends net.minecraft.client.renderer.entity.state.LivingEntityRenderState {
        float seconds;
        final boolean[] playing = new boolean[${anims.length}];
    }

    /** The project model posed by the item's animations. */
    static class Model extends ${M} {
        Model(net.minecraft.client.model.geom.ModelPart root) {
            super(root);
        }

        @Override
        public void setupAnim(net.minecraft.client.renderer.entity.state.LivingEntityRenderState state) {
            super.setupAnim(state);
            if (!(state instanceof Pose p)) return;
${anims.map((a, i) => `            if (p.playing[${i}]) ${A}.apply(this.bones, ${M}.ANIMATIONS[${a.index}], p.seconds * ${a.speed}, 1.0F);`).join("\n")}
        }
    }` : `    private final ${M} model = new ${M}(${M}.createBodyLayer().bakeRoot());`}

    @Override
    public void submit(Object argument, com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.SubmitNodeCollector collector, int light, int overlay, boolean foil, int outline) {
        pose.pushPose();
        ${ITEM_POSE.join("\n        ")}
        collector.submitModel(this.model, ${anims.length ? "(Pose) argument" : "new net.minecraft.client.renderer.entity.state.LivingEntityRenderState()"}, pose, net.minecraft.client.renderer.rendertype.RenderTypes.entityCutout(TEXTURE), light, overlay, outline);
        pose.popPose();
    }

    @Override
    public void getExtents(java.util.function.Consumer<org.joml.Vector3fc> output) {
        output.accept(new org.joml.Vector3f(0.0F, 0.0F, 0.0F));
        output.accept(new org.joml.Vector3f(1.0F, 1.5F, 1.0F));
    }

    @Override
    public Object extractArgument(net.minecraft.world.item.ItemStack stack) {${anims.length ? `
        ${clientVars}
        Pose state = new Pose();
        state.seconds = seconds;
${anims.map((a, i) => `        state.playing[${i}] = world != null && entity != null${a.cond ? ` && (${a.cond})` : ""};`).join("\n")}
        return state;` : `
        return null;`}
    }

    public record Unbaked() implements net.minecraft.client.renderer.special.SpecialModelRenderer.Unbaked<Object> {
        public static final com.mojang.serialization.MapCodec<Unbaked> MAP_CODEC = com.mojang.serialization.MapCodec.unit(new Unbaked());

        @Override
        public net.minecraft.client.renderer.special.SpecialModelRenderer<Object> bake(net.minecraft.client.renderer.special.SpecialModelRenderer.BakingContext context) {
            return new ${cls}();
        }

        @Override
        public com.mojang.serialization.MapCodec<Unbaked> type() {
            return MAP_CODEC;
        }
    }
}
`;
  }
  return { path: `${pkg.replaceAll(".", "/")}/${cls}.java`, code };
}

/** Fabric: registers the item renderers' codecs next to the vanilla special model renderers. */
function specialRenderersMixin(env: GenEnv, keys: string[]): string {
  const mixin = "org.spongepowered.asm.mixin";
  const id = idClass(env);
  const unbaked = env.mc === "26.3" ? "net.minecraft.client.renderer.special.SpecialModelRenderer.Unbaked<?>" : "net.minecraft.client.renderer.special.SpecialModelRenderer.Unbaked";
  return `package ${env.project.mod.package}.mixin;

/** Generated by MCEdge. Registers the mod's item renderers for "minecraft:special" item models (Fabric has no API for it). */
@${mixin}.Mixin(net.minecraft.client.renderer.special.SpecialModelRenderers.class)
public abstract class SpecialModelRenderersMixin {
    @${mixin}.Shadow
    @${mixin}.Final
    private static net.minecraft.util.ExtraCodecs.LateBoundIdMapper<${id}, com.mojang.serialization.MapCodec<? extends ${unbaked}>> ID_MAPPER;

    @${mixin}.injection.Inject(method = "bootstrap", at = @${mixin}.injection.At("TAIL"))
    private static void ${env.modId}$register(org.spongepowered.asm.mixin.injection.callback.CallbackInfo info) {
${keys.map((k) => `        ID_MAPPER.put(${id}.parse(${jstr(`${env.modId}:${k}`)}), ${rendererClass(env, k)}.Unbaked.MAP_CODEC);`).join("\n")}
    }
}
`;
}
