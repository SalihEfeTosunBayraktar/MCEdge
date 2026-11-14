import { newElement, type Element } from "../../elements/model.ts";
import { typeRegistry } from "../../elements/registry.ts";
import { list, str } from "../java.ts";
import { projectModelKind } from "../models.ts";
import { procedureBuild } from "../procedures.ts";
import type { GenEnv, TypeModule } from "../typeModule.ts";

/**
 * Plants are generated as blocks with a plant base (src/generator/plants.ts): the element becomes a block element
 * (block defaults, then the plant's values under the block's field names) and goes through the block module and
 * templates. A project model becomes the block's custom JSON or OBJ model.
 */

const BASES: Record<string, string> = { normal: "Plant", double: "DoublePlant", growapable: "GrowablePlant", sapling: "Sapling" };
/** Plant field -> block field where the names differ. */
const RENAMED: Record<string, string> = { onBlockPlacedBy: "onBlockPlayedBy", generateFeature: "plantGenerate" };

function asBlock(plant: Element, env: GenEnv): Element {
  const blockType = typeRegistry().byId.get("block")!;
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(plant)) values[RENAMED[key] ?? key] = value;
  const base = BASES[str(plant.plantType)] ?? "Plant";
  const tinted = str(plant.tintType) !== "No tint";
  const crop = str(plant.model) === "Crop model" && base !== "DoublePlant";
  // A project model (models/<name>.json or .obj) replaces the cross; double plants keep their two crosses.
  const model = str(plant.model);
  const kind = base !== "DoublePlant" && !["Cross model", "Crop model", ""].includes(model) ? projectModelKind(env, model) : undefined;
  if (!kind && base !== "DoublePlant" && !["Cross model", "Crop model", ""].includes(model)) {
    procedureBuild(env).warnings.push(`plant/${plant.id}: model "${model}" is not a project model (models/${model}.json|obj); the cross model is used`);
  }
  const customRender = kind === "obj" ? 3 : kind === "json" ? 2 : 0;
  const custom = plant.customBoundingBox === true;
  return {
    ...newElement(blockType, plant.id),
    ...values,
    id: plant.id,
    blockBase: base,
    renderType: customRender || (crop ? 13 : tinted ? 120 : 12),
    customModelName: kind ? model : crop ? "Crop model" : "Cross model",
    isNotColidable: plant.isSolid !== true,
    reactionToPushing: "DESTROY",
    offsetType: custom && plant.disableOffset === true ? "NONE" : str(plant.offsetType) || "XZ",
    boundingBoxes: custom
      ? list<Record<string, unknown>>(plant.boundingBoxes).map((b) => ({ mx: b.minX, my: b.minY, mz: b.minZ, Mx: b.maxX, My: b.maxY, Mz: b.maxZ, subtract: b.subtract === true }))
      : [],
    // The block's ore generation stays off; plants generate in patches (plantGenerate).
    generateFeature: false,
    // Plant update ticks are random ticks; the plant's own growth runs in super.randomTick. "Always tick" keeps
    // random ticks on without an update procedure.
    tickRandomly: str(plant.onTickUpdate) !== "" || plant.forceTicking === true,
    // A plant block entity holds data for the plant; it is the block inventory's block entity without slots.
    ...(plant.hasTileEntity === true ? { hasInventory: true, inventorySize: 0, guiBoundTo: "", openGUIOnRightClick: false, inventoryInSlotIDs: [], inventoryOutSlotIDs: [] } : {}),
    tickRate: 0,
  } as Element;
}

export default {
  renderAs: { type: "block", element: (plant, env) => asBlock(plant, env) },
  element: () => ({}),
} satisfies TypeModule;
