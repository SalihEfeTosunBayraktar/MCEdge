import type { Element } from "../../elements/model.ts";
import { derivedConstant, idExpr, jfloat, jstr, pascal, qualify, str, tooltipMethod, vanillaTab1165 } from "../java.ts";
import { procedureCall, procedureMembers } from "../procedures.ts";
import { modClassName, registryClassName } from "../registries.ts";
import type { ElementContext, GenEnv, JavaSourceFile, ResourceFile, TypeModule } from "../typeModule.ts";
import { MAP_COLORS, TINT_COLORS, terracotta, tintSource } from "./block.ts";

/**
 * Fluids: a source and a flowing fluid, their liquid block and bucket, registered together in <Mod>Fluids.
 * NeoForge describes the fluid with a FluidType (physics, sounds, light) and client extensions (textures, tint,
 * fog, screen overlay); Forge 1.16.5 with FluidAttributes and client fog events; Fabric with a plain FlowingFluid
 * and its fluid renderer. Lava-type fluids join the minecraft:lava fluid tag on every engine (burning, lava
 * movement, obsidian); water-type fluids join minecraft:water where the loader has no fluid types (1.16.5,
 * Fabric). Fabric has no fog or screen overlay API, so mixins add them; its fluid attributes (transfer API) carry light,
 * temperature, viscosity and density, and the flow strength is applied in the liquid block; 1.16.5 Forge draws only the water overlay, so
 * the fluid's own is drawn before the HUD.
 */

const REG = "Fluids";

const lava = (f: Element) => f.type === "LAVA";
const tintOf = (f: Element) => (str(f.tintType) === "No tint" ? "" : str(f.tintType));
const rgb = (color: string) => {
  const n = parseInt(color.replace("#", ""), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round((c / 255) * 1000) / 1000);
};

interface Refs {
  owner: string;
  C: string;
  source: string;
  flowing: string;
  block: string;
  bucket: string;
  type: string;
}

function refs(env: GenEnv, f: Element): Refs {
  const owner = registryClassName(env, REG);
  const C = String(f.id).toUpperCase();
  const get = env.loader === "fabric" ? "" : ".get()";
  return {
    owner, C,
    source: `${owner}.${C}${get}`,
    flowing: `${owner}.FLOWING_${C}${get}`,
    block: `${owner}.${derivedConstant(C, "Block")}${get}`,
    bucket: `${owner}.${derivedConstant(C, "Bucket")}${get}`,
    type: `${owner}.${derivedConstant(C, "Type")}${get}`,
  };
}

/** Java names per generation. */
function names(env: GenEnv) {
  if (env.mc === "1.16.5") {
    return {
      state: "net.minecraft.block.BlockState", fluidState: "net.minecraft.fluid.FluidState", fluid: "net.minecraft.fluid.Fluid",
      flowing: "net.minecraft.fluid.FlowingFluid", world: "net.minecraft.world.IWorld", pos: "net.minecraft.util.math.BlockPos",
      dir: "net.minecraft.util.Direction", particle: "net.minecraft.particles.IParticleData", item: "net.minecraft.item",
      sound: "net.minecraft.util.SoundEvent", sounds: "net.minecraft.util.SoundEvents", id: "net.minecraft.util.ResourceLocation",
    };
  }
  return {
    state: "net.minecraft.world.level.block.state.BlockState", fluidState: "net.minecraft.world.level.material.FluidState",
    fluid: "net.minecraft.world.level.material.Fluid", flowing: "net.minecraft.world.level.material.FlowingFluid",
    world: "net.minecraft.world.level.LevelAccessor", pos: "net.minecraft.core.BlockPos", dir: "net.minecraft.core.Direction",
    particle: "net.minecraft.core.particles.ParticleOptions", item: "net.minecraft.world.item", sound: "net.minecraft.sounds.SoundEvent",
    sounds: "net.minecraft.sounds.SoundEvents", id: env.mc === "26.3" ? "net.minecraft.resources.Identifier" : "net.minecraft.resources.ResourceLocation",
  };
}

const textureId = (env: GenEnv, f: Element, kind: "still" | "flow") => `${env.modId}:block/${f.id}_${kind}`;

function soundExpr(env: GenEnv, sound: string): string {
  const id = idExpr(env, qualify(env, sound));
  return env.mc === "1.16.5"
    ? `net.minecraftforge.registries.ForgeRegistries.SOUND_EVENTS.getValue(${id})`
    : `net.minecraft.core.registries.BuiltInRegistries.SOUND_EVENT.getValue(${id})`;
}

function element(fluid: Element, env: GenEnv): ElementContext {
  const id = String(fluid.id);
  const name = str(fluid.name) || id;
  const bucket = fluid.generateBucket === true;
  const textures: NonNullable<ElementContext["textures"]> = [];
  if (str(fluid.textureStill)) textures.push({ from: str(fluid.textureStill), to: `block/${id}_still` });
  if (str(fluid.textureFlowing)) textures.push({ from: str(fluid.textureFlowing), to: `block/${id}_flow` });
  if (str(fluid.textureRenderOverlay)) textures.push({ from: str(fluid.textureRenderOverlay), to: `misc/${id}_overlay` });
  if (bucket && str(fluid.textureBucket)) textures.push({ from: str(fluid.textureBucket), to: `item/${id}_bucket` });
  const bucketTexture = str(fluid.textureBucket) ? `${env.modId}:item/${id}_bucket` : `minecraft:item/${lava(fluid) ? "lava" : "water"}_bucket`;
  const files: ResourceFile[] = [
    { path: `assets/${env.modId}/blockstates/${id}.json`, json: JSON.stringify({ variants: { "": { model: `${env.modId}:block/${id}` } } }, null, 2) },
    { path: `assets/${env.modId}/models/block/${id}.json`, json: JSON.stringify({ textures: { particle: textureId(env, fluid, "still") } }, null, 2) },
  ];
  if (bucket) {
    files.push({ path: `assets/${env.modId}/models/item/${id}_bucket.json`, json: JSON.stringify({ parent: "minecraft:item/generated", textures: { layer0: bucketTexture } }, null, 2) });
    if (env.mc !== "1.16.5") files.push({ path: `assets/${env.modId}/items/${id}_bucket.json`, json: JSON.stringify({ model: { type: "minecraft:model", model: `${env.modId}:item/${id}_bucket` } }, null, 2) });
  }
  const tagged = lava(fluid) ? "minecraft:lava" : env.loader !== "neoforge" ? "minecraft:water" : "";
  const r = refs(env, fluid);
  return {
    lang: {
      [`block.${env.modId}.${id}`]: name,
      [`fluid.${env.modId}.${id}`]: name,
      [`fluid_type.${env.modId}.${id}`]: name,
      ...(bucket ? { [`item.${env.modId}.${id}_bucket`]: str(fluid.bucketName) || `${name} Bucket` } : {}),
    },
    textures,
    files,
    tags: tagged ? [
      { registry: "fluid", tag: tagged, value: `${env.modId}:${id}` },
      { registry: "fluid", tag: tagged, value: `${env.modId}:flowing_${id}` },
    ] : [],
    tabItems: bucket ? [r.bucket] : [],
    ...(env.loader === "fabric" ? { init: [fabricAttributes(env, fluid)] } : {}),
    ...(env.loader === "fabric" ? { mixins: [
      ...(fluid.hasFog === true ? [fabricFogMixin(env, fluid)] : []),
      ...(str(fluid.textureRenderOverlay) ? [fabricOverlayMixin(env, fluid)] : []),
    ] } : {}),
  };
}

