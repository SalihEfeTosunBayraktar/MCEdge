import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Element } from "../../elements/model.ts";
import { jfloat, pascal, str } from "../java.ts";
import { readPng } from "../png.ts";
import { procedureCall } from "../procedures.ts";
import { registryClass } from "../registries.ts";
import type { ElementContext, GenEnv, JavaSourceFile, TypeModule } from "../typeModule.ts";

/**
 * Particles: a simple particle type registered in <Mod>ParticleTypes plus a client particle class and its
 * provider, registered on the physical client. A texture taller than wide in whole squares is a strip of frames,
 * split into one sprite per frame. The rotation provider needs a vector-returning procedure, which procedures
 * cannot return yet, so it is not generated.
 */

const REG = "ParticleTypes";

/** Frames in a vertical strip texture (MCreator convention): height / width when that divides, else 1. */
function frameCount(env: GenEnv, texture: string): { frames: number; size: number } {
  try {
    const png = readPng(readFileSync(resolve(env.projectDir, texture)));
    const frames = png.height > png.width && png.height % png.width === 0 ? png.height / png.width : 1;
    return { frames, size: png.width };
  } catch {
    return { frames: 1, size: 16 };
  }
}

interface Names {
  base: string; level: string; sprites: string; provider: string; type: string; renderType: string; random: string;
}

function names(env: GenEnv): Names {
  if (env.mc === "1.16.5") {
    return {
      base: "net.minecraft.client.particle.SpriteTexturedParticle", level: "net.minecraft.client.world.ClientWorld",
      sprites: "net.minecraft.client.particle.IAnimatedSprite", provider: "net.minecraft.client.particle.IParticleFactory",
      type: "net.minecraft.particles.BasicParticleType", renderType: "net.minecraft.client.particle.IParticleRenderType", random: "",
    };
  }
  return {
    base: env.mc === "26.3" ? "net.minecraft.client.particle.SingleQuadParticle" : "net.minecraft.client.particle.TextureSheetParticle",
    level: "net.minecraft.client.multiplayer.ClientLevel", sprites: "net.minecraft.client.particle.SpriteSet",
    provider: "net.minecraft.client.particle.ParticleProvider", type: "net.minecraft.core.particles.SimpleParticleType",
    renderType: "net.minecraft.client.particle.ParticleRenderType", random: env.mc === "26.3" ? ", net.minecraft.util.RandomSource random" : "",
  };
}

function element(particle: Element, env: GenEnv): ElementContext {
  const n = names(env);
  const pkg = env.project.mod.package;
  const cls = `${pascal(particle.id)}Particle`;
  const texture = str(particle.texture);
  const { frames, size } = frameCount(env, texture);
  const sprites = frames > 1 ? Array.from({ length: frames }, (_, i) => `${particle.id}_${i + 1}`) : [particle.id];
  const textures = frames > 1
    ? sprites.map((name, i) => ({ from: texture, to: `particle/${name}`, remap: { base: size, width: size, height: size, rects: [{ x: 0, y: 0, w: size, h: size, u: 0, v: i * size }] } }))
    : [{ from: texture, to: `particle/${particle.id}` }];

  const animate = particle.animate === true;
  const scale = Number(particle.scale);
  const fixed = particle.fixedScale === true;
  const angular = Number(particle.angularVelocity) !== 0 || Number(particle.angularAcceleration) !== 0;
  const maxAge = Number(particle.maxAge), diff = Number(particle.maxAgeDiff);
  const deps = { x: "this.x", y: "this.y", z: "this.z", world: "this.level" };
  const scaleCall = procedureCall(env, "particle", particle, "scaleProcedure", deps);
  const expiry = procedureCall(env, "particle", particle, "additionalExpiryCondition", deps);
  const speed = Number(particle.speedFactor);
  const ctor = [
    `this.setSize(${jfloat(particle.width)}, ${jfloat(particle.height)});`,
    ...(!scaleCall && (scale !== 1 || fixed) ? [`this.quadSize ${fixed ? `= 0.15F *` : "*="} ${jfloat(scale)};`] : []),
    diff > 0 ? `this.lifetime = (int) Math.max(1, ${maxAge} + (this.random.nextInt(${diff * 2}) - ${diff}));` : `this.lifetime = ${maxAge};`,
    `this.gravity = ${jfloat(particle.gravity)};`,
    `this.hasPhysics = ${particle.canCollide === true};`,
    `this.xd = vx * ${speed};`, `this.yd = vy * ${speed};`, `this.zd = vz * ${speed};`,
    ...(angular ? [`this.angularVelocity = ${jfloat(particle.angularVelocity)};`, `this.angularAcceleration = ${jfloat(particle.angularAcceleration)};`] : []),
    ...(animate ? ["this.setSpriteFromAge(spriteSet);"] : env.mc === "26.3" ? [] : ["this.pickSprite(spriteSet);"]),
  ];
  const tick = [
    "super.tick();",
    ...(angular ? ["this.oRoll = this.roll;", "this.roll += this.angularVelocity;", "this.angularVelocity += this.angularAcceleration;"] : []),
    ...(animate && frames > 1 ? [`if (!this.removed) this.setSprite(this.spriteSet.get((this.age / ${Number(particle.frameDuration)}) % ${frames} + 1, ${frames}));`] : []),
    ...(expiry ? [`if (${expiry}) this.remove();`] : []),
  ];
  const renderType = str(particle.renderType);
  const members: string[] = [];
  if (particle.emissiveRendering === true) members.push(`    @Override\n    public int ${env.mc === "26.3" ? "getLightCoords" : "getLightColor"}(float partialTick) {\n        return 15728880;\n    }`);
  members.push(env.mc === "26.3"
    ? `    @Override\n    public ${n.base}.Layer getLayer() {\n        return ${n.base}.Layer.${renderType};\n    }`
    : `    @Override\n    public ${n.renderType} getRenderType() {\n        return ${n.renderType}.PARTICLE_SHEET_${renderType};\n    }`);
  if (scaleCall) members.push(`    @Override\n    public float getQuadSize(float partialTick) {\n        return ${fixed ? "0.15F" : "super.getQuadSize(partialTick)"} * (float) ${scaleCall};\n    }`);

  const superCall = env.mc === "26.3" ? "super(world, x, y, z, spriteSet.first());" : "super(world, x, y, z);";
  const code = `package ${pkg}.client.particle;

/** Generated by MCEdge. */
public class ${cls} extends ${n.base} {
    /** Creates the particle for its particle type. */
    public static class Provider implements ${n.provider}<${n.type}> {
        private final ${n.sprites} spriteSet;

        public Provider(${n.sprites} spriteSet) {
            this.spriteSet = spriteSet;
        }

        @Override
        public net.minecraft.client.particle.Particle createParticle(${n.type} type, ${n.level} world, double x, double y, double z, double vx, double vy, double vz${n.random}) {
            return new ${cls}(world, x, y, z, vx, vy, vz, this.spriteSet);
        }
    }

    private final ${n.sprites} spriteSet;
${angular ? "    private float angularVelocity;\n    private float angularAcceleration;\n" : ""}
    protected ${cls}(${n.level} world, double x, double y, double z, double vx, double vy, double vz, ${n.sprites} spriteSet) {
        ${superCall}
        this.spriteSet = spriteSet;
${ctor.map((line) => `        ${line}`).join("\n")}
    }

${members.join("\n\n")}

    @Override
    public void tick() {
${tick.map((line) => `        ${line}`).join("\n")}
    }
}
`;
  return {
    textures,
    files: [{ path: `assets/${env.modId}/particles/${particle.id}.json`, json: JSON.stringify({ textures: sprites.map((s) => `${env.modId}:${s}`) }, null, 2) }],
    particleSource: { path: `${pkg.replaceAll(".", "/")}/client/particle/${cls}.java`, code } satisfies JavaSourceFile,
    particleClass: `${pkg}.client.particle.${cls}`,
  };
}

