import type { Element } from "../../elements/model.ts";
import { entityTypeClass, entityTypeValue, rendererRegistration } from "../entities.ts";
import { idExpr, itemExpr, qualify, str } from "../java.ts";
import { buildWarning, procedureCall } from "../procedures.ts";
import { modelClass, modelExists, modelOutputs } from "../mob/models.ts";
import type { ElementContext, GenEnv, JavaSourceFile, TypeModule } from "../typeModule.ts";

/**
 * Projectiles are arrows (AbstractArrow) rendered as their item, with this element's damage, knockback, gravity
 * and fire settings applied on creation, so every way of spawning one (the shoot block, /summon, a ranged mob)
 * behaves the same. `power` scales the speed of the class's static shoot helper. The action sound plays whenever
 * the projectile is shot. A project model (models/<name>.java or .bbmodel) is drawn with the model texture, turned
 * along the flight like an arrow; otherwise the item is drawn.
 */

const REGISTRY = "Projectiles";

interface Names {
  World: string;
  Base: string;
  ItemSupplier: string;
  ItemStack: string;
  LivingEntity: string;
  Entity: string;
  Player: string;
  EntityHit: string;
  BlockHit: string;
  SoundSource: string;
}

function names(env: GenEnv): Names {
  if (env.mc === "1.16.5") {
    return {
      World: "net.minecraft.world.World",
      Base: "net.minecraft.entity.projectile.AbstractArrowEntity",
      ItemSupplier: "net.minecraft.entity.IRendersAsItem",
      ItemStack: "net.minecraft.item.ItemStack",
      LivingEntity: "net.minecraft.entity.LivingEntity",
      Entity: "net.minecraft.entity.Entity",
      Player: "net.minecraft.entity.player.PlayerEntity",
      EntityHit: "net.minecraft.util.math.EntityRayTraceResult",
      BlockHit: "net.minecraft.util.math.BlockRayTraceResult",
      SoundSource: "net.minecraft.util.SoundCategory",
    };
  }
  return {
    World: "net.minecraft.world.level.Level",
    Base: env.mc === "26.3" ? "net.minecraft.world.entity.projectile.arrow.AbstractArrow" : "net.minecraft.world.entity.projectile.AbstractArrow",
    ItemSupplier: "net.minecraft.world.entity.projectile.ItemSupplier",
    ItemStack: "net.minecraft.world.item.ItemStack",
    LivingEntity: "net.minecraft.world.entity.LivingEntity",
    Entity: "net.minecraft.world.entity.Entity",
    Player: "net.minecraft.world.entity.player.Player",
    EntityHit: "net.minecraft.world.phys.EntityHitResult",
    BlockHit: "net.minecraft.world.phys.BlockHitResult",
    SoundSource: "net.minecraft.sounds.SoundSource",
  };
}

function soundExpr(env: GenEnv, sound: string): string {
  const id = idExpr(env, qualify(env, sound));
  return env.mc === "1.16.5"
    ? `net.minecraftforge.registries.ForgeRegistries.SOUND_EVENTS.getValue(${id})`
    : `net.minecraft.core.registries.BuiltInRegistries.SOUND_EVENT.getValue(${id})`;
}