/** Fabric has no fluid fog API: a mixin on the fog renderer applies the fluid's fog color and distances. */
function fabricFogMixin(env: GenEnv, f: Element): { id: string; code: string; client: boolean } {
  const id = `${pascal(String(f.id))}FluidFogMixin`;
  const r = refs(env, f);
  const at = "org.spongepowered.asm.mixin.injection";
  const mod = env.modId;
  const modern26 = env.mc === "26.3";
  const entity = modern26 ? "camera.entity()" : "camera.getEntity()";
  const inFluid = `    private static boolean ${mod}$in${pascal(String(f.id))}(net.minecraft.client.Camera camera) {
        net.minecraft.world.entity.Entity entity = ${entity};
        if (entity == null) return false;
        net.minecraft.core.BlockPos pos = camera.${modern26 ? "blockPosition" : "getBlockPosition"}();
        net.minecraft.world.level.material.FluidState fluid = entity.level().getFluidState(pos);
        return fluid.getType().isSame(${r.source}) && camera.${modern26 ? "position" : "getPosition"}().y < pos.getY() + fluid.getHeight(entity.level(), pos);
    }`;
  const fog = fogCalls(env, f, entity, `${entity}.level()`);
  const color = str(f.fogColor) ? rgb(str(f.fogColor)) : undefined;
  const check = `${mod}$in${pascal(String(f.id))}(camera)`;
  let injections: string;
  if (modern26) {
    injections = `    @${at}.Inject(method = "setupFog", at = @${at}.At("RETURN"))
    private void ${mod}$${f.id}Fog(net.minecraft.client.Camera camera, int renderDistance, net.minecraft.client.DeltaTracker deltaTracker, float darken, net.minecraft.client.multiplayer.ClientLevel level, ${at}.callback.CallbackInfoReturnable<net.minecraft.client.renderer.fog.FogData> cir) {
        if (!${check}) return;
        net.minecraft.client.renderer.fog.FogData fog = cir.getReturnValue();
${color ? `        fog.color.set(${color[0]}F, ${color[1]}F, ${color[2]}F, fog.color.w);\n` : ""}        fog.environmentalStart = ${fog.start};
        fog.environmentalEnd = Math.min(${fog.end}, renderDistance * 16);
    }`;
  } else {
    const colorHook = color ? `    @${at}.Inject(method = "computeFogColor", at = @${at}.At("RETURN"), cancellable = true)
    private static void ${mod}$${f.id}FogColor(net.minecraft.client.Camera camera, float partialTick, net.minecraft.client.multiplayer.ClientLevel level, int renderDistance, float darken, ${at}.callback.CallbackInfoReturnable<org.joml.Vector4f> cir) {
        if (${check}) cir.setReturnValue(new org.joml.Vector4f(${color[0]}F, ${color[1]}F, ${color[2]}F, cir.getReturnValue().w));
    }

` : "";
    injections = `${colorHook}    @${at}.Inject(method = "setupFog", at = @${at}.At("RETURN"), cancellable = true)
    private static void ${mod}$${f.id}Fog(net.minecraft.client.Camera camera, net.minecraft.client.renderer.FogRenderer.FogMode mode, org.joml.Vector4f color, float renderDistance, boolean thick, float partialTick, ${at}.callback.CallbackInfoReturnable<net.minecraft.client.renderer.FogParameters> cir) {
        if (!${check}) return;
        net.minecraft.client.renderer.FogParameters fog = cir.getReturnValue();
        cir.setReturnValue(new net.minecraft.client.renderer.FogParameters(${fog.start}, Math.min(${fog.end}, renderDistance), fog.shape(), fog.red(), fog.green(), fog.blue(), fog.alpha()));
    }`;
  }
  const target = modern26 ? "net.minecraft.client.renderer.fog.FogRenderer" : "net.minecraft.client.renderer.FogRenderer";
  const code = `package ${env.project.mod.package}.mixin;

/** Generated by MCEdge: fog inside the ${f.id} fluid. */
@org.spongepowered.asm.mixin.Mixin(${target}.class)
public abstract class ${id} {
${inFluid}

${injections}
}
`;
  return { id, code, client: true };
}

/** Fabric's fluid attributes (transfer API): light, temperature, viscosity and gas-like density, like NeoForge fluid types. */
function fabricAttributes(env: GenEnv, f: Element): string {
  const r = refs(env, f);
  const V = "net.fabricmc.fabric.api.transfer.v1.fluid.FluidVariant";
  const light = env.mc === "26.3" ? "getLightEmission" : "getLuminance";
  return `for (net.minecraft.world.level.material.Fluid fluid : new net.minecraft.world.level.material.Fluid[] {${r.source}, ${r.flowing}}) {
            net.fabricmc.fabric.api.transfer.v1.fluid.FluidVariantAttributes.register(fluid, new net.fabricmc.fabric.api.transfer.v1.fluid.FluidVariantAttributeHandler() {
                @Override public int ${light}(${V} variant) { return ${Math.max(0, Math.min(15, Number(f.luminosity) || 0))}; }
                @Override public int getTemperature(${V} variant) { return ${Number(f.temperature) || 0}; }
                @Override public int getViscosity(${V} variant, net.minecraft.world.level.Level world) { return ${Math.max(1, Number(f.viscosity) || 1000)}; }
                @Override public boolean isLighterThanAir(${V} variant) { return ${(Number(f.density) || 0) < 0}; }
            });
        }`;
}

/** Screen overlay while the camera is in the fluid, drawn like the water overlay (Fabric has no API for it). */
function fabricOverlayMixin(env: GenEnv, f: Element): { id: string; code: string; client: boolean } {
  const id = `${pascal(String(f.id))}FluidOverlayMixin`;
  const r = refs(env, f);
  const at = "org.spongepowered.asm.mixin.injection";
  const v26 = env.mc === "26.3";
  const tex = idExpr(env, `${env.modId}:textures/misc/${f.id}_overlay.png`);
  const inFluid = `net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
        if (mc.player == null || mc.player.isSpectator()) return;
        net.minecraft.core.BlockPos eye = net.minecraft.core.BlockPos.containing(mc.player.getEyePosition());
        net.minecraft.world.level.material.FluidState fluid = mc.player.level().getFluidState(eye);
        if (!fluid.getType().isSame(${r.source}) || mc.player.getEyeY() >= eye.getY() + fluid.getHeight(mc.player.level(), eye)) return;
        float light = ${v26 ? "net.minecraft.client.renderer.Lightmap" : "net.minecraft.client.renderer.LightTexture"}.getBrightness(mc.player.level().dimensionType(), mc.player.level().getMaxLocalRawBrightness(eye));
        int color = net.minecraft.util.ARGB.colorFromFloat(0.1F, light, light, light);
        float u = -mc.player.getYRot() / 64.0F;
        float v = mc.player.getXRot() / 64.0F;`;
  const quad = (b: string, m: string) => `${b}.addVertex(${m}, -1.0F, -1.0F, -0.5F).setUv(4.0F + u, 4.0F + v).setColor(color);
            ${b}.addVertex(${m}, 1.0F, -1.0F, -0.5F).setUv(u, 4.0F + v).setColor(color);
            ${b}.addVertex(${m}, 1.0F, 1.0F, -0.5F).setUv(u, v).setColor(color);
            ${b}.addVertex(${m}, -1.0F, 1.0F, -0.5F).setUv(4.0F + u, v).setColor(color);`;
  const injection = v26
    ? `    @${at}.Inject(method = "submit", at = @${at}.At("TAIL"))
    private void ${env.modId}$${f.id}Overlay(float partialTicks, net.minecraft.client.renderer.SubmitNodeCollector collector, net.minecraft.client.renderer.state.level.PlayerRenderState player, net.minecraft.client.renderer.state.level.CameraRenderState camera, boolean hideGui, ${at}.callback.CallbackInfo info) {
        if (!camera.isFirstPerson) return;
        ${inFluid}
        collector.submitCustomGeometry(new com.mojang.blaze3d.vertex.PoseStack(), net.minecraft.client.renderer.rendertype.RenderTypes.blockScreenEffect(${tex}), (pose, builder) -> {
            org.joml.Matrix4f m = pose.pose();
            ${quad("builder", "m")}
        });
    }`
    : `    @${at}.Inject(method = "renderScreenEffect", at = @${at}.At("TAIL"))
    private static void ${env.modId}$${f.id}Overlay(net.minecraft.client.Minecraft minecraft, com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.MultiBufferSource buffers, ${at}.callback.CallbackInfo info) {
        ${inFluid}
        org.joml.Matrix4f m = pose.last().pose();
        com.mojang.blaze3d.vertex.VertexConsumer builder = buffers.getBuffer(net.minecraft.client.renderer.RenderType.blockScreenEffect(${tex}));
        {
            ${quad("builder", "m")}
        }
    }`;
  const code = `package ${env.project.mod.package}.mixin;

/** Generated by MCEdge: the ${f.id} fluid's screen overlay. */
@org.spongepowered.asm.mixin.Mixin(net.minecraft.client.renderer.ScreenEffectRenderer.class)
public abstract class ${id} {
${injection}
}
`;
  return { id, code, client: true };
}

