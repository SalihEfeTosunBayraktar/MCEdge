import type { Element } from "../../elements/model.ts";
import { asProgram, isNode, mainStack, type BlockNode } from "../../procedures/model.ts";
import { blockExpr, idExpr, itemExpr, itemTagExpr, jfloat, qualify, str } from "../java.ts";
import { buildWarning, procedureCallById } from "../procedures.ts";
import type { GenEnv } from "../typeModule.ts";

/**
 * The AI goals field (aixml) of a living entity: the goal blocks under the start block become goalSelector /
 * targetSelector entries in registerGoals, the first block with the highest priority. Each goal may have a start
 * and a keep-going condition procedure (x, y, z, world, entity = the mob).
 */

export interface MobTraits {
  /** Simple name of the entity class, for `<Cls>.this`. */
  cls: string;
  /** Fully qualified entity class. */
  fqn: string;
  pathfinder: boolean;
  tamable: boolean;
  animal: boolean;
  flying: boolean;
  water: boolean;
  /** Entity class of this mod's living entity ids. */
  mobClass: (id: string) => string | undefined;
}

export interface Goals {
  lines: string[];
  /** Ids of the goal blocks used (for attributes and navigation set-up). */
  blocks: Set<string>;
}

export function goalBlocks(e: Element): BlockNode[] {
  const stack = mainStack(asProgram(e.aixml));
  return (stack?.blocks ?? []).slice(1).filter((n) => isNode(n) && !n.disabled && n.block.startsWith("ai_"));
}