function entityClass(env: GenEnv, p: ElementContext): JavaSourceFile {
  const pkg = env.project.mod.package;
  const legacy = env.mc === "1.16.5";
  const n = names(env);
  const cls = String(p.className);
  const element = p as unknown as Element;
  const level = legacy ? "this.level" : "this.level()";
  const item = `new ${n.ItemStack}(${itemExpr(env, str(p.projectileItem) || "minecraft:arrow")})`;
  const call = (field: string, deps: Record<string, string>) => procedureCall(env, "projectile", element, field, deps);
  const at = { x: "this.getX()", y: "this.getY()", z: "this.getZ()", world: level, immediatesourceentity: "this" };
  const members: string[] = [];

  const onEntity = call("onHitsEntity", { ...at, entity: "hit.getEntity()", sourceentity: "this.getOwner()" });
  if (onEntity) {
    members.push(`    @Override
    protected void onHitEntity(${n.EntityHit} hit) {
        super.onHitEntity(hit);
        ${onEntity};
    }`);
  }
  const onBlock = call("onHitsBlock", { ...at, x: "hit.getBlockPos().getX()", y: "hit.getBlockPos().getY()", z: "hit.getBlockPos().getZ()", entity: "this.getOwner()" });
  if (onBlock) {
    members.push(`    @Override
    protected void onHitBlock(${n.BlockHit} hit) {
        super.onHitBlock(hit);
        ${onBlock};
    }`);
  }
  const onPlayer = call("onHitsPlayer", { ...at, entity: "player", sourceentity: "this.getOwner()" });
  if (onPlayer) {
    members.push(`    @Override
    public void playerTouch(${n.Player} player) {
        super.playerTouch(player);
        ${onPlayer};
    }`);
  }
  const onTick = call("onFlyingTick", { ...at, entity: "this.getOwner()" });
  const inGround = legacy ? "this.inGround" : "this.isInGround()";
  if (onTick || p.disableDiscarding !== true) {
    members.push(`    @Override
    public void tick() {
        super.tick();${onTick ? `\n        ${onTick};` : ""}${p.disableDiscarding !== true ? `\n        if (${inGround}) this.${legacy ? "remove" : "discard"}();` : ""}
    }`);
  }

  const knockback = Math.max(0, Math.round(Number(p.knockback) || 0));
  if (!legacy && knockback > 0) {
    // Modern arrows lost setKnockback; push the target the way 1.16.5 arrows did.
    members.push(`    @Override
    protected void doKnockback(${n.LivingEntity} target, net.minecraft.world.damagesource.DamageSource source) {
        double resistance = Math.max(0.0, 1.0 - target.getAttributeValue(net.minecraft.world.entity.ai.attributes.Attributes.KNOCKBACK_RESISTANCE));
        net.minecraft.world.phys.Vec3 push = this.getDeltaMovement().multiply(1.0, 0.0, 1.0).normalize().scale(${knockback} * 0.6 * resistance);
        if (push.lengthSqr() > 0.0) target.push(push.x, 0.1, push.z);
    }`);
  }

  if (p.disableGravity === true) {
    // An override, not setNoGravity: /summon loads a missing NoGravity tag as false.
    members.push(`    @Override
    public boolean isNoGravity() {
        return true;
    }`);
  }

  const sound = str(p.actionSound);
  if (sound) {
    members.push(`    @Override
    public void shootFromRotation(${n.Entity} shooter, float xRot, float yRot, float yOffset, float speed, float inaccuracy) {
        super.shootFromRotation(shooter, xRot, yRot, yOffset, speed, inaccuracy);
        if (!${level}.isClientSide()) ${level}.playSound(null, shooter.getX(), shooter.getY(), shooter.getZ(), ${soundExpr(env, sound)}, ${n.SoundSource}.PLAYERS, 1.0F, 1.0F / (this.random.nextFloat() * 0.5F + 1.0F) + speed / 2.0F);
    }`);
  }

  const setup = [
    `this.setBaseDamage(${Number(p.damage) || 0});`,
    `this.setCritArrow(${p.showParticles === true});`,
    ...(legacy && knockback > 0 ? [`this.setKnockback(${knockback});`] : []),
    ...(p.igniteFire === true ? [legacy ? "this.setSecondsOnFire(100);" : "this.igniteForSeconds(100.0F);"] : []),
  ];
  const type = `${legacy ? "net.minecraft.entity.EntityType" : "net.minecraft.world.entity.EntityType"}<? extends ${cls}>`;
  const code = `package ${pkg}.entity;

/** Generated by MCEdge. */${legacy ? "\n// IRendersAsItem only exists on the client; Forge strips it from the class on a dedicated server.\n@net.minecraftforge.api.distmarker.OnlyIn(value = net.minecraftforge.api.distmarker.Dist.CLIENT, _interface = net.minecraft.entity.IRendersAsItem.class)" : ""}
public class ${cls} extends ${n.Base} implements ${n.ItemSupplier} {
    public ${cls}(${type} type, ${n.World} world) {
        super(type, world);
${setup.map((s) => `        ${s}`).join("\n")}
    }

    /** Shoots one from the shooter's eyes along its view, with this projectile's power. */
    public static ${cls} shoot(${n.LivingEntity} shooter) {
        ${cls} projectile = new ${cls}(${entityTypeValue(env, REGISTRY, String(p.constant))}, shooter.${legacy ? "level" : "level()"});
        projectile.setOwner(shooter);
        projectile.setPos(shooter.getX(), shooter.getEyeY() - 0.1, shooter.getZ());
        projectile.shootFromRotation(shooter, shooter.${legacy ? "xRot" : "getXRot()"}, shooter.${legacy ? "yRot" : "getYRot()"}, 0.0F, ${Number(p.power) || 1}F * 3.0F, 1.0F);
        shooter.${legacy ? "level" : "level()"}.addFreshEntity(projectile);
        return projectile;
    }

    /** Shoots one from the shooter at a target (ranged mobs), arcing like a skeleton's arrow. */
    public static ${cls} shoot(${n.LivingEntity} shooter, ${n.LivingEntity} target) {
        ${cls} projectile = new ${cls}(${entityTypeValue(env, REGISTRY, String(p.constant))}, shooter.${legacy ? "level" : "level()"});
        projectile.setOwner(shooter);
        projectile.setPos(shooter.getX(), shooter.getEyeY() - 0.1, shooter.getZ());
        double dx = target.getX() - shooter.getX();
        double dy = target.getY(0.3333333333333333) - projectile.getY();
        double dz = target.getZ() - shooter.getZ();
        projectile.shoot(dx, dy + Math.sqrt(dx * dx + dz * dz) * 0.2, dz, ${Number(p.power) || 1}F * 1.6F, 2.0F);
        shooter.${legacy ? "level" : "level()"}.addFreshEntity(projectile);
        return projectile;
    }

    @Override
    public ${n.ItemStack} getItem() {
        return ${item};
    }

    @Override
    protected ${n.ItemStack} ${legacy ? "getPickupItem" : "getDefaultPickupItem"}() {
        return ${item};
    }
${legacy ? `
    @Override
    public net.minecraft.network.IPacket<?> getAddEntityPacket() {
        return net.minecraftforge.fml.network.NetworkHooks.getEntitySpawningPacket(this);
    }
` : ""}
${members.join("\n\n")}
}
`;
  return { path: `${pkg.replaceAll(".", "/")}/entity/${cls}.java`, code };
}