/** Forge 1.16.5 draws only the water overlay; this draws the fluid's own one the same way, before the HUD. */
function legacyOverlay(env: GenEnv, f: Element): string {
  const r = refs(env, f);
  return `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.client.event.RenderGameOverlayEvent.Pre.class, event -> {
            if (event.getType() != net.minecraftforge.client.event.RenderGameOverlayEvent.ElementType.ALL) return;
            net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
            if (mc.player == null || mc.player.isSpectator() || !mc.options.getCameraType().isFirstPerson()) return;
            net.minecraft.util.math.BlockPos eye = new net.minecraft.util.math.BlockPos(mc.player.getX(), mc.player.getEyeY(), mc.player.getZ());
            net.minecraft.fluid.FluidState fluid = mc.player.level.getFluidState(eye);
            if (!fluid.getType().isSame(${r.source}) || mc.player.getEyeY() >= eye.getY() + fluid.getHeight(mc.player.level, eye)) return;
            float light = mc.player.getBrightness();
            float u = -mc.player.yRot / 64.0F;
            float v = mc.player.xRot / 64.0F;
            int w = mc.getWindow().getGuiScaledWidth();
            int h = mc.getWindow().getGuiScaledHeight();
            mc.getTextureManager().bind(${idExpr(env, `${env.modId}:textures/misc/${f.id}_overlay.png`)});
            com.mojang.blaze3d.systems.RenderSystem.enableBlend();
            com.mojang.blaze3d.systems.RenderSystem.defaultBlendFunc();
            net.minecraft.util.math.vector.Matrix4f m = event.getMatrixStack().last().pose();
            net.minecraft.client.renderer.BufferBuilder buffer = net.minecraft.client.renderer.Tessellator.getInstance().getBuilder();
            buffer.begin(7, net.minecraft.client.renderer.vertex.DefaultVertexFormats.POSITION_COLOR_TEX);
            buffer.vertex(m, 0.0F, h, -90.0F).color(light, light, light, 0.1F).uv(4.0F + u, 4.0F + v).endVertex();
            buffer.vertex(m, w, h, -90.0F).color(light, light, light, 0.1F).uv(u, 4.0F + v).endVertex();
            buffer.vertex(m, w, 0.0F, -90.0F).color(light, light, light, 0.1F).uv(u, v).endVertex();
            buffer.vertex(m, 0.0F, 0.0F, -90.0F).color(light, light, light, 0.1F).uv(4.0F + u, v).endVertex();
            net.minecraft.client.renderer.Tessellator.getInstance().end();
            com.mojang.blaze3d.systems.RenderSystem.disableBlend();
        });`;
}

// ---- Fluid class

function fluidClass(env: GenEnv, f: Element): JavaSourceFile {
  const pkg = env.project.mod.package;
  const P = pascal(String(f.id));
  const cls = `${P}Fluid`;
  const n = names(env);
  const r = refs(env, f);
  const legacy = env.mc === "1.16.5";
  const fabric = env.loader === "fabric";
  const bucket = f.generateBucket === true;
  const members: string[] = [];

  const drip = str(f.dripParticle);
  if (f.spawnParticles === true && drip) {
    const lookup = legacy
      ? `net.minecraftforge.registries.ForgeRegistries.PARTICLE_TYPES.getValue(${idExpr(env, qualify(env, drip))})`
      : `net.minecraft.core.registries.BuiltInRegistries.PARTICLE_TYPE.getValue(${idExpr(env, qualify(env, drip))})`;
    const simple = legacy ? "net.minecraft.particles.BasicParticleType" : "net.minecraft.core.particles.SimpleParticleType";
    members.push(`    @Override
    public ${n.particle} getDripParticle() {
        Object particle = ${lookup};
        return particle instanceof ${simple} ? (${simple}) particle : null;
    }`);
  }

  const flow = procedureCall(env, "fluid", f, "flowCondition", { x: "from.getX()", y: "from.getY()", z: "from.getZ()", world: "world", blockstate: "world.getBlockState(from)" });
  if (flow) {
    members.push(`    @Override
    protected void spreadTo(${n.world} world, ${n.pos} pos, ${n.state} state, ${n.dir} direction, ${n.fluidState} target) {
        ${n.pos} from = pos.relative(direction.getOpposite());
        if (${flow}) super.spreadTo(world, pos, state, direction, target);
    }`);
  }

  const replace = procedureCall(env, "fluid", f, "beforeReplacingBlock", { x: "pos.getX()", y: "pos.getY()", z: "pos.getZ()", world: "world", blockstate: "state" });
  if (fabric) {
    const vanilla = lava(f)
      ? "world.levelEvent(1501, pos, 0);"
      : `net.minecraft.world.level.block.Block.dropResources(state, world, pos, state.hasBlockEntity() ? world.getBlockEntity(pos) : null);`;
    members.push(`    @Override
    protected void beforeDestroyingBlock(${n.world} world, ${n.pos} pos, ${n.state} state) {
        ${replace ? `${replace};` : vanilla}
    }`);
  } else if (replace) {
    members.push(`    @Override
    protected void beforeDestroyingBlock(${n.world} world, ${n.pos} pos, ${n.state} state) {
        ${replace};
    }`);
  }

  if (fabric) {
    const level = "net.minecraft.world.level.LevelReader";
    members.push(`    @Override
    public ${n.fluid} getFlowing() {
        return ${r.flowing};
    }

    @Override
    public ${n.fluid} getSource() {
        return ${r.source};
    }

    @Override
    public ${n.item}.Item getBucket() {
        return ${bucket ? r.bucket : `${n.item}.Items.AIR`};
    }

    @Override
    public boolean isSame(${n.fluid} fluid) {
        return fluid == ${r.source} || fluid == ${r.flowing};
    }

    @Override
    protected boolean canConvertToSource(net.minecraft.server.level.ServerLevel level) {
        return ${f.canMultiply === true};
    }

    @Override
    protected int getSlopeFindDistance(${level} level) {
        return ${Number(f.slopeFindDistance) || 4};
    }

    @Override
    protected int getDropOff(${level} level) {
        return ${Number(f.levelDecrease) || 1};
    }

    @Override
    public int getTickDelay(${level} level) {
        return ${Number(f.flowRate) || 5};
    }

    @Override
    protected boolean canBeReplacedWith(${n.fluidState} state, net.minecraft.world.level.BlockGetter level, ${n.pos} pos, ${n.fluid} fluid, ${n.dir} direction) {
        return direction == ${n.dir}.DOWN && !this.isSame(fluid);
    }

    @Override
    protected float getExplosionResistance() {
        return ${jfloat(f.resistance)};
    }

    @Override
    protected ${n.state} createLegacyBlock(${n.fluidState} state) {
        return ${r.block}.defaultBlockState().setValue(net.minecraft.world.level.block.LiquidBlock.LEVEL, getLegacyLevel(state));
    }

    @Override
    public java.util.Optional<${n.sound}> getPickupSound() {
        return java.util.Optional.of(${n.sounds}.${lava(f) ? "BUCKET_FILL_LAVA" : "BUCKET_FILL"});
    }`);
  }

  // Properties of the Forge / NeoForge base classes.
  const options = [
    `.explosionResistance(${jfloat(f.resistance)})`,
    `.tickRate(${Number(f.flowRate) || 5})`,
    `.levelDecreasePerBlock(${Number(f.levelDecrease) || 1})`,
    `.slopeFindDistance(${Number(f.slopeFindDistance) || 4})`,
    ...(legacy && f.canMultiply === true ? [".canMultiply()"] : []),
    ...(bucket ? [`.bucket(() -> ${r.bucket})`] : []),
    `.block(() -> ${r.block})`,
  ].join("\n            ");
  let base: string;
  let properties = "";
  if (legacy) {
    base = "net.minecraftforge.fluids.ForgeFlowingFluid";
    properties = `
    public static final ${base}.Properties PROPERTIES = new ${base}.Properties(() -> ${r.source}, () -> ${r.flowing}, ${legacyAttributes(env, f, cls)})
            ${options};
`;
  } else if (!fabric) {
    base = "net.neoforged.neoforge.fluids.BaseFlowingFluid";
    properties = `
    public static final ${base}.Properties PROPERTIES = new ${base}.Properties(() -> ${r.type}, () -> ${r.source}, () -> ${r.flowing})
            ${options};
`;
  } else {
    base = n.flowing;
  }
  const ctor = fabric ? "" : `
    protected ${cls}() {
        super(PROPERTIES);
    }
`;
  const levelProp = legacy ? "net.minecraft.fluid.FlowingFluid.LEVEL" : "LEVEL";
  const stateBuilder = legacy
    ? "net.minecraft.state.StateContainer.Builder<net.minecraft.fluid.Fluid, net.minecraft.fluid.FluidState>"
    : "net.minecraft.world.level.block.state.StateDefinition.Builder<net.minecraft.world.level.material.Fluid, net.minecraft.world.level.material.FluidState>";
  const nested = [
    `    public static class Source extends ${cls} {
        @Override
        public int getAmount(${n.fluidState} state) {
            return 8;
        }

        @Override
        public boolean isSource(${n.fluidState} state) {
            return true;
        }
    }`,
    `    public static class Flowing extends ${cls} {
        @Override
        protected void createFluidStateDefinition(${stateBuilder} builder) {
            super.createFluidStateDefinition(builder);
            builder.add(${levelProp});
        }

        @Override
        public int getAmount(${n.fluidState} state) {
            return state.getValue(${levelProp});
        }

        @Override
        public boolean isSource(${n.fluidState} state) {
            return false;
        }
    }`,
  ];
  if (env.loader === "neoforge") nested.push(fluidTypeClass(env, f));
  if (legacy && tintOf(f)) nested.push(legacyTintedAttributes(env, f));
  if (bucket) nested.push(bucketClass(env, f));
  const code = `package ${pkg}.fluid;

/** Generated by MCEdge. */
public abstract class ${cls} extends ${base} {${properties}${ctor}
${members.join("\n\n")}

${nested.join("\n\n")}
}
`;
  return { path: `${pkg.replaceAll(".", "/")}/fluid/${cls}.java`, code };
}