/** Client registration of every particle's provider. */
function clientRegistration(env: GenEnv, owner: string, contexts: ElementContext[]): string {
  const type = (ctx: ElementContext) => `${owner}.${ctx.constant}`;
  const providers = contexts.map((ctx) => ({ type: type(ctx), provider: `${ctx.particleClass}.Provider::new` }));
  if (env.mc === "1.16.5") {
    return `modBus.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, net.minecraftforge.client.event.ParticleFactoryRegisterEvent.class, event -> {
${providers.map((p) => `            net.minecraft.client.Minecraft.getInstance().particleEngine.register(${p.type}.get(), ${p.provider});`).join("\n")}
        });`;
  }
  if (env.loader === "neoforge") {
    return `modBus.addListener(net.neoforged.neoforge.client.event.RegisterParticleProvidersEvent.class, event -> {
${providers.map((p) => `            event.registerSpriteSet(${p.type}.get(), ${p.provider});`).join("\n")}
        });`;
  }
  const registry = env.mc === "26.3" ? "net.fabricmc.fabric.api.client.particle.v1.ParticleProviderRegistry" : "net.fabricmc.fabric.api.client.particle.v1.ParticleFactoryRegistry";
  return providers.map((p) => `${registry}.getInstance().register((net.minecraft.core.particles.SimpleParticleType) ${p.type}.value(), ${p.provider});`).join("\n        ");
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => {
    if (!contexts.length) return {};
    const legacy = env.mc === "1.16.5";
    const reg = registryClass(env, {
      name: REG,
      valueType: legacy ? "net.minecraft.particles.BasicParticleType" : "net.minecraft.core.particles.SimpleParticleType",
      registryType: legacy ? "net.minecraft.particles.ParticleType<?>" : "net.minecraft.core.particles.ParticleType<?>",
      forge: "net.minecraftforge.registries.ForgeRegistries.PARTICLE_TYPES",
      key: "PARTICLE_TYPE",
      entries: contexts.map((ctx) => ({
        constant: String(ctx.constant),
        id: String(ctx.id),
        factory: legacy ? `new net.minecraft.particles.BasicParticleType(${ctx.alwaysShow === true})`
          : env.loader === "fabric" ? `net.fabricmc.fabric.api.particle.v1.FabricParticleTypes.simple(${ctx.alwaysShow === true})`
            : `new net.minecraft.core.particles.SimpleParticleType(${ctx.alwaysShow === true})`,
      })),
    });
    return {
      sources: [reg.source, ...contexts.map((ctx) => ctx.particleSource as JavaSourceFile)],
      init: [reg.init],
      clientInit: [clientRegistration(env, reg.owner, contexts)],
    };
  },
} satisfies TypeModule;
