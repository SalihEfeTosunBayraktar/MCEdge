import type { Element } from "../../elements/model.ts";
import { itemExpr, jfloat, list, qualify, str } from "../java.ts";
import type { ElementContext, GenEnv, ResourceFile, TagEntry, TypeModule } from "../typeModule.ts";

/**
 * Villager trades: offers added to a profession's trade levels (or the wandering trader's pools: level 1 common,
 * 2 special, 3 buying). 26.x trades are villager_trade files in the profession's per-level tags; earlier versions
 * add listings through the loader's trade events (Forge/NeoForge) or Fabric's trade offer helper.
 */

type Row = Record<string, unknown>;
const WANDERING_POOLS = ["common", "uncommon", "buying"];

const trades = (element: Element | ElementContext) => list<Row>(element.trades).filter((t) => str(t.price1) && str(t.offer));
const isWandering = (profession: string) => /(^|:)wandering_trader$/.test(profession);

function element(trade: Element, env: GenEnv): ElementContext {
  const profession = qualify(env, str(trade.villagerProfession));
  if (env.mc !== "26.3") return { profession };
  const files: ResourceFile[] = [];
  const tags: TagEntry[] = [];
  const [ns, prof] = profession.split(":");
  const stack = (ref: unknown, count: unknown) => ({ id: qualify(env, str(ref)), ...(Number(count) !== 1 ? { count: Number(count) } : {}) });
  trades(trade).forEach((t, i) => {
    const level = Number(t.level);
    const path = `${prof}/${level}/${trade.id}_${i}`;
    files.push({ path: `data/${env.modId}/villager_trade/${path}.json`, json: JSON.stringify({
      wants: stack(t.price1, t.countPrice1),
      ...(str(t.price2) ? { additional_wants: stack(t.price2, t.countPrice2) } : {}),
      gives: stack(t.offer, t.countOffer),
      max_uses: Number(t.maxTrades),
      xp: Number(t.xp),
      reputation_discount: Number(t.priceMultiplier),
    }, null, 2) });
    const tag = isWandering(profession) ? (level <= 3 ? `minecraft:wandering_trader/${WANDERING_POOLS[level - 1]}` : "") : `${ns}:${prof}/level_${level}`;
    if (tag) tags.push({ registry: "villager_trade", tag, value: `${env.modId}:${path}` });
  });
  return { files, tags };
}

/** Java expression of one listing (an ItemListing / ITrade lambda). */
function listing(env: GenEnv, t: Row): string {
  const legacy = env.mc === "1.16.5";
  const stack = (ref: unknown, count: unknown) => `new ${legacy ? "net.minecraft.item" : "net.minecraft.world.item"}.ItemStack(${itemExpr(env, str(ref))}, ${Number(count)})`;
  const tail = `${Number(t.maxTrades)}, ${Number(t.xp)}, ${jfloat(t.priceMultiplier)}`;
  if (legacy) {
    const second = str(t.price2) ? stack(t.price2, t.countPrice2) : "net.minecraft.item.ItemStack.EMPTY";
    return `(entity, random) -> new net.minecraft.item.MerchantOffer(${stack(t.price1, t.countPrice1)}, ${second}, ${stack(t.offer, t.countOffer)}, ${tail})`;
  }
  const cost = (ref: unknown, count: unknown) => `new net.minecraft.world.item.trading.ItemCost(${itemExpr(env, str(ref))}, ${Number(count)})`;
  const second = str(t.price2) ? `java.util.Optional.of(${cost(t.price2, t.countPrice2)})` : "java.util.Optional.empty()";
  return `(entity, random) -> new net.minecraft.world.item.trading.MerchantOffer(${cost(t.price1, t.countPrice1)}, ${second}, ${stack(t.offer, t.countOffer)}, ${tail})`;
}

/** Trade registrations for 1.16.5 and 1.21.5. */
function registrations(env: GenEnv, contexts: ElementContext[]): string[] {
  const legacy = env.mc === "1.16.5";
  const villager = contexts.filter((c) => !isWandering(String(c.profession)));
  const wandering = contexts.filter((c) => isWandering(String(c.profession)));
  const lines = (c: ElementContext, add: (t: Row, line: string) => string) => trades(c).map((t) => add(t, listing(env, t)));
  const out: string[] = [];
  const key = (id: string) => `net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.VILLAGER_PROFESSION, net.minecraft.resources.ResourceLocation.parse(${JSON.stringify(id)}))`;

  if (env.loader === "fabric") {
    const helper = "net.fabricmc.fabric.api.object.builder.v1.trade.TradeOfferHelper";
    for (const c of villager) {
      for (const t of trades(c)) out.push(`${helper}.registerVillagerOffers(${key(String(c.profession))}, ${Number(t.level)}, factories -> factories.add(${listing(env, t)}));`);
    }
    const pools = ["SELL_COMMON_ITEMS_POOL", "SELL_SPECIAL_ITEMS_POOL", "BUY_ITEMS_POOL"];
    const adds = wandering.flatMap((c) => trades(c).filter((t) => Number(t.level) <= 3).map((t) => `builder.addOffersToPool(${helper}.WanderingTraderOffersBuilder.${pools[Number(t.level) - 1]}, ${listing(env, t)});`));
    if (adds.length) out.push(`${helper}.registerWanderingTraderOffers(builder -> {\n            ${adds.join("\n            ")}\n        });`);
    return out;
  }
  const bus = legacy ? "net.minecraftforge.common.MinecraftForge.EVENT_BUS" : "net.neoforged.neoforge.common.NeoForge.EVENT_BUS";
  const events = legacy ? "net.minecraftforge.event.village" : "net.neoforged.neoforge.event.village";
  const listen = (event: string, body: string[]) => legacy
    ? `${bus}.addListener(net.minecraftforge.eventbus.api.EventPriority.NORMAL, false, ${events}.${event}.class, event -> {\n            ${body.join("\n            ")}\n        });`
    : `${bus}.addListener(${events}.${event}.class, event -> {\n            ${body.join("\n            ")}\n        });`;
  const villagerBody = villager.flatMap((c) => {
    const test = legacy ? `String.valueOf(event.getType().getRegistryName()).equals(${JSON.stringify(c.profession)})` : `event.getType().location().toString().equals(${JSON.stringify(c.profession)})`;
    const adds = lines(c, (t, l) => `event.getTrades().get(${Number(t.level)}).add(${l});`);
    return adds.length ? [`if (${test}) {\n                ${adds.join("\n                ")}\n            }`] : [];
  });
  if (villagerBody.length) out.push(listen("VillagerTradesEvent", villagerBody));
  // 1.16.5 has no buying pool; its buying offers join the generic ones.
  const pool = (level: number) => (level === 2 ? "getRareTrades()" : level === 3 && !legacy ? "getBuyingTrades()" : "getGenericTrades()");
  const wanderingBody = wandering.flatMap((c) => trades(c).filter((t) => Number(t.level) <= 3).map((t) => `event.${pool(Number(t.level))}.add(${listing(env, t)});`));
  if (wanderingBody.length) out.push(listen("WandererTradesEvent", wanderingBody));
  return out;
}

export default {
  element,
  runtime: (contexts: ElementContext[], env: GenEnv) => (env.mc === "26.3" || !contexts.length ? {} : { init: registrations(env, contexts) }),
} satisfies TypeModule;