/** 1.16.5 FluidAttributes builder: textures, light, density, viscosity, temperature, rarity, sounds and tint. */
function legacyAttributes(env: GenEnv, f: Element, cls: string): string {
  const still = `new net.minecraft.util.ResourceLocation(${jstr(textureId(env, f, "still"))})`;
  const flow = `new net.minecraft.util.ResourceLocation(${jstr(textureId(env, f, "flow"))})`;
  const builder = tintOf(f)
    ? `new net.minecraftforge.fluids.FluidAttributes.Builder(${still}, ${flow}, ${cls}.TintedAttributes::new) {}`
    : `net.minecraftforge.fluids.FluidAttributes.builder(${still}, ${flow})`;
  const empty = str(f.emptySound) ? soundExpr(env, str(f.emptySound)) : `net.minecraft.util.SoundEvents.${lava(f) ? "BUCKET_EMPTY_LAVA" : "BUCKET_EMPTY"}`;
  const fill = `net.minecraft.util.SoundEvents.${lava(f) ? "BUCKET_FILL_LAVA" : "BUCKET_FILL"}`;
  return [
    builder,
    `.translationKey(${jstr(`fluid.${env.modId}.${f.id}`)})`,
    `.luminosity(${Math.min(15, Number(f.luminosity) || 0)})`,
    `.density(${Number(f.density) || 0})`,
    `.viscosity(${Number(f.viscosity) || 0})`,
    `.temperature(${Number(f.temperature) || 0})`,
    `.rarity(net.minecraft.item.Rarity.${str(f.rarity) || "COMMON"})`,
    `.sound(${fill}, ${empty})`,
  ].join("\n                    ");
}

/** 1.16.5 attributes reporting the biome tint where the fluid is drawn. */
function legacyTintedAttributes(env: GenEnv, f: Element): string {
  return `    public static class TintedAttributes extends net.minecraftforge.fluids.FluidAttributes {
        protected TintedAttributes(net.minecraftforge.fluids.FluidAttributes.Builder builder, net.minecraft.fluid.Fluid fluid) {
            super(builder, fluid);
        }

        @Override
        public int getColor() {
            return ${TINT_COLORS[tintOf(f)] ?? -1};
        }

        @Override
        public int getColor(net.minecraft.world.IBlockDisplayReader world, net.minecraft.util.math.BlockPos pos) {
            return ${colorAt(env, tintOf(f), "world", "pos")};
        }
    }`;
}

/** Tint color (ARGB int expression) at a position, for 1.16.5 and 1.21.5. */
function colorAt(env: GenEnv, tint: string, world: string, pos: string): string {
  const legacy = env.mc === "1.16.5";
  const biomes = legacy ? "net.minecraft.world.biome.BiomeColors" : "net.minecraft.client.renderer.BiomeColors";
  const average = (what: string) => `(${biomes}.getAverage${what}Color(${world}, ${pos}) | 0xFF000000)`;
  if (tint === "Grass") return average("Grass");
  if (tint === "Foliage") return average("Foliage");
  if (tint === "Water") return average("Water");
  if (tint === "Dry foliage" && !legacy) return average("DryFoliage");
  const getter = { Sky: "Sky", Fog: "Fog", "Water fog": "WaterFog" }[tint];
  if (getter) {
    const level = "net.minecraft.client.Minecraft.getInstance().level";
    return `(${level} != null ? ${level}.getBiome(${pos})${legacy ? "" : ".value()"}.get${getter}Color() | 0xFF000000 : ${TINT_COLORS[tint]})`;
  }
  return String(TINT_COLORS[tint] ?? -1);
}

/** NeoForge FluidType: physics, sounds and light. 26.x needs its own water movement for non-vanilla types. */
function fluidTypeClass(env: GenEnv, f: Element): string {
  const props: string[] = [];
  if (lava(f)) {
    props.push(".canSwim(false)", ".canDrown(false)", ".pathType(net.minecraft.world.level.pathfinder.PathType.LAVA)", ".adjacentPathType(null)");
  } else {
    props.push(".fallDistanceModifier(0F)", ".canExtinguish(true)", ".supportsBoating(true)", ".canHydrate(true)");
  }
  props.push(`.motionScale(${0.007 * (Number(f.flowStrength) || 0)}D)`);
  props.push(`.lightLevel(${Math.min(15, Number(f.luminosity) || 0)})`);
  props.push(`.density(${Number(f.density) || 0})`, `.viscosity(${Number(f.viscosity) || 0})`, `.temperature(${Number(f.temperature) || 0})`);
  if (f.canMultiply === true) props.push(".canConvertToSource(true)");
  props.push(`.rarity(net.minecraft.world.item.Rarity.${str(f.rarity) || "COMMON"})`);
  const actions = "net.neoforged.neoforge.common.SoundActions";
  props.push(`.sound(${actions}.BUCKET_FILL, net.minecraft.sounds.SoundEvents.${lava(f) ? "BUCKET_FILL_LAVA" : "BUCKET_FILL"})`);
  props.push(`.sound(${actions}.BUCKET_EMPTY, ${str(f.emptySound) ? soundExpr(env, str(f.emptySound)) : `net.minecraft.sounds.SoundEvents.${lava(f) ? "BUCKET_EMPTY_LAVA" : "BUCKET_EMPTY"}`})`);
  props.push(`.sound(${actions}.FLUID_VAPORIZE, net.minecraft.sounds.SoundEvents.FIRE_EXTINGUISH)`);
  props.push(`.descriptionId(${jstr(`fluid_type.${env.modId}.${f.id}`)})`);
  const move = env.mc === "26.3" && !lava(f) ? `

        @Override
        public boolean move(net.minecraft.world.entity.LivingEntity entity, net.minecraft.world.phys.Vec3 input, double gravity) {
            // Vanilla water movement (LivingEntity#travelInWater is not reachable from here).
            boolean falling = entity.getDeltaMovement().y <= 0.0;
            double oldY = entity.getY();
            float slowDown = entity.isSprinting() ? 0.9F : 0.8F;
            float speed = 0.02F;
            float efficiency = (float) entity.getAttributeValue(net.minecraft.world.entity.ai.attributes.Attributes.WATER_MOVEMENT_EFFICIENCY);
            if (!entity.onGround()) efficiency *= 0.5F;
            if (efficiency > 0.0F) {
                slowDown += (0.54600006F - slowDown) * efficiency;
                speed += (entity.getSpeed() - speed) * efficiency;
            }
            if (entity.hasEffect(net.minecraft.world.effect.MobEffects.DOLPHINS_GRACE)) slowDown = 0.96F;
            speed *= (float) entity.getAttributeValue(net.neoforged.neoforge.common.NeoForgeMod.SWIM_SPEED);
            entity.moveRelative(speed, input);
            entity.move(net.minecraft.world.entity.MoverType.SELF, entity.getDeltaMovement());
            net.minecraft.world.phys.Vec3 movement = entity.getDeltaMovement();
            if (entity.horizontalCollision && entity.onClimbable()) movement = new net.minecraft.world.phys.Vec3(movement.x, 0.2, movement.z);
            movement = movement.multiply(slowDown, 0.8F, slowDown);
            entity.setDeltaMovement(entity.getFluidFallingAdjustedMovement(gravity, falling, movement));
            movement = entity.getDeltaMovement();
            if (entity.horizontalCollision && entity.isFree(movement.x, movement.y + 0.6F - entity.getY() + oldY, movement.z)) {
                entity.setDeltaMovement(movement.x, 0.3F, movement.z);
            }
            return true;
        }` : "";
  return `    public static class Type extends net.neoforged.neoforge.fluids.FluidType {
        public Type() {
            super(net.neoforged.neoforge.fluids.FluidType.Properties.create()
                    ${props.join("\n                    ")});
        }${move}
    }`;
}