export function compileGoals(env: GenEnv, e: Element, t: MobTraits): Goals {
  const legacy = env.mc === "1.16.5";
  const G = legacy ? "net.minecraft.entity.ai.goal" : "net.minecraft.world.entity.ai.goal";
  const GT = legacy ? G : `${G}.target`;
  const N = legacy
    ? { Living: "net.minecraft.entity.LivingEntity", Player: "net.minecraft.entity.player.PlayerEntity", Vec: "net.minecraft.util.math.vector.Vector3d", level: "level", Flag: `${G}.Goal.Flag` }
    : { Living: "net.minecraft.world.entity.LivingEntity", Player: "net.minecraft.world.entity.player.Player", Vec: "net.minecraft.world.phys.Vec3", level: "level()", Flag: `${G}.Goal.Flag` };
  const self = `${t.cls}.this`;
  const where = (n: BlockNode) => `living_entity/${e.id}: AI goal ${n.block}`;
  const at = { x: `${self}.getX()`, y: `${self}.getY()`, z: `${self}.getZ()`, world: `${self}.${N.level}`, entity: self };
  const lines: string[] = [];
  const blocks = new Set<string>();
  const nodes = goalBlocks(e);
  nodes.forEach((n, index) => {
    const prio = index + 1;
    const f = (name: string, d: unknown) => n.fields?.[name] ?? d;
    const numF = (name: string, d: number) => Number(f(name, d)) || 0;
    const speed = (d: number) => numF("speed", d);
    const skip = (why: string) => buildWarning(env, `${where(n)} is left out: ${why}`);
    // Start / keep-going conditions as overrides inside the goal's anonymous class.
    const start = procedureCallById(env, f("condition", ""), at, where(n), "logic");
    const keep = procedureCallById(env, f("continueCondition", ""), at, where(n), "logic");
    const conds = [
      start ? `            @Override\n            public boolean canUse() {\n                return super.canUse() && ${start};\n            }` : "",
      keep ? `            @Override\n            public boolean canContinueToUse() {\n                return super.canContinueToUse() && ${keep};\n            }` : "",
    ].filter(Boolean);
    const body = (extra: string[] = []) => (extra.length || conds.length ? ` {\n${[...extra, ...conds].join("\n\n")}\n        }` : "");
    const add = (selector: "goalSelector" | "targetSelector", create: string, extra: string[] = [], tail = "") => {
      lines.push(`this.${selector}.addGoal(${prio}, ${create}${body(extra)}${tail});`);
      blocks.add(n.block);
    };
    const need = (ok: boolean, why: string) => { if (!ok) skip(why); return ok; };
    const pathfinder = () => need(t.pathfinder, "the mob's base class does not path find");
    // Entity type tests: players and this mod's mobs by class, other types by registry id.
    const entityRef = (id: string) => {
      const q = qualify(env, id || "minecraft:player");
      if (q === "minecraft:player") return { cls: N.Player, test: undefined };
      const own = t.mobClass(q);
      if (own) return { cls: own, test: undefined };
      const type = legacy ? `net.minecraftforge.registries.ForgeRegistries.ENTITIES.getValue(${idExpr(env, q)})` : `net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getValue(${idExpr(env, q)})`;
      return { cls: N.Living, test: (v: string) => `${v}.getType() == ${type}` };
    };

    switch (n.block) {
      case "ai_float": add("goalSelector", `new ${G}.${legacy ? "SwimGoal" : "FloatGoal"}(this)`); break;
      case "ai_attack_melee":
        if (pathfinder()) add("goalSelector", `new ${G}.MeleeAttackGoal(this, ${speed(1.2)}, ${f("longMemory", false) === true})`);
        break;
      case "ai_attack_range_melee": {
        if (!pathfinder()) break;
        const r = numF("range", 2);
        add("goalSelector", `new ${G}.MeleeAttackGoal(this, ${speed(1.2)}, ${f("longMemory", false) === true})`, [legacy
          ? `            @Override\n            protected double getAttackReachSqr(${N.Living} target) {\n                return ${r * r};\n            }`
          : `            @Override\n            protected boolean canPerformAttack(${N.Living} target) {\n                return this.isTimeToAttack() && this.mob.distanceToSqr(target) < ${r * r} && this.mob.getSensing().hasLineOfSight(target);\n            }`]);
        break;
      }
      case "ai_attack_procedure": {
        const r = numF("range", 4);
        const attack = procedureCallById(env, f("procedure", ""), { x: "target.getX()", y: "target.getY()", z: "target.getZ()", world: `${self}.${N.level}`, entity: "target", sourceentity: self }, where(n));
        lines.push(`this.goalSelector.addGoal(${prio}, new ${G}.Goal() {
            private int cooldown = 0;

            {
                this.setFlags(java.util.EnumSet.of(${N.Flag}.MOVE, ${N.Flag}.LOOK));
            }

            @Override
            public boolean canUse() {
                ${N.Living} target = ${self}.getTarget();
                return target != null && target.isAlive()${start ? ` && ${start}` : ""};
            }

            @Override
            public boolean canContinueToUse() {
                return ${keep ? `${keep} && ` : ""}${self}.getTarget() != null && ${self}.getTarget().isAlive();
            }

            @Override
            public void start() {
                this.cooldown = 0;
            }

            @Override
            public void stop() {
                ${self}.getNavigation().stop();
            }

            @Override
            public void tick() {
                ${N.Living} target = ${self}.getTarget();
                if (target == null) return;
                boolean inRange = ${self}.distanceToSqr(target) <= ${r * r} && ${self}.getSensing().${legacy ? "canSee" : "hasLineOfSight"}(target);
                ${self}.getLookControl().setLookAt(target, 30.0F, 30.0F);
                if (inRange) ${self}.getNavigation().stop();
                else ${self}.getNavigation().moveTo(target, ${speed(1.2)});
                if (--this.cooldown <= 0 && inRange) {
                    this.cooldown = ${Math.max(1, Math.round(numF("interval", 20)))};
                    ${attack ? `${attack};` : ""}
                }
            }
        });`);
        blocks.add(n.block);
        break;
      }
      case "ai_attack_fly": {
        const hurt = legacy ? `${self}.doHurtTarget(target)` : `${self}.doHurtTarget(getServerLevel(target), target)`;
        lines.push(`this.goalSelector.addGoal(${prio}, new ${G}.Goal() {
            {
                this.setFlags(java.util.EnumSet.of(${N.Flag}.MOVE));
            }

            @Override
            public boolean canUse() {
                return ${self}.getTarget() != null && !${self}.getMoveControl().hasWanted()${start ? ` && ${start}` : ""};
            }

            @Override
            public boolean canContinueToUse() {
                return ${keep ? `${keep} && ` : ""}${self}.getMoveControl().hasWanted() && ${self}.getTarget() != null && ${self}.getTarget().isAlive();
            }

            @Override
            public void start() {
                ${N.Vec} eyes = ${self}.getTarget().getEyePosition(1.0F);
                ${self}.getMoveControl().setWantedPosition(eyes.x, eyes.y, eyes.z, ${speed(1)});
            }

            @Override
            public void tick() {
                ${N.Living} target = ${self}.getTarget();
                if (target == null) return;
                if (${self}.getBoundingBox().intersects(target.getBoundingBox())) {
                    ${hurt};
                } else if (${self}.distanceToSqr(target) < ${numF("radius", 16)}) {
                    ${N.Vec} eyes = target.getEyePosition(1.0F);
                    ${self}.getMoveControl().setWantedPosition(eyes.x, eyes.y, eyes.z, ${speed(1)});
                }
            }
        });`);
        blocks.add(n.block);
        break;
      }
      case "ai_leap": add("goalSelector", `new ${G}.LeapAtTargetGoal(this, ${jfloat(speed(0.5))})`); break;
      case "ai_panic": if (pathfinder()) add("goalSelector", `new ${G}.PanicGoal(this, ${speed(1.2)})`); break;
      case "ai_avoid_entity": {
        if (!pathfinder()) break;
        const ref = entityRef(str(f("entity", "minecraft:creeper")));
        const args = `${jfloat(numF("radius", 6))}, ${numF("farSpeed", 1)}, ${numF("nearSpeed", 1.2)}`;
        add("goalSelector", ref.test
          ? `new ${G}.AvoidEntityGoal<${ref.cls}>(this, ${ref.cls}.class, avoided -> ${ref.test("avoided")}, ${args}, avoided -> true)`
          : `new ${G}.AvoidEntityGoal<${ref.cls}>(this, ${ref.cls}.class, ${args})`);
        break;
      }
      case "ai_hurt_by_target":
        if (pathfinder()) add("targetSelector", `new ${GT}.HurtByTargetGoal(this)`, [], f("callHelp", false) === true ? ".setAlertOthers()" : "");
        break;
      case "ai_target_entity": {
        const ref = entityRef(str(f("entity", "minecraft:player")));
        const see = f("mustSee", false) === true; const reach = f("mustReach", false) === true;
        add("targetSelector", !ref.test
          ? `new ${GT}.NearestAttackableTargetGoal<${ref.cls}>(this, ${ref.cls}.class, ${see}, ${reach})`
          : legacy
            ? `new ${GT}.NearestAttackableTargetGoal<${ref.cls}>(this, ${ref.cls}.class, 10, ${see}, ${reach}, target -> ${ref.test("target")})`
            : `new ${GT}.NearestAttackableTargetGoal<${ref.cls}>(this, ${ref.cls}.class, 10, ${see}, ${reach}, (target, level) -> ${ref.test("target")})`);
        break;
      }
      case "ai_owner_hurt_target": if (need(t.tamable, "the mob is not tameable")) add("targetSelector", `new ${GT}.OwnerHurtTargetGoal(this)`); break;
      case "ai_owner_hurt_by_target": if (need(t.tamable, "the mob is not tameable")) add("targetSelector", `new ${GT}.OwnerHurtByTargetGoal(this)`); break;
      case "ai_follow_owner":
        if (need(t.tamable, "the mob is not tameable") && need(!t.water || t.flying, "water mobs cannot follow their owner"))
          add("goalSelector", `new ${G}.FollowOwnerGoal(this, ${speed(1)}, ${jfloat(numF("startDistance", 10))}, ${jfloat(numF("stopDistance", 2))}${legacy ? ", false" : ""})`);
        break;
      case "ai_follow_parent": if (need(t.animal, "the mob is not breedable")) add("goalSelector", `new ${G}.FollowParentGoal(this, ${speed(0.8)})`); break;
      case "ai_breed": if (need(t.animal, "the mob is not breedable")) add("goalSelector", `new ${G}.BreedGoal(this, ${speed(1)})`); break;
      case "ai_tempt": {
        if (!pathfinder()) break;
        const item = str(f("item", "minecraft:wheat")) || "minecraft:wheat";
        const scared = f("scared", false) === true;
        if (legacy) {
          const ing = item.startsWith("#") ? `net.minecraft.item.crafting.Ingredient.of(${itemTagExpr(env, qualify(env, item))})` : `net.minecraft.item.crafting.Ingredient.of(${itemExpr(env, item)})`;
          add("goalSelector", `new ${G}.TemptGoal(this, ${speed(1)}, ${ing}, ${scared})`);
        } else {
          const test = item.startsWith("#") ? `stack.is(${itemTagExpr(env, qualify(env, item))})` : `stack.is(${itemExpr(env, item)})`;
          add("goalSelector", `new ${G}.TemptGoal(this, ${speed(1)}, stack -> ${test}, ${scared})`);
        }
        break;
      }
      case "ai_follow_mob":
        if (need(!t.water || t.flying, "water mobs cannot follow mobs")) add("goalSelector", `new ${G}.FollowMobGoal(this, ${speed(1)}, ${jfloat(numF("stopDistance", 10))}, ${jfloat(numF("area", 5))})`);
        break;
      case "ai_follow_boat":
        if (!pathfinder()) break;
        add("goalSelector", env.mc === "26.3" ? `new ${G}.FollowPlayerRiddenEntityGoal(this, net.minecraft.world.entity.vehicle.boat.AbstractBoat.class)` : `new ${G}.FollowBoatGoal(this)`);
        break;
      case "ai_wander": if (pathfinder()) add("goalSelector", `new ${G}.${legacy ? "RandomWalkingGoal" : "RandomStrollGoal"}(this, ${speed(0.8)})`); break;
      case "ai_wander_avoid_water": if (pathfinder()) add("goalSelector", `new ${G}.${legacy ? "WaterAvoidingRandomWalkingGoal" : "WaterAvoidingRandomStrollGoal"}(this, ${speed(0.8)})`); break;
      case "ai_fly_random":
        if (pathfinder()) add("goalSelector", `new ${G}.${legacy ? "RandomWalkingGoal" : "RandomStrollGoal"}(this, ${speed(0.8)}, 20)`, [`            @Override
            protected ${N.Vec} getPosition() {
                double x = ${self}.getX() + (${self}.getRandom().nextFloat() * 2.0F - 1.0F) * 16.0F;
                double y = ${self}.getY() + (${self}.getRandom().nextFloat() * 2.0F - 1.0F) * 16.0F;
                double z = ${self}.getZ() + (${self}.getRandom().nextFloat() * 2.0F - 1.0F) * 16.0F;
                return new ${N.Vec}(x, y, z);
            }`]);
        break;
      case "ai_swim_random": if (pathfinder()) add("goalSelector", `new ${G}.RandomSwimmingGoal(this, ${speed(1)}, 40)`); break;
      case "ai_look_around": add("goalSelector", `new ${G}.${legacy ? "LookRandomlyGoal" : "RandomLookAroundGoal"}(this)`); break;
      case "ai_watch_entity": {
        const ref = entityRef(str(f("entity", "minecraft:player")));
        add("goalSelector", `new ${G}.${legacy ? "LookAtGoal" : "LookAtPlayerGoal"}(this, ${ref.cls}.class, ${jfloat(numF("radius", 6))})`, ref.test ? [`            @Override
            public boolean canUse() {
                return super.canUse() && this.lookAt != null && ${ref.test("this.lookAt")}${start ? ` && ${start}` : ""};
            }`] : []);
        break;
      }
      case "ai_breathe_air": if (pathfinder()) add("goalSelector", `new ${G}.${legacy ? "BreatheAirGoal" : "BreathAirGoal"}(this)`); break;
      case "ai_find_water":
        if (pathfinder()) add("goalSelector", legacy ? `new ${G}.FindWaterGoal(this)` : env.mc === "26.3" ? `new ${G}.TryFindLiquidGoal(this, net.minecraft.tags.FluidTags.WATER)` : `new ${G}.TryFindWaterGoal(this)`);
        break;
      case "ai_climb_powder_snow":
        if (need(!legacy, "powder snow came with 1.17")) add("goalSelector", `new ${G}.ClimbOnTopOfPowderSnowGoal(this, this.level())`);
        break;
      case "ai_restrict_sun": if (pathfinder()) add("goalSelector", `new ${G}.RestrictSunGoal(this)`); break;
      case "ai_move_indoors": if (pathfinder()) add("goalSelector", `new ${G}.${legacy ? "ReturnToVillageGoal" : "MoveBackToVillageGoal"}(this, 0.6, false)`); break;
      case "ai_doors_open":
        if (need(!t.flying && !t.water, "flying and water mobs do not use doors")) add("goalSelector", `new ${G}.OpenDoorGoal(this, ${f("mode", "open") === "open_and_close"})`);
        break;
      case "ai_doors_break":
        if (need(!t.flying && !t.water, "flying and water mobs do not use doors")) add("goalSelector", `new ${G}.BreakDoorGoal(this, difficulty -> true)`);
        break;
      case "ai_eat_grass": add("goalSelector", `new ${G}.${legacy ? "EatGrassGoal" : "EatBlockGoal"}(this)`); break;
      case "ai_break_blocks":
        if (pathfinder()) add("goalSelector", `new ${G}.${legacy ? "BreakBlockGoal" : "RemoveBlockGoal"}(${blockExpr(env, str(f("block", "minecraft:sand")) || "minecraft:sand")}, this, ${speed(1)}, ${Math.round(numF("height", 3))})`);
        break;
      default: skip("unknown goal block");
    }
  });
  if (blocks.has("ai_doors_open") || blocks.has("ai_doors_break")) {
    lines.unshift(legacy
      ? "if (this.getNavigation() instanceof net.minecraft.pathfinding.GroundPathNavigator) ((net.minecraft.pathfinding.GroundPathNavigator) this.getNavigation()).setCanOpenDoors(true);"
      : "this.getNavigation().getNodeEvaluator().setCanOpenDoors(true);");
  }
  return { lines, blocks };
}