function rendererFactory(env: GenEnv, p: ElementContext): string {
  if (modelExists(env, str(p.entityModel))) return `${env.project.mod.package}.client.${p.className}Renderer::new`;
  if (env.mc === "1.16.5") return "manager -> new net.minecraft.client.renderer.entity.SpriteRenderer<>(manager, net.minecraft.client.Minecraft.getInstance().getItemRenderer())";
  return "net.minecraft.client.renderer.entity.ThrownItemRenderer::new";
}

/** A projectile drawn with a project model (models/), turned along its flight like an arrow. */
function modelRenderer(env: GenEnv, p: ElementContext): JavaSourceFile {
  const pkg = env.project.mod.package;
  const cls = `${p.className}Renderer`;
  const entity = `${pkg}.entity.${p.className}`;
  const model = modelClass(env, str(p.entityModel));
  const texture = idExpr(env, `${env.modId}:textures/entity/${p.id}.png`);
  let code: string;
  if (env.mc === "1.16.5") {
    code = `package ${pkg}.client;

/** Generated by MCEdge. */
public class ${cls} extends net.minecraft.client.renderer.entity.EntityRenderer<${entity}> {
    private static final net.minecraft.util.ResourceLocation TEXTURE = ${texture};
    private final ${model}<${entity}> model = new ${model}<>();

    public ${cls}(net.minecraft.client.renderer.entity.EntityRendererManager manager) {
        super(manager);
    }

    @Override
    public void render(${entity} entity, float yaw, float partialTicks, com.mojang.blaze3d.matrix.MatrixStack pose, net.minecraft.client.renderer.IRenderTypeBuffer buffers, int light) {
        pose.pushPose();
        pose.mulPose(net.minecraft.util.math.vector.Vector3f.YP.rotationDegrees(net.minecraft.util.math.MathHelper.lerp(partialTicks, entity.yRotO, entity.yRot) - 90.0F));
        pose.mulPose(net.minecraft.util.math.vector.Vector3f.ZP.rotationDegrees(net.minecraft.util.math.MathHelper.lerp(partialTicks, entity.xRotO, entity.xRot)));
        pose.scale(-1.0F, -1.0F, 1.0F);
        pose.translate(0.0, -1.501, 0.0);
        this.model.setupAnim(entity, 0.0F, 0.0F, entity.tickCount + partialTicks, 0.0F, 0.0F);
        this.model.renderToBuffer(pose, buffers.getBuffer(this.model.renderType(TEXTURE)), light, net.minecraft.client.renderer.texture.OverlayTexture.NO_OVERLAY, 1.0F, 1.0F, 1.0F, 1.0F);
        pose.popPose();
        super.render(entity, yaw, partialTicks, pose, buffers, light);
    }

    @Override
    public net.minecraft.util.ResourceLocation getTextureLocation(${entity} entity) {
        return TEXTURE;
    }
}
`;
  } else {
    const v26 = env.mc === "26.3";
    const id = v26 ? "net.minecraft.resources.Identifier" : "net.minecraft.resources.ResourceLocation";
    const S = "net.minecraft.client.renderer.entity.state.LivingEntityRenderState";
    const turn = (axis: string, angle: string) => (v26 ? `pose.rotateDegrees(com.mojang.math.Axis.${axis}, ${angle});` : `pose.mulPose(com.mojang.math.Axis.${axis}.rotationDegrees(${angle}));`);
    const draw = v26
      ? "collector.submitModel(this.model, state, pose, this.model.renderType(TEXTURE), state.lightCoords, net.minecraft.client.renderer.texture.OverlayTexture.NO_OVERLAY, state.outlineColor);"
      : "this.model.renderToBuffer(pose, buffers.getBuffer(this.model.renderType(TEXTURE)), light, net.minecraft.client.renderer.texture.OverlayTexture.NO_OVERLAY);";
    const signature = v26
      ? "public void submit(State state, com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.SubmitNodeCollector collector, net.minecraft.client.renderer.state.level.CameraRenderState camera)"
      : "public void render(State state, com.mojang.blaze3d.vertex.PoseStack pose, net.minecraft.client.renderer.MultiBufferSource buffers, int light)";
    const sup = v26 ? "super.submit(state, pose, collector, camera);" : "super.render(state, pose, buffers, light);";
    code = `package ${pkg}.client;

/** Generated by MCEdge. */
public class ${cls} extends net.minecraft.client.renderer.entity.EntityRenderer<${entity}, ${cls}.State> {
    private static final ${id} TEXTURE = ${texture};
    private final ${model} model;

    /** The model's state type with the projectile's flight angles. */
    public static class State extends ${S} {
        public float flightYaw;
        public float flightPitch;
    }

    public ${cls}(net.minecraft.client.renderer.entity.EntityRendererProvider.Context context) {
        super(context);
        this.model = new ${model}(context.bakeLayer(${model}.LAYER_LOCATION));
    }

    @Override
    public State createRenderState() {
        return new State();
    }

    @Override
    public void extractRenderState(${entity} entity, State state, float partialTicks) {
        super.extractRenderState(entity, state, partialTicks);
        state.flightYaw = entity.getYRot(partialTicks);
        state.flightPitch = entity.getXRot(partialTicks);
    }

    @Override
    ${signature} {
        pose.pushPose();
        ${turn("YP", "state.flightYaw - 90.0F")}
        ${turn("ZP", "state.flightPitch")}
        pose.scale(-1.0F, -1.0F, 1.0F);
        pose.translate(0.0, -1.501, 0.0);
        this.model.setupAnim(state);
        ${draw}
        pose.popPose();
        ${sup}
    }
}
`;
  }
  return { path: `${pkg.replaceAll(".", "/")}/client/${cls}.java`, code };
}