function bucketClass(env: GenEnv, f: Element): string {
  const r = refs(env, f);
  const legacy = env.mc === "1.16.5";
  const tab = legacy ? vanillaTab1165(env, f.creativeTabs) : "";
  const props = legacy
    ? `properties.craftRemainder(net.minecraft.item.Items.BUCKET).stacksTo(1).rarity(net.minecraft.item.Rarity.${str(f.rarity) || "COMMON"})${tab ? `.tab(${tab})` : ""}`
    : `properties.craftRemainder(net.minecraft.world.item.Items.BUCKET).stacksTo(1).rarity(net.minecraft.world.item.Rarity.${str(f.rarity) || "COMMON"})`;
  const members: string[] = [];
  const tooltip = str(f.specialInformationProcedure) ? "" : tooltipMethod(env, str(f.specialInformation), "item");
  if (tooltip) members.push(tooltip.replace(/^\n/, "").replaceAll(/^ {4}/gm, "        "));
  const tooltipProcedure = procedureMembers(env, "fluid", { ...f, ...onlyField(f, "specialInformationProcedure") }).members;
  members.push(...tooltipProcedure.map((m) => m.replaceAll(/^/gm, "    ")));
  const sound = str(f.emptySound);
  if (env.loader === "fabric" && sound) {
    members.push(`        @Override
        protected void playEmptySound(net.minecraft.world.entity.LivingEntity user, net.minecraft.world.level.LevelAccessor world, net.minecraft.core.BlockPos pos) {
            world.playSound(user, pos, ${soundExpr(env, sound)}, net.minecraft.sounds.SoundSource.BLOCKS, 1.0F, 1.0F);
            world.gameEvent(user, net.minecraft.world.level.gameevent.GameEvent.FLUID_PLACE, pos);
        }`);
  }
  const fluid = legacy ? `() -> ${r.source}` : r.source;
  return `    public static class Bucket extends ${legacy ? "net.minecraft.item" : "net.minecraft.world.item"}.BucketItem {
        public Bucket(${legacy ? "net.minecraft.item" : "net.minecraft.world.item"}.Item.Properties properties) {
            super(${fluid}, ${props});
        }
${members.length ? `\n${members.join("\n\n")}\n` : ""}    }`;
}

/** Element values with every procedure field cleared except `key`, so procedureMembers only builds that one. */
function onlyField(f: Element, ...keys: string[]): Record<string, unknown> {
  const procedures = ["onBlockAdded", "onNeighbourChanges", "onTickUpdate", "onEntityCollides", "onRandomUpdateEvent", "onDestroyedByExplosion",
    "flowCondition", "beforeReplacingBlock", "specialInformationProcedure", "fogStartDistanceProcedure", "fogEndDistanceProcedure"];
  return Object.fromEntries(procedures.map((p) => [p, keys.includes(p) ? f[p] : ""]));
}

// ---- Liquid block

function blockClass(env: GenEnv, f: Element): JavaSourceFile {
  const pkg = env.project.mod.package;
  const cls = `${pascal(String(f.id))}FluidBlock`;
  const legacy = env.mc === "1.16.5";
  const r = refs(env, f);
  const S = names(env).state;
  const color = str(f.colorOnMap);
  const mapColor = color === "DEFAULT" || !color ? (lava(f) ? "FIRE" : "WATER") : MAP_COLORS[color] ?? terracotta(color) ?? color;
  const light = Number(f.luminance) || 0;
  const rate = Number(f.tickRate) || 0;
  const ticks = str(f.onTickUpdate) !== "";
  const schedule = ticks && rate > 0 ? (legacy ? `world.getBlockTicks().scheduleTick(pos, this, ${rate});` : `world.scheduleTick(pos, this, ${rate});`) : "";
  // Without fluid types (1.16.5, Fabric) entities are pushed as by water or lava (minecraft:water / lava tags); the
  // fluid's own flow strength adds the difference while they are inside, with the collision procedure in the same
  // override.
  const base = lava(f) ? 0.007 : 0.014;
  const extra = env.loader === "neoforge" ? 0 : Math.round((0.007 * (Number(f.flowStrength) || 0) - base) * 1e6) / 1e6;
  const pushes = extra !== 0;
  const blockOnly = { ...f, ...onlyField(f, "onBlockAdded", "onNeighbourChanges", "onTickUpdate", ...(pushes ? [] : ["onEntityCollides"]), "onRandomUpdateEvent", "onDestroyedByExplosion") };
  const { members, handled } = procedureMembers(env, "fluid", blockOnly, {
    onTickUpdate: rate > 0 ? String(rate) : "",
    ...(schedule ? { onBlockAdded: schedule } : {}),
  });
  if (schedule && !handled.has("onBlockAdded")) {
    members.push(legacy
      ? `    @Override
    public void onPlace(${S} state, net.minecraft.world.World world, net.minecraft.util.math.BlockPos pos, ${S} oldState, boolean moving) {
        super.onPlace(state, world, pos, oldState, moving);
        ${schedule}
    }`
      : `    @Override
    protected void onPlace(${S} state, net.minecraft.world.level.Level world, net.minecraft.core.BlockPos pos, ${S} oldState, boolean moving) {
        super.onPlace(state, world, pos, oldState, moving);
        ${schedule}
    }`);
  }

  if (pushes) {
    const collide = procedureCall(env, "fluid", f, "onEntityCollides", { x: "pos.getX()", y: "pos.getY()", z: "pos.getZ()", world: "world", entity: "entity", blockstate: "state" });
    const body = `${legacy ? "net.minecraft.util.math.vector.Vector3d" : "net.minecraft.world.phys.Vec3"} flow = state.getFluidState().getFlow(world, pos);
        if (flow.lengthSqr() > 0.0 && entity.isPushedByFluid()) entity.setDeltaMovement(entity.getDeltaMovement().add(flow.normalize().scale(${extra})));${collide ? `
        if (!world.isClientSide()) ${collide};` : ""}`;
    const W = legacy ? "net.minecraft.world.World" : "net.minecraft.world.level.Level";
    const signature = legacy ? `public void entityInside(${S} state, ${W} world, ${names(env).pos} pos, net.minecraft.entity.Entity entity)`
      : env.mc === "26.3" ? `protected void entityInside(${S} state, ${W} world, ${names(env).pos} pos, net.minecraft.world.entity.Entity entity, net.minecraft.world.entity.InsideBlockEffectApplier effects, boolean intersects)`
        : `protected void entityInside(${S} state, ${W} world, ${names(env).pos} pos, net.minecraft.world.entity.Entity entity, net.minecraft.world.entity.InsideBlockEffectApplier effects)`;
    const sup = legacy ? "super.entityInside(state, world, pos, entity);" : env.mc === "26.3" ? "super.entityInside(state, world, pos, entity, effects, intersects);" : "super.entityInside(state, world, pos, entity, effects);";
    members.push(`    @Override
    ${signature} {
        ${sup}
        ${body}
    }`);
  }

  const opacity = Number(f.lightOpacity);
  const getter = legacy ? "net.minecraft.world.IBlockReader" : "net.minecraft.world.level.BlockGetter";
  const posT = names(env).pos;
  if (opacity === 0) {
    members.push(legacy
      ? `    @Override\n    public boolean propagatesSkylightDown(${S} state, ${getter} world, ${posT} pos) {\n        return true;\n    }`
      : `    @Override\n    protected boolean propagatesSkylightDown(${S} state) {\n        return true;\n    }`);
  } else if (opacity !== 1) {
    members.push(legacy
      ? `    @Override\n    public int getLightBlock(${S} state, ${getter} world, ${posT} pos) {\n        return ${opacity};\n    }`
      : `    @Override\n    protected int ${env.mc === "26.3" ? "getLightDampening" : "getLightBlock"}(${S} state) {\n        return ${opacity};\n    }`);
  }
  if (env.loader !== "fabric") {
    const dir = names(env).dir;
    if (Number(f.flammability) !== 0) members.push(`    @Override\n    public int getFlammability(${S} state, ${getter} world, ${posT} pos, ${dir} face) {\n        return ${f.flammability};\n    }`);
    if (Number(f.fireSpreadSpeed) !== 0) members.push(`    @Override\n    public int getFireSpreadSpeed(${S} state, ${getter} world, ${posT} pos, ${dir} face) {\n        return ${f.fireSpreadSpeed};\n    }`);
    if (legacy && f.ignitedByLava === true) members.push(`    @Override\n    public boolean isFlammable(${S} state, ${getter} world, ${posT} pos, ${dir} face) {\n        return true;\n    }`);
  }

  let header: string;
  if (legacy) {
    const props = [
      `net.minecraft.block.AbstractBlock.Properties.of(net.minecraft.block.material.Material.${lava(f) ? "LAVA" : "WATER"}, net.minecraft.block.material.MaterialColor.${LEGACY_MAP_COLORS.has(mapColor) ? mapColor : lava(f) ? "FIRE" : "WATER"})`,
      ".noCollission()",
      `.strength(${jfloat(f.resistance)})`,
      ".noDrops()",
      ...(light ? [`.lightLevel(s -> ${light})`] : []),
      ...(f.emissiveRendering === true ? [".hasPostProcess((s, w, p) -> true).emissiveRendering((s, w, p) -> true)"] : []),
    ];
    header = `public class ${cls} extends net.minecraft.block.FlowingFluidBlock {
    public ${cls}() {
        super(() -> ${r.source}, ${props.join("\n                ")});
    }`;
  } else {
    const props = [
      "properties",
      `.mapColor(net.minecraft.world.level.material.MapColor.${mapColor})`,
      `.strength(${jfloat(f.resistance)})`,
      env.mc === "26.3" ? ".noCollision()" : ".noCollission()",
      ".noLootTable()",
      ".liquid()",
      `.pushReaction(net.minecraft.world.level.material.PushReaction.${env.mc === "26.3" ? "POPPED" : "DESTROY"})`,
      ".sound(net.minecraft.world.level.block.SoundType.EMPTY)",
      ".replaceable()",
      ...(light ? [`.lightLevel(s -> ${light})`] : []),
      ...(f.ignitedByLava === true ? [".ignitedByLava()"] : []),
      ...(f.emissiveRendering === true ? [env.mc === "26.3" ? ".emissiveRendering(s -> true)" : ".hasPostProcess((s, w, p) -> true).emissiveRendering((s, w, p) -> true)"] : []),
    ];
    header = `public class ${cls} extends net.minecraft.world.level.block.LiquidBlock {
    public ${cls}(net.minecraft.world.level.block.state.BlockBehaviour.Properties properties) {
        super(${r.source}, ${props.join("\n                ")});
    }`;
  }
  const code = `package ${pkg}.block;

/** Generated by MCEdge. */
${header}
${members.length ? `\n${members.join("\n\n")}\n` : ""}}
`;
  return { path: `${pkg.replaceAll(".", "/")}/block/${cls}.java`, code };
}

/** MaterialColor constants of 1.16.5 (later map colors fall back to the fluid's default). */
const LEGACY_MAP_COLORS = new Set(["NONE", "GRASS", "SAND", "WOOL", "FIRE", "ICE", "METAL", "PLANT", "SNOW", "CLAY", "DIRT", "STONE", "WATER", "WOOD",
  "QUARTZ", "COLOR_ORANGE", "COLOR_MAGENTA", "COLOR_LIGHT_BLUE", "COLOR_YELLOW", "COLOR_LIGHT_GREEN", "COLOR_PINK", "COLOR_GRAY", "COLOR_LIGHT_GRAY",
  "COLOR_CYAN", "COLOR_PURPLE", "COLOR_BLUE", "COLOR_BROWN", "COLOR_GREEN", "COLOR_RED", "COLOR_BLACK", "GOLD", "DIAMOND", "LAPIS", "EMERALD", "PODZOL",
  "NETHER", "TERRACOTTA_WHITE", "TERRACOTTA_ORANGE", "TERRACOTTA_MAGENTA", "TERRACOTTA_LIGHT_BLUE", "TERRACOTTA_YELLOW", "TERRACOTTA_LIGHT_GREEN",
  "TERRACOTTA_PINK", "TERRACOTTA_GRAY", "TERRACOTTA_LIGHT_GRAY", "TERRACOTTA_CYAN", "TERRACOTTA_PURPLE", "TERRACOTTA_BLUE", "TERRACOTTA_BROWN",
  "TERRACOTTA_GREEN", "TERRACOTTA_RED", "TERRACOTTA_BLACK", "CRIMSON_NYLIUM", "CRIMSON_STEM", "CRIMSON_HYPHAE", "WARPED_NYLIUM", "WARPED_STEM",
  "WARPED_HYPHAE", "WARPED_WART_BLOCK"]);

// ---- Registration