export default {
  element(projectile, env) {
    const model = modelExists(env, str(projectile.entityModel));
    if (str(projectile.entityModel) && str(projectile.entityModel) !== "Default" && !model) {
      buildWarning(env, `projectile/${projectile.id}: model "${str(projectile.entityModel)}" is not a project model (models/<name>.java or .bbmodel); the item is drawn`);
    }
    return {
      lang: { [`entity.${env.modId}.${projectile.id}`]: str(projectile.title) || String(projectile.id) },
      textures: model && str(projectile.customModelTexture) ? [{ from: str(projectile.customModelTexture), to: `entity/${projectile.id}` }] : [],
    };
  },
  runtime(projectiles, env) {
    if (!projectiles.length) return {};
    const pkg = env.project.mod.package;
    const types = entityTypeClass(env, REGISTRY, projectiles.map((p) => ({
      constant: String(p.constant),
      id: String(p.id),
      entityClass: `${pkg}.entity.${p.className}`,
      category: "MISC",
      width: Number(p.modelWidth) || 0.5,
      height: Number(p.modelHeight) || 0.5,
      trackingRange: 4,
      updateInterval: 20,
    })));
    const renderers = projectiles.map((p) => ({ type: entityTypeValue(env, REGISTRY, String(p.constant)), factory: rendererFactory(env, p) }));
    const models = modelOutputs(env, "projectile");
    return {
      sources: [types.source, ...projectiles.map((p) => entityClass(env, p)), ...projectiles.filter((p) => modelExists(env, str(p.entityModel))).map((p) => modelRenderer(env, p)), ...models.sources],
      init: [types.init],
      clientInit: [...models.clientInit, rendererRegistration(env, renderers)],
    };
  },
} satisfies TypeModule;