function holderClass(env: GenEnv, fluids: Element[]): { source: JavaSourceFile; init: string } {
  const pkg = env.project.mod.package;
  const cls = `${modClassName(env)}${REG}`;
  const owner = `${pkg}.init.${cls}`;
  const mod = jstr(env.modId);
  const fluidClassOf = (f: Element) => `${pkg}.fluid.${pascal(String(f.id))}Fluid`;
  const blockClassOf = (f: Element) => `${pkg}.block.${pascal(String(f.id))}FluidBlock`;
  let body: string;
  let init: string;
  if (env.mc === "1.16.5") {
    const DR = "net.minecraftforge.registries.DeferredRegister";
    const RO = "net.minecraftforge.fml.RegistryObject";
    const FR = "net.minecraftforge.registries.ForgeRegistries";
    body = `    public static final ${DR}<net.minecraft.fluid.Fluid> FLUIDS = ${DR}.create(${FR}.FLUIDS, ${mod});
    public static final ${DR}<net.minecraft.block.Block> BLOCKS = ${DR}.create(${FR}.BLOCKS, ${mod});
    public static final ${DR}<net.minecraft.item.Item> ITEMS = ${DR}.create(${FR}.ITEMS, ${mod});
${fluids.map((f) => {
  const C = String(f.id).toUpperCase();
  return `    public static final ${RO}<net.minecraft.fluid.FlowingFluid> ${C} = FLUIDS.register(${jstr(String(f.id))}, ${fluidClassOf(f)}.Source::new);
    public static final ${RO}<net.minecraft.fluid.FlowingFluid> FLOWING_${C} = FLUIDS.register(${jstr(`flowing_${f.id}`)}, ${fluidClassOf(f)}.Flowing::new);
    public static final ${RO}<net.minecraft.block.FlowingFluidBlock> ${derivedConstant(C, "Block")} = BLOCKS.register(${jstr(String(f.id))}, ${blockClassOf(f)}::new);${f.generateBucket === true ? `
    public static final ${RO}<net.minecraft.item.Item> ${derivedConstant(C, "Bucket")} = ITEMS.register(${jstr(`${f.id}_bucket`)}, () -> new ${fluidClassOf(f)}.Bucket(new net.minecraft.item.Item.Properties()));` : ""}`;
}).join("\n")}

    public static void register(net.minecraftforge.eventbus.api.IEventBus modBus) {
        FLUIDS.register(modBus);
        BLOCKS.register(modBus);
        ITEMS.register(modBus);
    }`;
    init = `${owner}.register(modBus);`;
  } else if (env.loader === "neoforge") {
    const DR = "net.neoforged.neoforge.registries.DeferredRegister";
    const key = (registry: string, id: string) => `net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.${registry}, ${id})`;
    body = `    public static final ${DR}<net.neoforged.neoforge.fluids.FluidType> TYPES = ${DR}.create(net.neoforged.neoforge.registries.NeoForgeRegistries.Keys.FLUID_TYPES, ${mod});
    public static final ${DR}<net.minecraft.world.level.material.Fluid> FLUIDS = ${DR}.create(net.minecraft.core.registries.Registries.FLUID, ${mod});
    public static final ${DR}.Blocks BLOCKS = ${DR}.createBlocks(${mod});
    public static final ${DR}.Items ITEMS = ${DR}.createItems(${mod});
${fluids.map((f) => {
  const C = String(f.id).toUpperCase();
  return `    public static final net.neoforged.neoforge.registries.DeferredHolder<net.neoforged.neoforge.fluids.FluidType, net.neoforged.neoforge.fluids.FluidType> ${derivedConstant(C, "Type")} = TYPES.register(${jstr(String(f.id))}, ${fluidClassOf(f)}.Type::new);
    public static final net.neoforged.neoforge.registries.DeferredHolder<net.minecraft.world.level.material.Fluid, net.minecraft.world.level.material.FlowingFluid> ${C} = FLUIDS.register(${jstr(String(f.id))}, ${fluidClassOf(f)}.Source::new);
    public static final net.neoforged.neoforge.registries.DeferredHolder<net.minecraft.world.level.material.Fluid, net.minecraft.world.level.material.FlowingFluid> FLOWING_${C} = FLUIDS.register(${jstr(`flowing_${f.id}`)}, ${fluidClassOf(f)}.Flowing::new);
    public static final net.neoforged.neoforge.registries.DeferredBlock<net.minecraft.world.level.block.LiquidBlock> ${derivedConstant(C, "Block")} = BLOCKS.register(${jstr(String(f.id))},
            id -> new ${blockClassOf(f)}(net.minecraft.world.level.block.state.BlockBehaviour.Properties.of().setId(${key("BLOCK", "id")})));${f.generateBucket === true ? `
    public static final net.neoforged.neoforge.registries.DeferredItem<net.minecraft.world.item.Item> ${derivedConstant(C, "Bucket")} = ITEMS.register(${jstr(`${f.id}_bucket`)},
            id -> new ${fluidClassOf(f)}.Bucket(new net.minecraft.world.item.Item.Properties().setId(${key("ITEM", "id")})));` : ""}`;
}).join("\n")}

    public static void register(net.neoforged.bus.api.IEventBus modBus) {
        TYPES.register(modBus);
        FLUIDS.register(modBus);
        BLOCKS.register(modBus);
        ITEMS.register(modBus);
    }`;
    init = `${owner}.register(modBus);`;
  } else {
    const reg = "net.minecraft.core.registries.BuiltInRegistries";
    const key = (registry: string, id: string) => `net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.${registry}, ${idExpr(env, `${env.modId}:${id}`)})`;
    const fluidFields = fluids.map((f) => {
      const C = String(f.id).toUpperCase();
      return `    public static final net.minecraft.world.level.material.FlowingFluid ${C} = net.minecraft.core.Registry.register(${reg}.FLUID, ${key("FLUID", String(f.id))}, new ${fluidClassOf(f)}.Source());
    public static final net.minecraft.world.level.material.FlowingFluid FLOWING_${C} = net.minecraft.core.Registry.register(${reg}.FLUID, ${key("FLUID", `flowing_${f.id}`)}, new ${fluidClassOf(f)}.Flowing());`;
    });
    const blockFields = fluids.map((f) => {
      const C = String(f.id).toUpperCase();
      return `    public static final net.minecraft.world.level.block.LiquidBlock ${derivedConstant(C, "Block")} = net.minecraft.core.Registry.register(${reg}.BLOCK, ${key("BLOCK", String(f.id))},
            new ${blockClassOf(f)}(net.minecraft.world.level.block.state.BlockBehaviour.Properties.of().setId(${key("BLOCK", String(f.id))})));${f.generateBucket === true ? `
    public static final net.minecraft.world.item.Item ${derivedConstant(C, "Bucket")} = net.minecraft.core.Registry.register(${reg}.ITEM, ${key("ITEM", `${f.id}_bucket`)},
            new ${fluidClassOf(f)}.Bucket(new net.minecraft.world.item.Item.Properties().setId(${key("ITEM", `${f.id}_bucket`)})));` : ""}`;
    });
    const flammable = fluids.filter((f) => Number(f.flammability) !== 0 || Number(f.fireSpreadSpeed) !== 0)
      .map((f) => `        net.fabricmc.fabric.api.registry.FlammableBlockRegistry.getDefaultInstance().add(${derivedConstant(String(f.id).toUpperCase(), "Block")}, ${f.flammability}, ${f.fireSpreadSpeed});`);
    body = `${fluidFields.join("\n")}
${blockFields.join("\n")}

    /** Loads the class, which registers its entries (fluids first: the blocks and buckets use them). */
    public static void init() {
${flammable.join("\n")}
    }`;
    init = `${owner}.init();`;
  }
  const code = `package ${pkg}.init;

/** Generated by MCEdge. */
public final class ${cls} {
    private ${cls}() {}

${body}
}
`;
  return { source: { path: `${pkg.replaceAll(".", "/")}/init/${cls}.java`, code }, init };
}

// ---- Client

function fogCalls(env: GenEnv, f: Element, entity: string, world: string) {
  const deps = { x: `${entity}.getX()`, y: `${entity}.getY()`, z: `${entity}.getZ()`, world, entity };
  const start = procedureCall(env, "fluid", f, "fogStartDistanceProcedure", deps);
  const end = procedureCall(env, "fluid", f, "fogEndDistanceProcedure", deps);
  return {
    start: start ? `(float) ${start}` : jfloat(f.fogStartDistance),
    end: end ? `(float) ${end}` : jfloat(f.fogEndDistance),
  };
}

function clientInit(env: GenEnv, fluids: Element[]): string[] {
  const out: string[] = [];
  for (const f of fluids) {
    const r = refs(env, f);
    const tint = tintOf(f);
    if (env.mc === "26.3") {
      const material = (path: string) => `new net.minecraft.client.resources.model.sprite.Material(${idExpr(env, path)})`;
      const tintArg = tint ? tintSource(tint, false) : "(net.minecraft.client.color.block.BlockTintSource) null";
      const model = `new net.minecraft.client.renderer.block.FluidModel.Unbaked(${material(textureId(env, f, "still"))}, ${material(textureId(env, f, "flow"))}, null, ${tintArg})`;
      if (env.loader === "fabric") {
        out.push(`net.fabricmc.fabric.api.client.render.fluid.v1.FluidRenderingRegistry.register(${r.source}, ${r.flowing}, ${model});`);
      } else {
        out.push(`modBus.addListener(net.neoforged.neoforge.client.event.RegisterFluidModelsEvent.class, event -> {
            net.minecraft.client.renderer.block.FluidModel.Unbaked model = ${model};
            event.register(model, ${r.source});
            event.register(model, ${r.flowing});
        });`);
      }
    } else if (env.loader === "fabric") {
      const id = (path: string) => idExpr(env, path);
      const color = tint ? `
            @Override
            public int getFluidColor(net.minecraft.world.level.BlockAndTintGetter world, net.minecraft.core.BlockPos pos, net.minecraft.world.level.material.FluidState state) {
                return world == null || pos == null ? ${TINT_COLORS[tint] ?? -1} : ${colorAt(env, tint, "world", "pos")};
            }
        ` : "";
      out.push(`net.fabricmc.fabric.api.client.render.fluid.v1.FluidRenderHandlerRegistry.INSTANCE.register(${r.source}, ${r.flowing}, new net.fabricmc.fabric.api.client.render.fluid.v1.SimpleFluidRenderHandler(${id(textureId(env, f, "still"))}, ${id(textureId(env, f, "flow"))}) {${color}});`);
      if (!lava(f)) out.push(`net.fabricmc.fabric.api.blockrenderlayer.v1.BlockRenderLayerMap.INSTANCE.putFluids(net.minecraft.client.renderer.RenderType.translucent(), ${r.source}, ${r.flowing});`);
    } else if (env.loader === "neoforge") {
      out.push(neoForgeExtensions1215(env, f));
      if (!lava(f)) {
        out.push(`modBus.addListener(net.neoforged.fml.event.lifecycle.FMLClientSetupEvent.class, event -> event.enqueueWork(() -> {
            net.minecraft.client.renderer.ItemBlockRenderTypes.setRenderLayer(${r.source}, net.minecraft.client.renderer.RenderType.translucent());
            net.minecraft.client.renderer.ItemBlockRenderTypes.setRenderLayer(${r.flowing}, net.minecraft.client.renderer.RenderType.translucent());
        }));`);
      }
    } else {
      if (!lava(f)) {
        out.push(`modBus.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent.class, event -> event.enqueueWork(() -> {
            net.minecraft.client.renderer.RenderTypeLookup.setRenderLayer(${r.source}, net.minecraft.client.renderer.RenderType.translucent());
            net.minecraft.client.renderer.RenderTypeLookup.setRenderLayer(${r.flowing}, net.minecraft.client.renderer.RenderType.translucent());
        }));`);
      }
      if (f.hasFog === true) out.push(legacyFog(env, f));
      if (str(f.textureRenderOverlay)) out.push(legacyOverlay(env, f));
    }
    if (env.mc === "26.3" && env.loader === "neoforge") out.push(neoForgeExtensions26(env, f));
  }
  return out.filter(Boolean);
}

/** NeoForge 1.21.5 client fluid type: textures, tint, screen overlay and fog. */
function neoForgeExtensions1215(env: GenEnv, f: Element): string {
  const r = refs(env, f);
  const id = (path: string) => idExpr(env, path);
  const RL = "net.minecraft.resources.ResourceLocation";
  const tint = tintOf(f);
  const members = [
    `@Override public ${RL} getStillTexture() { return ${id(textureId(env, f, "still"))}; }`,
    `@Override public ${RL} getFlowingTexture() { return ${id(textureId(env, f, "flow"))}; }`,
  ];
  if (tint) {
    members.push(`@Override public int getTintColor() { return ${TINT_COLORS[tint] ?? -1}; }`);
    members.push(`@Override public int getTintColor(net.minecraft.world.level.material.FluidState state, net.minecraft.world.level.BlockAndTintGetter world, net.minecraft.core.BlockPos pos) { return ${colorAt(env, tint, "world", "pos")}; }`);
  }
  if (str(f.textureRenderOverlay)) members.push(`@Override public ${RL} getRenderOverlayTexture(net.minecraft.client.Minecraft minecraft) { return ${id(`${env.modId}:textures/misc/${f.id}_overlay.png`)}; }`);
  if (f.hasFog === true) {
    if (str(f.fogColor)) {
      const [red, green, blue] = rgb(str(f.fogColor));
      members.push(`@Override public org.joml.Vector4f modifyFogColor(net.minecraft.client.Camera camera, float partialTick, net.minecraft.client.multiplayer.ClientLevel level, int renderDistance, float darkenWorldAmount, org.joml.Vector4f fluidFogColor) { return new org.joml.Vector4f(${red}F, ${green}F, ${blue}F, fluidFogColor.w); }`);
    }
    const fog = fogCalls(env, f, "camera.getEntity()", "camera.getEntity().level()");
    members.push(`@Override public net.minecraft.client.renderer.FogParameters modifyFogRender(net.minecraft.client.Camera camera, net.minecraft.client.renderer.FogRenderer.FogMode mode, float renderDistance, float partialTick, net.minecraft.client.renderer.FogParameters fog) {
                return new net.minecraft.client.renderer.FogParameters(${fog.start}, Math.min(${fog.end}, renderDistance), fog.shape(), fog.red(), fog.green(), fog.blue(), fog.alpha());
            }`);
  }
  return `modBus.addListener(net.neoforged.neoforge.client.extensions.common.RegisterClientExtensionsEvent.class, event -> event.registerFluidType(new net.neoforged.neoforge.client.extensions.common.IClientFluidTypeExtensions() {
            ${members.join("\n            ")}
        }, ${r.type}));`;
}

/** NeoForge 26.x client fluid type: screen overlay and fog (textures and tint are in the fluid model). */
function neoForgeExtensions26(env: GenEnv, f: Element): string {
  const r = refs(env, f);
  const members: string[] = [];
  if (str(f.textureRenderOverlay)) members.push(`@Override public net.minecraft.resources.Identifier getRenderOverlayTexture(net.minecraft.client.Minecraft minecraft) { return ${idExpr(env, `${env.modId}:textures/misc/${f.id}_overlay.png`)}; }`);
  if (f.hasFog === true) {
    if (str(f.fogColor)) {
      const [red, green, blue] = rgb(str(f.fogColor));
      members.push(`@Override public void modifyFogColor(net.minecraft.client.Camera camera, float partialTick, net.minecraft.client.multiplayer.ClientLevel level, int renderDistance, float darkenWorldAmount, org.joml.Vector4f fluidFogColor) { fluidFogColor.set(${red}F, ${green}F, ${blue}F, fluidFogColor.w); }`);
    }
    const fog = fogCalls(env, f, "camera.entity()", "camera.entity().level()");
    members.push(`@Override public void modifyFogRender(net.minecraft.client.Camera camera, net.minecraft.client.renderer.fog.environment.FogEnvironment environment, float renderDistance, float partialTick, net.minecraft.client.renderer.fog.FogData fog) {
                fog.environmentalStart = ${fog.start};
                fog.environmentalEnd = Math.min(${fog.end}, renderDistance);
            }`);
  }
  if (!members.length) return "";
  return `modBus.addListener(net.neoforged.neoforge.client.extensions.common.RegisterClientExtensionsEvent.class, event -> event.registerFluidType(new net.neoforged.neoforge.client.extensions.common.IClientFluidTypeExtensions() {
            ${members.join("\n            ")}
        }, ${r.type}));`;
}

/** Forge 1.16.5 fog inside the fluid: color and distance events on the game bus. */
function legacyFog(env: GenEnv, f: Element): string {
  const r = refs(env, f);
  const inFluid = `event.getInfo().getFluidInCamera().getType().isSame(${r.source})`;
  const parts: string[] = [];
  if (str(f.fogColor)) {
    const [red, green, blue] = rgb(str(f.fogColor));
    parts.push(`net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.client.event.EntityViewRenderEvent.FogColors.class, event -> {
            if (!${inFluid}) return;
            event.setRed(${red}F);
            event.setGreen(${green}F);
            event.setBlue(${blue}F);
        });`);
  }
  const fog = fogCalls(env, f, "entity", "entity.level");
  parts.push(`net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.client.event.EntityViewRenderEvent.RenderFogEvent.class, event -> {
            if (!${inFluid}) return;
            net.minecraft.entity.Entity entity = event.getInfo().getEntity();
            com.mojang.blaze3d.systems.RenderSystem.fogStart(${fog.start});
            com.mojang.blaze3d.systems.RenderSystem.fogEnd(Math.min(${fog.end}, event.getFarPlaneDistance()));
        });`);
  return parts.join("\n        ");
}

export default {
  element,
  runtime(contexts, env) {
    if (!contexts.length) return {};
    const fluids = contexts as unknown as Element[];
    const holder = holderClass(env, fluids);
    return {
      sources: [holder.source, ...fluids.flatMap((f) => [fluidClass(env, f), blockClass(env, f)])],
      init: [holder.init],
      clientInit: clientInit(env, fluids),
    };
  },
} satisfies TypeModule;
