import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Element } from "../../elements/model.ts";
import { idExpr, itemTagExpr, jstr, list, pascal, qualify, str } from "../java.ts";
import { readPng } from "../png.ts";
import { GUI_SESSION_SEGMENT, GUI_TEXT_SEGMENT, guiServerTexts, guiTextRead, procEnv, procedureBuild, procedureCall, procedureCallById } from "../procedures.ts";
import { modClassName } from "../registries.ts";
import { frameIndexExpr, imageKey, textureAnimationsClass, textureAnimationsSource } from "../textureAnimations.ts";
import type { AnimationSchedule } from "../../resources/textureAnimation.ts";
import { widgetSchedule } from "../../resources/widgetAnimation.ts";
import { imageFilterOf, type ImageFilter } from "../../resources/imageFilter.ts";
import { guiSessionsClass, guiSessionsSource, isSessionGui, sessionSize } from "../guiSessions.ts";
import type { ElementContext, GenEnv, JavaSourceFile, TypeModule } from "../typeModule.ts";

/**
 * GUIs: every GUI is a container menu (<Gui>Menu, common) with a screen (<Gui>Screen, client), registered in
 * <Mod>Menus and <Mod>Screens. Slots are backed by the inventory of the block entity at the GUI's position, an
 * item's inventory, or a temporary container whose items go back to the player on close; a session GUI (Q205) can
 * take them from a shared session inventory instead (see guiSessions.ts). Buttons reach the server
 * through vanilla's container button packet (clickMenuButton), so no packets of our own are needed.
 *
 * Widgets (`components`, gui_layout field), positions relative to the GUI's top left corner:
 *   { kind: "label", x, y, text, color, textProcedure (text shown instead), condition, textScale }
 *   { kind: "button", x, y, width, height, text, procedure, condition, invisible (draws nothing, click area only), textScale }
 *   { kind: "image_button", x, y, width, height, image (normal state), hoverImage (hover state), procedure, condition }
 *     Without hoverImage, or with hoverImage the same file as image, the old layout: image holds the normal state above
 *     the hover state, twice the height.
 *   { kind: "toggle_button", x, y, width, height, image (off), hoverImage (off, hover), onImage (on), onHoverImage (on,
 *     hover), stateProcedure (logic, read every frame on the client: on while true), procedure (click), condition }
 *     A missing texture falls back to the nearest one set; textures with a .mcmeta animation play.
 *   { kind: "state_image", x, y, width, height, states [{ image, frame (still frame of a strip), condition }],
 *     stateProcedure (number: the state's index, or with stateValue "percent" 0-100 over the states; without it the
 *     first state whose condition holds), updateTicks (read every N ticks, 0 every frame), restartAnimation, condition, z }
 *     KUYRUK 186: each state its own texture, a .mcmeta animation plays; when no state's condition holds nothing is drawn.
 *   { kind: "text_field", x, y, width, height, text (hint) }
 *   { kind: "checkbox", x, y, text, checked }
 *   { kind: "image", x, y, image (project PNG), width?, height?, condition, animationStart }
 *     Q229: an animated image plays its texture's playback mode from animationStart: "open" (default, when the screen
 *     opens), "always" (the game clock, every screen in step) or "procedure" (the "restart GUI image animation" block;
 *     the first frame until then). Toggle buttons play on the game clock, state images as restartAnimation says.
 *   { kind: "slot", x, y (18x18 frame), id (inventory slot), output (no placing), limit (only this item), allowed ([{ item }]: items or #tags it accepts),
 *     locked (no placing or taking), lockCondition (logic procedure: locked while it is true),
 *     keepOnClose (an unbound GUI does not give its item back when it closes: display slots) }
 * Q273: image, image_button, toggle_button and state_image take opacity (0-100), tint ("#rrggbb", multiplied) and
 * tintStrength (0-100), baked into their copied textures on visible pixels only (src/resources/imageFilter.ts).
 * `name` (optional) names the widget's lang key. `condition` and `textProcedure` run on the client with the world, the
 * GUI's x, y, z and the player; a widget whose condition fails is not drawn and takes no clicks. A textProcedure with a
 * server-side block runs on the server instead: the menu computes it every tick and sends it when it changes.
 */

export interface GuiWidget {
  kind: string;
  name?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  color?: string;
  procedure?: string;
  textProcedure?: string;
  condition?: string;
  checked?: boolean;
  image?: string;
  /** image_button: hover state in its own PNG; `image` is then the normal state alone. toggle_button: off, hover. */
  hoverImage?: string;
  /** toggle_button (KUYRUK 96): textures of the on state and of on with the mouse over it. */
  onImage?: string;
  onHoverImage?: string;
  /**
   * Q275: image_button, toggle_button (off): texture shown for PRESSED_MS after a click; toggle_button onPressedImage
   * (on; default pressedImage). Modern engines only, 1.16.5 ignores them.
   */
  pressedImage?: string;
  onPressedImage?: string;
  /**
   * toggle_button: logic procedure read every frame on the client; the button shows its on textures while true.
   * state_image (KUYRUK 186): number procedure choosing the state shown (its index, or a percentage, `stateValue`).
   */
  stateProcedure?: string;
  /** state_image: its pictures (ImageState), the state procedure's meaning, how often it is read and whether entering a state restarts its animation. */
  states?: unknown;
  stateValue?: string;
  updateTicks?: number;
  restartAnimation?: boolean;
  id?: number;
  output?: boolean;
  limit?: string;
  /** slot (Q257): items ("id") and item tags ("#tag") the slot accepts, as rows `{ item }`; with `limit`, any of them; none: anything. */
  allowed?: unknown;
  locked?: boolean;
  lockCondition?: string;
  keepOnClose?: boolean;
  /** button: draws nothing, only its area is clickable. */
  invisible?: boolean;
  /** label, button: text size, 1 = the normal font (0.5 to 4). */
  textScale?: number;
  /**
   * image, label: drawing order (KUYRUK 103). Higher draws on top; above 0 draws over slots, items and buttons;
   * 0 and below keeps the normal place (images under buttons and items, labels under items). Ties keep the list
   * order. Default 0 (an old `overlay: true` image counts as 1).
   */
  z?: number;
  /** image: old flag for drawing over slots; `z` replaces it. */
  overlay?: boolean;
  /** image: animate texture */
  animated?: boolean;
  /** image: custom frame count */
  frameCount?: number;
  /** image: tick time per frame (1 tick = 50ms) */
  frameTime?: number;
  /** image (Q229): when its animation starts, "open" (default), "always" or "procedure". */
  animationStart?: string;
  /** label (KUYRUK 182): a box behind the text, "#rrggbb" ("" none), its opacity 0 to 100 and padding in GUI pixels. */
  background?: string;
  backgroundOpacity?: number;
  backgroundPadding?: number;
  /** label (KUYRUK 183): where x is on the text, "left" (default), "center" or "right"; it stays there as the text changes. */
  align?: string;
  layer?: string;
  /** image, image_button, toggle_button, state_image (Q273): alpha of the visible pixels, 0 to 100 (default 100). */
  opacity?: number;
  /** Same widgets: "#rrggbb" multiplied into the visible pixels ("" none), mixed in by tintStrength 0 to 100 (default 100). */
  tint?: string;
  tintStrength?: number;
}

/** The .png.mcmeta text beside a project PNG, or undefined. */
function mcmetaText(png: string): string | undefined {
  return existsSync(`${png}.mcmeta`) ? readFileSync(`${png}.mcmeta`, "utf8") : undefined;
}

/** toggle_button: its textures in state order (off, off hover, on, on hover), a missing one falling back to the nearest set. */
export function toggleTextures(w: GuiWidget): string[] {
  const off = str(w.image), on = str(w.onImage) || off;
  return [off, str(w.hoverImage) || off, on, str(w.onHoverImage) || on];
}
/** Suffix of each toggle state's copied texture: screens/<gui>_<index><suffix>.png; the pressed two only with pressedImage (Q275). */
export const TOGGLE_SUFFIXES = ["", "_hover", "_on", "_on_hover", "_pressed", "_on_pressed"];
/** Q275: the pressed textures of a toggle button, off and on (empty without pressedImage). */
export function togglePressedTextures(w: GuiWidget): string[] {
  const off = str(w.pressedImage);
  return off ? [off, str(w.onPressedImage) || off] : [];
}
/** Q275: how long a pressed texture shows after a click, in milliseconds. */
const PRESSED_MS = 120;
/**
 * Q275: whether a modern button looks hovered. Vanilla uses isHoveredOrFocused(), and a click leaves the button
 * focused (the screen focuses the clicked child after onPress), so a button that keeps the screen open stayed lit;
 * keyboard focus still shows.
 */
const LIT = "this.isHovered() || (this.isFocused() && net.minecraft.client.Minecraft.getInstance().getLastInputType().isKeyboard())";

/** One texture a widget draws: copied file, its size and, when it has a .mcmeta animation, square frames. */
interface DrawnTexture {
  path: string;
  /** Texture size, and the size of one frame (the whole texture unless animated). */
  tw: number;
  th: number;
  fw: number;
  fh: number;
  animation?: AnimationSchedule;
}

/** Size and .mcmeta animation (frames stacked downwards, as wide as high) of a project PNG. */
function drawnTexture(projectDir: string, from: string, path: string): DrawnTexture {
  const file = join(projectDir, from);
  let tw = 16, th = 16;
  try {
    const png = readPng(readFileSync(file));
    tw = png.width;
    th = png.height;
  } catch {
    return { path, tw, th, fw: tw, fh: th };
  }
  // The shared rule (src/resources/widgetAnimation.ts); an unreadable .mcmeta leaves the texture still.
  const animation = widgetSchedule("toggle", tw, th, mcmetaText(file));
  if (!animation) return { path, tw, th, fw: tw, fh: th };
  return { path, tw, th, fw: tw, fh: tw, animation };
}

/** Q273: whether the widget's image is drawn see-through (opacity below 100), which 1.16.5 must blend. */
const translucent = (w: GuiWidget) => (imageFilterOf(w)?.opacity ?? 100) < 100;
const LEGACY_BLEND = "com.mojang.blaze3d.systems.RenderSystem.enableBlend(); com.mojang.blaze3d.systems.RenderSystem.defaultBlendFunc();";

/** A widget's drawing order (`z`): an integer from -99 to 99; 0 when unset, 1 for an old `overlay: true` image. */
export const zOf = (w: { z?: unknown; overlay?: unknown }): number => {
  const z = Number(w.z);
  if (w.z !== undefined && w.z !== null && w.z !== "" && Number.isFinite(z)) return Math.max(-99, Math.min(99, Math.round(z)));
  return w.overlay === true ? 1 : 0;
};

/** Widgets in drawing order: by `z`, keeping the list order among equal ones. */
export const byZ = <T extends { z?: unknown; overlay?: unknown }>(list: T[]): T[] =>
  list.map((w, i) => ({ w, i })).sort((a, b) => zOf(a.w) - zOf(b.w) || a.i - b.i).map((x) => x.w);

/** A widget's text scale: 1 unless a number from 0.25 to 8 is set. */
export const textScaleOf = (w: { textScale?: unknown }): number => {
  const s = Number(w.textScale);
  return w.textScale !== undefined && w.textScale !== "" && Number.isFinite(s) && s >= 0.25 && s <= 8 && s !== 1 ? s : 1;
};

/** A label's background colour as Java ARGB (KUYRUK 182), or undefined without one; opacity 0-100, default 50. */
export function labelBackground(w: GuiWidget): string | undefined {
  if (!/^#[0-9a-fA-F]{6}$/.test(str(w.background))) return undefined;
  const o = Number(w.backgroundOpacity);
  const alpha = Math.round((Number.isFinite(o) && w.backgroundOpacity !== undefined ? Math.max(0, Math.min(100, o)) : 50) * 2.55);
  return `0x${alpha.toString(16).padStart(2, "0").toUpperCase()}${str(w.background).slice(1).toUpperCase()}`;
}
const labelPadding = (w: GuiWidget) => {
  const p = Math.round(Number(w.backgroundPadding));
  return Number.isFinite(p) && w.backgroundPadding !== undefined ? Math.max(0, Math.min(8, p)) : 1;
};

export const labelAlign = (w: GuiWidget): "left" | "center" | "right" => (w.align === "center" || w.align === "right" ? w.align : "left");

/**
 * A label's text drawn at x, y (KUYRUK 182, 183): `component` in `font`'s text, scaled by its text size; x is its left
 * edge, centre or right edge by its alignment (measured every frame, so a changing text keeps that point); with a
 * background a filled box (the text's width and 8 pixels high, plus the padding on each side, scaled with the text)
 * first. A left label without a background is drawn as before. `g` is the GUI graphics (1.16.5: the MatrixStack).
 */
export function labelText(mc: string, w: GuiWidget, x: string, y: string, font: string, component: string, color: string): string {
  const legacy = mc === "1.16.5";
  const draw = (t: string, tx: string, ty: string) => (legacy ? `${font}.draw(g, ${t}, ${tx}, ${ty}, ${color});`
    : `g.${mc === "26.3" ? "text" : "drawString"}(${font}, ${t}, ${tx}, ${ty}, ${color}, false);`);
  const bg = labelBackground(w), align = labelAlign(w);
  if (!bg && align === "left") return scaledText(mc, textScaleOf(w), x, y, (tx, ty) => draw(component, tx, ty));
  const p = labelPadding(w);
  const type = legacy ? "net.minecraft.util.text.ITextComponent" : "net.minecraft.network.chat.Component";
  const fill = (a: string, b: string, c: string, d: string) => (legacy ? `net.minecraft.client.gui.AbstractGui.fill(g, ${a}, ${b}, ${c}, ${d}, ${bg});` : `g.fill(${a}, ${b}, ${c}, ${d}, ${bg});`);
  const body = (x0: string, ty: string) => {
    const tx = align === "left" ? x0 : "labelX";
    return [
      ...(align === "left" ? [] : [`int labelX = ${x0} - labelWidth${align === "center" ? " / 2" : ""};`]),
      ...(bg ? [fill(`${tx} - ${p}`, `${ty} - ${p}`, `${tx} + labelWidth + ${p}`, `${ty} + ${8 + p}`)] : []),
      draw("labelText", tx, ty),
    ].join("\n            ");
  };
  return `{
            ${type} labelText = ${component};
            int labelWidth = ${font}.width(labelText);
            ${scaledText(mc, textScaleOf(w), x, y, body)}
        }`;
}

/**
 * Draws `draw` (a line drawing text at 0, 0) scaled by `scale` with the pose moved to `x`, `y` (int Java expressions),
 * so the text grows from that point; `g` is the GUI graphics (1.16.5: the MatrixStack). Scale 1 draws `draw` at x, y.
 */
export function scaledText(mc: string, scale: number, x: string, y: string, draw: (x: string, y: string) => string): string {
  if (scale === 1) return draw(x, y);
  const f = `${scale}F`;
  if (mc === "1.16.5") return `g.pushPose();
            g.translate((double) (${x}), (double) (${y}), 0.0D);
            g.scale(${f}, ${f}, 1.0F);
            ${draw("0", "0")}
            g.popPose();`;
  // 26.x: the pose is a 2D matrix stack (org.joml.Matrix3x2fStack).
  if (mc === "26.3") return `g.pose().pushMatrix();
            g.pose().translate((float) (${x}), (float) (${y}));
            g.pose().scale(${f}, ${f});
            ${draw("0", "0")}
            g.pose().popMatrix();`;
  return `g.pose().pushPose();
            g.pose().translate((float) (${x}), (float) (${y}), 0.0F);
            g.pose().scale(${f}, ${f}, 1.0F);
            ${draw("0", "0")}
            g.pose().popPose();`;
}

/** state_image (KUYRUK 186): a state's picture, a still frame of a strip when `frame` is set. */
export interface ImageState {
  image?: string;
  /** A fixed frame (from 0) of a vertical strip of square frames; unset: the whole texture, its .mcmeta animation playing. */
  frame?: number;
  /** Conditions mode: logic procedure; the first state whose condition holds is shown (a state without one always holds). */
  condition?: string;
}

export const imageStates = (w: GuiWidget): ImageState[] => list<ImageState>(w.states).filter((s) => s && typeof s === "object");

/** state_image: copied file of state k, screens/<owner>_<index>_s<k>.png. */
export const stateTexturePath = (owner: string, index: number, k: number) => `screens/${owner}_${index}_s${k}`;

/** The textures a state image draws, each state its own copied file, with its size and frame (empty for a state without an image). */
export function stateTextures(projectDir: string, w: GuiWidget, owner: string, index: number): { copies: { from: string; to: string; filter?: ImageFilter }[]; drawn: (StateTexture | undefined)[] } {
  const copies: { from: string; to: string; filter?: ImageFilter }[] = [];
  const filter = imageFilterOf(w);
  const drawn = imageStates(w).map((s, k) => {
    if (!str(s.image)) return undefined;
    const to = stateTexturePath(owner, index, k);
    copies.push({ from: str(s.image), to, ...(filter ? { filter } : {}) });
    const tex = drawnTexture(projectDir, str(s.image), to);
    const frames = Math.floor(tex.th / Math.max(1, tex.tw));
    const frame = Number(s.frame);
    // A fixed frame of a strip: one still square frame, whatever the .mcmeta says.
    if (s.frame !== undefined && s.frame !== null && String(s.frame) !== "" && Number.isFinite(frame) && frames >= 2) {
      return { ...tex, fw: tex.tw, fh: tex.tw, animation: undefined, still: (((Math.round(frame) % frames) + frames) % frames) * tex.tw };
    }
    return tex;
  });
  return { copies, drawn };
}
type StateTexture = DrawnTexture & { still?: number };

/**
 * state_image (KUYRUK 186): the shown state's number, as a Java int expression (-1: none, nothing drawn). With a
 * number procedure it is the state's index (or, `stateValue` "percent", 0-100 spread over the states), kept inside the
 * list; without one the first state whose condition holds. `call` makes a procedure's call expression.
 */
export function stateExpression(w: GuiWidget, count: number, call: (id: string, returns: "logic" | "number") => string | undefined): string {
  if (!count) return "-1";
  const value = str(w.stateProcedure) ? call(str(w.stateProcedure), "number") : undefined;
  if (value) {
    const raw = w.stateValue === "percent" ? `(${value}) * ${count} / 100.0` : `(${value})`;
    return `Math.max(0, Math.min(${count - 1}, (int) Math.floor(${raw})))`;
  }
  const tests: string[] = [];
  for (const [k, s] of imageStates(w).entries()) {
    const test = str(s.condition) ? call(str(s.condition), "logic") : undefined;
    if (!test) return [...tests, String(k)].join(" : ");
    tests.push(`${test} ? ${k}`);
  }
  return [...tests, "-1"].join(" : ");
}

/**
 * state_image: the members that keep its state (`prefix`Shown, read at most every `updateTicks` ticks, 0 = every
 * frame; `prefix`Since, when it last changed, for `restartAnimation`) and the method returning it. `statics` for the
 * overlay class's static methods.
 */
export function stateMembers(w: GuiWidget, prefix: string, expression: string, statics: boolean, what: string): string {
  const s = statics ? "static " : "";
  const ticks = Math.max(0, Math.min(1200, int(w.updateTicks, 0)));
  const update = `int next = ${expression};
            if (next != ${prefix}Shown) {
                ${prefix}Shown = next;
                ${prefix}Since = now;
            }`;
  const body = ticks ? `if (${prefix}Read == 0L || now - ${prefix}Read >= ${ticks * 50}L) {
            ${prefix}Read = now;
            ${update}
        }` : update.replaceAll("\n            ", "\n        ");
  return `    /** ${what}: the state shown (-1 none), read ${ticks ? `every ${ticks} ticks` : "every frame"}, and since when it shows. */
    private ${s}int ${prefix}Shown = -1;
    private ${s}long ${ticks ? `${prefix}Read, ` : ""}${prefix}Since;

    private ${s}int ${prefix}State() {
        long now = System.currentTimeMillis();
        ${body}
        return ${prefix}Shown;
    }`;
}

/**
 * state_image: draws the shown state at x, y, `width` x `height`; an animated one plays on the game clock, or from
 * its first frame when the state was entered (`restartAnimation`). `bind` (1.16.5) binds a texture id.
 */
export function stateDraw(env: GenEnv, w: GuiWidget, drawn: (StateTexture | undefined)[], prefix: string, x: string, y: string, bind: (id: string) => string): string {
  const legacy = env.mc === "1.16.5";
  const width = int(w.width, 16), height = int(w.height, 16);
  const clock = w.restartAnimation === true ? `(System.currentTimeMillis() - ${prefix}Since)` : "System.currentTimeMillis()";
  const draw = (tex: StateTexture) => {
    const id = idExpr(env, `${env.modId}:textures/${tex.path}.png`);
    const v = tex.still !== undefined ? `${tex.still}.0F`
      : tex.animation ? `(float) (${frameIndexExpr(env, tex.animation, clock)} * ${tex.fh})` : "0.0F";
    if (legacy) return `${bind(id)}\n                net.minecraft.client.gui.AbstractGui.blit(g, ${x}, ${y}, ${width}, ${height}, 0.0F, ${v}, ${tex.fw}, ${tex.fh}, ${tex.tw}, ${tex.th});`;
    const pipeline = env.mc === "26.3" ? "net.minecraft.client.renderer.RenderPipelines.GUI_TEXTURED" : "net.minecraft.client.renderer.RenderType::guiTextured";
    return `g.blit(${pipeline}, ${id}, ${x}, ${y}, 0.0F, ${v}, ${width}, ${height}, ${tex.fw}, ${tex.fh}, ${tex.tw}, ${tex.th});`;
  };
  const cases = drawn.flatMap((tex, k) => (tex ? [`if (state == ${k}) {\n                ${draw(tex)}\n            }`] : []));
  if (!cases.length) return "";
  return `{
            int state = ${prefix}State();
            ${cases.join(" else ")}
        }`;
}

export const menuClass = (env: GenEnv, guiId: string) => `${env.project.mod.package}.world.inventory.${pascal(guiId)}Menu`;
export const menusClass = (env: GenEnv) => `${env.project.mod.package}.init.${modClassName(env)}Menus`;

/** Slot count a GUI needs: one past its highest slot id. */
export function guiSlots(gui: Element): number {
  return widgets(gui).filter((w) => w.kind === "slot").reduce((n, w) => Math.max(n, Number(w.id ?? 0) + 1), 0);
}

/** Java statement opening a generated GUI for `player` (ServerPlayer) at `pos`, backed by `container` (or null). */
export function openGuiCall(env: GenEnv, guiId: string, player: string, pos: string, container: string): string {
  return `${menusClass(env)}.open${pascal(guiId)}(${player}, ${pos}, ${container});`;
}

const widgets = (gui: Element) => list<GuiWidget>(gui.components);

function names(env: GenEnv) {
  const legacy = env.mc === "1.16.5";
  return legacy
    ? {
      Menu: "net.minecraft.inventory.container.Container", MenuType: "net.minecraft.inventory.container.ContainerType",
      Slot: "net.minecraft.inventory.container.Slot", Inv: "net.minecraft.entity.player.PlayerInventory",
      Player: "net.minecraft.entity.player.PlayerEntity", ServerPlayer: "net.minecraft.entity.player.ServerPlayerEntity",
      Container: "net.minecraft.inventory.IInventory", Simple: "net.minecraft.inventory.Inventory", Stack: "net.minecraft.item.ItemStack",
      Pos: "net.minecraft.util.math.BlockPos", Level: "net.minecraft.world.World", Entity: "net.minecraft.entity.Entity",
      Provider: "net.minecraft.inventory.container.SimpleNamedContainerProvider",
    }
    : {
      Menu: "net.minecraft.world.inventory.AbstractContainerMenu", MenuType: "net.minecraft.world.inventory.MenuType",
      Slot: "net.minecraft.world.inventory.Slot", Inv: "net.minecraft.world.entity.player.Inventory",
      Player: "net.minecraft.world.entity.player.Player", ServerPlayer: "net.minecraft.server.level.ServerPlayer",
      Container: "net.minecraft.world.Container", Simple: "net.minecraft.world.SimpleContainer", Stack: "net.minecraft.world.item.ItemStack",
      Pos: "net.minecraft.core.BlockPos", Level: "net.minecraft.world.level.Level", Entity: "net.minecraft.world.entity.Entity",
      Provider: "net.minecraft.world.SimpleMenuProvider",
    };
}

const text = (env: GenEnv, key: string) =>
  env.mc === "1.16.5" ? `new net.minecraft.util.text.TranslationTextComponent(${jstr(key)})` : `net.minecraft.network.chat.Component.translatable(${jstr(key)})`;
const argb = (color: unknown) => `0xFF${(/^#[0-9a-fA-F]{6}$/.test(str(color)) ? str(color).slice(1) : "404040").toUpperCase()}`;
const int = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) && value !== "" && value !== undefined ? Math.round(Number(value)) : fallback);

function element(gui: Element, env: GenEnv): ElementContext {
  const lang: Record<string, string> = { [`gui.${env.modId}.${gui.id}`]: str(gui.title) || gui.id };
  const textures: NonNullable<ElementContext["textures"]> = [];
  const items = widgets(gui).map((w, i) => {
    const key = `gui.${env.modId}.${gui.id}.${str(w.name) || `${w.kind}_${i}`}`;
    if (["label", "button", "text_field", "checkbox"].includes(w.kind) && str(w.text)) lang[key] = str(w.text);
    let size = { w: int(w.width, 16), h: int(w.height, 16) };
    let animation: AnimationSchedule | undefined = undefined;
    const filter = imageFilterOf(w);
    const filtered = filter ? { filter } : {};
    if ((w.kind === "image" || w.kind === "image_button") && str(w.image)) {
      const file = join(env.projectDir, str(w.image));
      // An image button with a hover texture has its two states in two files; without one, or with the same file as
      // hover texture (KUYRUK 167), the old layout: one file with the normal state above the hover state.
      const hover = w.kind === "image_button" && str(w.hoverImage) !== str(w.image) ? str(w.hoverImage) : "";
      const modern = w.kind === "image_button" && env.mc !== "1.16.5";
      // 1.16.5 draws both states from one texture, so two files are stacked into it.
      textures.push({ from: str(w.image), to: `screens/${gui.id}_${i}`, ...(hover ? { below: hover } : {}), ...filtered });
      // From 1.20.2 an image button draws two GUI sprites (gui/sprites/...), normal and highlighted, not one texture.
      if (modern && hover) {
        textures.push({ from: str(w.image), to: `gui/sprites/screens/${gui.id}_${i}`, ...filtered });
        textures.push({ from: hover, to: `gui/sprites/screens/${gui.id}_${i}_highlighted`, ...filtered });
      } else if (modern) {
        textures.push({ from: str(w.image), to: `gui/sprites/screens/${gui.id}_${i}`, half: "top", ...filtered });
        textures.push({ from: str(w.image), to: `gui/sprites/screens/${gui.id}_${i}_highlighted`, half: "bottom", ...filtered });
      }
      if (modern && str(w.pressedImage)) textures.push({ from: str(w.pressedImage), to: `gui/sprites/screens/${gui.id}_${i}_pressed`, ...filtered });
      if (existsSync(file)) {
        try {
          const png = readPng(readFileSync(file));
          if (w.kind === "image") {
            // An animated image is a vertical strip of frames, as in a .png.mcmeta: frames are square unless the
            // .mcmeta gives a height. The widget size is the size one frame is drawn at. The shared rule
            // (src/resources/widgetAnimation.ts) gives the frames played in the texture's playback mode.
            animation = widgetSchedule("image", png.width, png.height, mcmetaText(file), w);
            size = { w: int(w.width, png.width), h: int(w.height, animation ? animation.frameHeight : png.height) };
          } else if (w.width === undefined || w.height === undefined) {
            size = { w: int(w.width, png.width), h: int(w.height, png.height) };
          }
        } catch {
          // An unreadable PNG keeps the default size.
        }
      }
    }
    // A toggle button's four states, each its own copied file (one per state, even when two states share a PNG).
    let toggle: DrawnTexture[] | undefined;
    if (w.kind === "toggle_button" && str(w.image)) {
      const pressed = env.mc === "1.16.5" ? [] : togglePressedTextures(w);
      toggle = [...toggleTextures(w), ...pressed].map((from, state) => {
        const to = `screens/${gui.id}_${i}${TOGGLE_SUFFIXES[state]}`;
        textures.push({ from, to, ...filtered });
        return drawnTexture(env.projectDir, from, to);
      });
    }
    // A state image's states, each its own copied file (KUYRUK 186).
    let stateTex: (StateTexture | undefined)[] | undefined;
    if (w.kind === "state_image") {
      const made = stateTextures(env.projectDir, w, String(gui.id), i);
      textures.push(...made.copies);
      stateTex = made.drawn;
    }
    return { ...w, key, index: i, size, animation, toggle, stateTex };
  });
  return { lang, textures, widgets: items };
}

type Widget = GuiWidget & {
  key: string;
  index: number;
  size: { w: number; h: number };
  animation?: AnimationSchedule;
  toggle?: DrawnTexture[];
  /** state_image: each state's drawn texture (undefined: a state without an image). */
  stateTex?: (StateTexture | undefined)[];
};

function menuSource(env: GenEnv, gui: ElementContext): JavaSourceFile {
  const N = names(env);
  const legacy = env.mc === "1.16.5";
  const pkg = env.project.mod.package;
  const cls = `${pascal(gui.id as string)}Menu`;
  const all = gui.widgets as Widget[];
  const slots = all.filter((w) => w.kind === "slot");
  const buttons = all.filter((w) => w.kind === "button" || w.kind === "image_button" || w.kind === "toggle_button");
  const size = guiSlots(gui as unknown as Element);
  const withInventory = Number(gui.type) === 1;
  // Q205: slots from a shared session inventory (<Mod>GuiSessions) instead of a block.
  const session = isSessionGui(gui);
  const sessions = guiSessionsClass(env);
  const W = int(gui.width, 176);
  const H = int(gui.height, 166);
  const type = env.loader === "fabric" ? `${menusClass(env)}.${String(gui.id).toUpperCase()}` : `${menusClass(env)}.${String(gui.id).toUpperCase()}.get()`;
  const deps = (player: string) => ({ x: "this.x", y: "this.y", z: "this.z", world: "this.world", entity: player });
  const call = (field: string, player: string) => procedureCall(env, "gui", gui as unknown as Element, field, deps(player));
  const onOpen = call("onOpen", "this.entity");
  const onTick = call("onTick", "this.entity");
  const onClosed = call("onClosed", "player");
  // Q203: onSlotChanged runs once per change of a GUI slot's stack, whatever made it (clicks, shift clicks, procedures,
  // hoppers on the block): every broadcast compares the slots with the stacks last seen in the backing container.
  const watched = [...new Set(slots.map((s) => int(s.id, 0)))];
  const onSlotChanged = watched.length ? procedureCall(env, "gui", gui as unknown as Element, "onSlotChanged", { ...deps("this.entity"), slot: "WATCHED[i]" }) : undefined;
  // Labels whose text needs the server: computed here every tick, sent to the player only when it changes (KUYRUK 105).
  const serverTexts = guiServerTexts(gui as unknown as Element, procedureBuild(env).scope).flatMap(({ index, procedure }) => {
    const text = procedureCallById(env, procedure, deps("this.entity"), `gui/${gui.id}`);
    return text ? [`this.syncText(${index}, String.valueOf(${text}));`] : [];
  });
  const penv = procEnv(env);
  const network = `${penv.pkg}.procedures.${penv.modClass}Network`;
  const kept = slots.filter((s) => s.keepOnClose === true).map((s) => int(s.id, 0));
  const itemBound = (env.generated.item ?? []).some((i) => i.guiBoundTo === gui.id && i.openGUIOnRightClick === true);
  const slotLines = slots.map((s) => {
    const members: string[] = [];
    const lock = str(s.lockCondition) ? procedureCallById(env, s.lockCondition, deps("this.entity"), `gui/${gui.id}`, "logic")?.replaceAll("this.", `${cls}.this.`) : undefined;
    // The place filter (Q257): `limit` and the `allowed` rows, any of them matches; no entry: anything fits.
    const key = legacy ? "net.minecraftforge.registries.ForgeRegistries.ITEMS.getKey(stack.getItem())" : "net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(stack.getItem())";
    const entries = [str(s.limit), ...list<Record<string, unknown>>(s.allowed).map((r) => str(r?.item))].filter(Boolean).map((ref) => qualify(env, ref));
    const accepts = entries.map((ref) => ref.startsWith("#")
      ? (legacy ? `stack.getItem().is(${itemTagExpr(env, ref)})` : `stack.is(${itemTagExpr(env, ref)})`)
      : `${jstr(ref)}.equals(String.valueOf(${key}))`);
    const filter = accepts.length ? `(${accepts.join(" || ")})` : undefined;
    // Locks and the filter add up: a locked slot takes nothing, an unlocked one only what the filter lets in.
    if (s.locked === true) members.push(`@Override public boolean mayPlace(${N.Stack} stack) { return false; }`, `@Override public boolean mayPickup(${N.Player} player) { return false; }`);
    else if (lock) members.push(`@Override public boolean mayPlace(${N.Stack} stack) { return !${lock}${filter ? ` && ${filter}` : ""}; }`, `@Override public boolean mayPickup(${N.Player} player) { return !${lock}; }`);
    else if (s.output === true) members.push(`@Override public boolean mayPlace(${N.Stack} stack) { return false; }`);
    else if (filter) members.push(`@Override public boolean mayPlace(${N.Stack} stack) { return ${filter}; }`);
    // An item with an inventory does not accept itself (MCreator's item handler rule); other containers accept anything.
    if (!members.length && itemBound) members.push(`@Override public boolean mayPlace(${N.Stack} stack) { return !(this.container instanceof ${menusClass(env)}.ItemContainer) || ((${menusClass(env)}.ItemContainer) this.container).accepts(stack); }`);
    // A session records who put each item in, so it can go back to that player when the session ends.
    if (session) members.push(`@Override public void set(${N.Stack} stack) { super.set(stack); ${cls}.this.noteSlot(${int(s.id, 0)}); }`, `@Override public void setChanged() { super.setChanged(); ${cls}.this.noteSlot(${int(s.id, 0)}); }`);
    // A slot with a place filter is a FilterSlot, so shift click can offer it the matching stacks first (Q258).
    const filtered = filter && s.locked !== true && s.output !== true;
    const slot = `new ${filtered ? "FilterSlot" : N.Slot}(container, ${int(s.id, 0)}, ${int(s.x, 0) + 1}, ${int(s.y, 0) + 1})${members.length ? ` {\n            ${members.join("\n            ")}\n        }` : ""}`;
    return `        this.customSlots.put(${int(s.id, 0)}, this.addSlot(${slot}));`;
  });
  const invLines = withInventory
    ? `        int invX = ${Math.floor((W - 176) / 2) + 8 + int(gui.inventoryOffsetX, 0)};
        int invY = ${H - 82 + int(gui.inventoryOffsetY, 0)};
        for (int row = 0; row < 3; row++) {
            for (int col = 0; col < 9; col++) this.addSlot(new ${N.Slot}(inventory, col + (row + 1) * 9, invX + col * 18, invY + row * 18));
        }
        for (int col = 0; col < 9; col++) this.addSlot(new ${N.Slot}(inventory, col, invX + col * 18, invY + 58));
`
    : "";
  const ownSlots = slots.length;
  const quickMove = withInventory && ownSlots > 0
    ? `        ${N.Stack} result = ${N.Stack}.EMPTY;
        ${N.Slot} slot = this.slots.get(index);
        if (slot != null && slot.hasItem()) {
            ${N.Stack} stack = slot.getItem();
            result = stack.copy();
            if (index < ${ownSlots}) {
                if (!this.moveItemStackTo(stack, ${ownSlots}, this.slots.size(), true)) return ${N.Stack}.EMPTY;
            } else if (!this.moveItemStackTo(stack, 0, ${ownSlots}, false)) {
                // Nothing fits the GUI: swap between the inventory rows and the hotbar, once (as MCreator did).
                if (index < ${ownSlots + 27}) {
                    if (!this.moveItemStackTo(stack, ${ownSlots + 27}, this.slots.size(), true)) return ${N.Stack}.EMPTY;
                } else if (!this.moveItemStackTo(stack, ${ownSlots}, ${ownSlots + 27}, false)) {
                    return ${N.Stack}.EMPTY;
                }
                if (stack.isEmpty()) slot.set(${N.Stack}.EMPTY);
                else slot.setChanged();
                return ${N.Stack}.EMPTY;
            }
            if (stack.isEmpty()) slot.set(${N.Stack}.EMPTY);
            else slot.setChanged();
        }
        return result;`
    : `        return ${N.Stack}.EMPTY;`;
  // Vanilla moveItemStackTo with mayPlace also checked in the merge loop (as MCreator's menus did): vanilla tops up
  // any slot holding the same item, so shift click piled items onto locked display slots (KUYRUK 191).
  const sameItem = legacy ? "consideredTheSameItem(stack, item)" : `${N.Stack}.isSameItemSameComponents(stack, item)`;
  const mergeMax = legacy ? "Math.min(slot.getMaxStackSize(), stack.getMaxStackSize())" : "slot.getMaxStackSize(item)";
  const place = legacy ? "slot.set(stack.split(Math.min(stack.getCount(), slot.getMaxStackSize())))" : "slot.setByPlayer(stack.split(Math.min(stack.getCount(), slot.getMaxStackSize(stack))))";
  // With filtered slots the stack is offered to the slots whose filter matches it first, then to the rest (Q258): an
  // unfiltered slot with a lower index no longer takes what a filtered slot is meant for. Index order holds in each pass.
  const hasFilter = slotLines.some((l) => l.includes("new FilterSlot("));
  const body = (ind: string, pass: boolean) => `${ind}if (stack.isStackable()) {
${ind}    for (int i = reverse ? end - 1 : start; !stack.isEmpty() && (reverse ? i >= start : i < end); i += reverse ? -1 : 1) {
${ind}        ${N.Slot} slot = this.slots.get(i);
${ind}        ${N.Stack} item = slot.getItem();
${ind}        if (${pass ? "preferred != (slot instanceof FilterSlot) || " : ""}item.isEmpty() || !${sameItem} || !slot.mayPlace(stack)) continue;
${ind}        int max = ${mergeMax};
${ind}        if (item.getCount() >= max) continue;
${ind}        int add = Math.min(stack.getCount(), max - item.getCount());
${ind}        stack.shrink(add);
${ind}        item.grow(add);
${ind}        slot.setChanged();
${ind}        moved = true;
${ind}    }
${ind}}
${ind}if (!stack.isEmpty()) {
${ind}    for (int i = reverse ? end - 1 : start; reverse ? i >= start : i < end; i += reverse ? -1 : 1) {
${ind}        ${N.Slot} slot = this.slots.get(i);
${ind}        if (${pass ? "preferred != (slot instanceof FilterSlot) || " : ""}!slot.getItem().isEmpty() || !slot.mayPlace(stack)) continue;
${ind}        ${place};
${ind}        slot.setChanged();
${ind}        moved = true;
${ind}        break;
${ind}    }
${ind}}`;
  const moveTo = `    @Override
    protected boolean moveItemStackTo(${N.Stack} stack, int start, int end, boolean reverse) {
        boolean moved = false;
${hasFilter ? `        for (boolean preferred : new boolean[] {true, false}) {
${body("            ", true)}
            if (stack.isEmpty()) break;
        }` : body("        ", false)}
        return moved;
    }`;
  // A session menu runs onOpen on its first tick as the player's open menu (1.21.5 ticks it inside openMenu, before), so it can read the session id.
  const openLater = session && onOpen ? [`if (!this.opened && this.entity.containerMenu == this) {\n    this.opened = true;\n    ${onOpen};\n}`] : [];
  // The session's values go to the player when they change (only procedures read them).
  const syncSession = session && procedureBuild(env).compiled.size > 0;
  // Closing: a temporary container gives its items back (keepOnClose slots excepted).
  const giveBack = `        this.container.stopOpen(player);
        if (!this.bound && player instanceof ${N.ServerPlayer}) {${kept.map((id) => `
            this.container.removeItemNoUpdate(${id});`).join("")}
            this.clearContainer(player, ${legacy ? "player.level, " : ""}this.container);
        }`;
  const tickLines = [...(onSlotChanged ? ["this.slotChanges();"] : []), ...openLater,...(onTick ? [`${onTick};`] : []), ...serverTexts, ...(syncSession ? ["this.syncSession();"] : [])];
  const clicks = buttons.map((b) => {
    const run = procedureCall(env, "gui", { id: gui.id, procedure: str(b.procedure) } as unknown as Element, "procedure", deps("player"));
    return `            case ${b.index}:${run ? `\n                ${run};` : ""}\n                return true;`;
  });
  const code = `package ${pkg}.world.inventory;

/** Generated by MCEdge: menu of GUI "${gui.id}". */
public class ${cls} extends ${N.Menu} implements java.util.function.Supplier<java.util.Map<Integer, ${N.Slot}>>${session ? `, ${sessions}.View` : ""} {
    private final java.util.Map<Integer, ${N.Slot}> customSlots = new java.util.HashMap<>();${hasFilter ? `
    // A slot with a place filter: shift click offers it the stacks it accepts before the unfiltered slots.
    private static class FilterSlot extends ${N.Slot} {
        FilterSlot(${N.Container} container, int index, int x, int y) { super(container, index, x, y); }
    }` : ""}
    public final ${N.Level} world;
    public final ${N.Player} entity;
    public final int x, y, z;
    private final ${N.Container} container;
    private final boolean bound;
${session ? `    /** The shared session the slots belong to (server side; null on a client and when opened without one). */
    private final ${sessions}.Session session;
` : ""}${openLater.length ? "    private boolean opened;\n" : ""}${syncSession ? "    private int sentVersion = -1;\n" : ""}
    /** Client side: the server sends the slot contents. */
    public ${cls}(int id, ${N.Inv} inventory) {
        this(id, inventory, null, ${N.Pos}.ZERO);
    }

    /** \`container\` backs the slots (a block entity or item inventory); null uses a temporary one. */
    public ${cls}(int id, ${N.Inv} inventory, ${N.Container} container, ${N.Pos} pos) {
        super(${type}, id);
        this.entity = inventory.player;
        this.world = inventory.player.${legacy ? "level" : "level()"};
        this.x = pos.getX();
        this.y = pos.getY();
        this.z = pos.getZ();
        this.bound = container != null && container.getContainerSize() >= ${size};
        this.container = this.bound ? container : new ${N.Simple}(${Math.max(size, 1)});
        this.container.startOpen(inventory.player);
        container = this.container;
${session ? `        this.session = this.container instanceof ${sessions}.Session ? (${sessions}.Session) this.container : null;
        if (this.session != null) ${sessions}.join(this.session, inventory.player);
        else if (this.world.isClientSide()) ${sessions}.clientOpen(id, this.container);
` : ""}${slotLines.join("\n")}
${invLines}${onSlotChanged ? "        if (!this.world.isClientSide()) SEEN.put(this.container, this.slotStacks());\n" : ""}${onOpen && !openLater.length ? `        if (!this.world.isClientSide()) ${onOpen};\n` : ""}    }

    /** The GUI's own slots by id, for procedures. */
    @Override
    public java.util.Map<Integer, ${N.Slot}> get() {
        return this.customSlots;
    }

${session ? `    @Override
    public String sessionId() {
        return this.session != null ? this.session.id : ${sessions}.clientSession(this.containerId);
    }

    /** A slot of the session changed through this player's menu. */
    private void noteSlot(int slot) {
        if (this.session != null) this.session.note(slot, this.entity);
    }
${syncSession ? `
    /** Sends the session's id and values to the player when they changed. */
    private void syncSession() {
        if (this.session == null || this.sentVersion == this.session.version()) return;
        this.sentVersion = this.session.version();
        ${network}.toPlayer(this.entity, new ${network}.${GUI_SESSION_SEGMENT}(this.containerId, this.session.id, this.session.data().copy()));
    }
` : ""}
` : ""}    @Override
    public boolean stillValid(${N.Player} player) {
        return ${gui.anyDistance === true ? "true" : "this.container.stillValid(player)"};
    }

    @Override
    public ${N.Stack} quickMoveStack(${N.Player} player, int index) {
${quickMove}
    }

${moveTo}

    @Override
    public boolean clickMenuButton(${N.Player} player, int button) {
        switch (button) {
${clicks.join("\n")}
            default:
                return false;
        }
    }
${tickLines.length ? `
    /** Set while the tick procedure runs: a procedure that changes a slot calls broadcastChanges again. */
    private boolean ticking;

    @Override
    public void broadcastChanges() {
        super.broadcastChanges();
        if (this.world.isClientSide() || this.ticking) return;
        this.ticking = true;
        try {
${tickLines.map((line) => `            ${line.replaceAll("\n", "\n            ")}`).join("\n")}
        } finally {
            this.ticking = false;
        }
    }
` : ""}${onSlotChanged ? `
    /**
     * onSlotChanged: the slot ids it watches and the stacks last seen in each backing container. The menus of one
     * container share them, so a change runs the procedure once however many players have it open.
     */
    private static final int[] WATCHED = {${watched.join(", ")}};
    private static final java.util.Map<${N.Container}, ${N.Stack}[]> SEEN = new java.util.WeakHashMap<>();
    /** Set while onSlotChanged runs: the slots it changes count as seen, so it does not run itself again. */
    private static boolean slotEvent;

    private ${N.Stack}[] slotStacks() {
        ${N.Stack}[] stacks = new ${N.Stack}[WATCHED.length];
        for (int i = 0; i < WATCHED.length; i++) stacks[i] = this.container.getItem(WATCHED[i]).copy();
        return stacks;
    }

    /** Runs onSlotChanged for each watched slot whose stack differs from the one last seen (the player's open menu only). */
    private void slotChanges() {
        ${N.Stack}[] seen = SEEN.get(this.container);
        if (seen == null || slotEvent || this.entity.containerMenu != this) return;
        slotEvent = true;
        try {
            boolean ran = false;
            for (int i = 0; i < WATCHED.length; i++) {
                if (${N.Stack}.matches(seen[i], this.container.getItem(WATCHED[i]))) continue;
                seen[i] = this.container.getItem(WATCHED[i]).copy();
                ran = true;
                ${onSlotChanged};
            }
            if (ran) SEEN.put(this.container, this.slotStacks());
        } finally {
            slotEvent = false;
        }
    }
` : ""}${serverTexts.length ? `
    /** Label texts last sent to the player, by widget index. */
    private final java.util.Map<Integer, String> sentText = new java.util.HashMap<>();

    private void syncText(int index, String text) {
        if (text.equals(this.sentText.put(index, text))) return;
        ${network}.toPlayer(this.entity, new ${network}.${GUI_TEXT_SEGMENT}(this.containerId, index, text));
    }
` : ""}
    @Override
    public void removed(${N.Player} player) {
        super.removed(player);
${session ? `        if (this.session != null) ${sessions}.leave(this.session, player${kept.map((id) => `, ${id}`).join("")});
        else {
    ${giveBack.replaceAll("\n", "\n    ")}
        }` : giveBack}${onClosed ?`\n        if (!this.world.isClientSide()) ${onClosed};` : ""}
    }
}
`;
  return { path: `${pkg.replaceAll(".", "/")}/world/inventory/${cls}.java`, code };
}

function screenSource(env: GenEnv, gui: ElementContext): JavaSourceFile {
  const legacy = env.mc === "1.16.5";
  const v26 = env.mc === "26.3";
  const pkg = env.project.mod.package;
  const cls = `${pascal(gui.id as string)}Screen`;
  const menu = `${pkg}.world.inventory.${pascal(gui.id as string)}Menu`;
  const all = gui.widgets as Widget[];
  const W = int(gui.width, 176);
  const H = int(gui.height, 166);
  const G = legacy ? "com.mojang.blaze3d.matrix.MatrixStack" : v26 ? "net.minecraft.client.gui.GuiGraphicsExtractor" : "net.minecraft.client.gui.GuiGraphics";
  const fill = legacy ? "fill(g, " : "g.fill(";
  const fields: string[] = [];
  const init: string[] = [];
  const focus: string[] = [];
  /** Extra screen methods (a toggle button's state). */
  const members: string[] = [];
  const at = (w: Widget) => `this.leftPos + ${int(w.x, 0)}, this.topPos + ${int(w.y, 0)}`;
  const clientDeps = { x: "this.menu.x", y: "this.menu.y", z: "this.menu.z", world: "this.menu.world", entity: "this.menu.entity" };
  const condition = (w: Widget) => (str(w.condition) ? procedureCallById(env, w.condition, clientDeps, `gui/${gui.id}`, "logic") : undefined);
  const conditional = (w: Widget, line: string) => {
    const test = condition(w);
    return test ? `if (${test}) {\n            ${line}\n        }` : line;
  };
  /** Q229: milliseconds into an animated image's animation, from its animationStart. */
  const imageClock = (w: Widget) => {
    if (w.animationStart === "always") return "System.currentTimeMillis()";
    if (w.animationStart === "procedure") return `${textureAnimationsClass(env)}.since(${jstr(String(gui.id))}, ${jstr(imageKey(w.name, w.index))})`;
    if (!fields.includes(OPENED_AT)) fields.push(OPENED_AT);
    return "(System.currentTimeMillis() - this.openedAt)";
  };
  const shown: string[] = [];
  const shownField = (w: Widget, name: string) => {
    const test = condition(w);
    if (test) shown.push(`this.${name}.visible = ${test};`);
  };
  for (const w of all) {
    const t = text(env, w.key);
    const name = `widget${w.index}`;
    if (w.kind === "button") {
      const width = int(w.width, 60);
      const height = int(w.height, 20);
      const type = legacy ? "net.minecraft.client.gui.widget.button.Button" : "net.minecraft.client.gui.components.Button";
      fields.push(`    private ${type} ${name};`);
      if (w.invisible === true) {
        // A click area only: the button's own drawing is left out.
        // Default narration as a lambda: Button.DEFAULT_NARRATION is protected and the constructor arguments are
        // evaluated in the screen, not in the subclass (KUYRUK 100).
        const draw = legacy ? "public void renderButton(com.mojang.blaze3d.matrix.MatrixStack matrix, int mouseX, int mouseY, float partial)"
          : env.mc === "26.3" ? "protected void extractContents(net.minecraft.client.gui.GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partial)"
          : "protected void renderWidget(net.minecraft.client.gui.GuiGraphics graphics, int mouseX, int mouseY, float partial)";
        const made = legacy
          ? `new ${type}(${at(w)}, ${width}, ${height}, ${t}, button -> this.press(${w.index}))`
          : `new ${type}(${at(w)}, ${width}, ${height}, ${t}, button -> this.press(${w.index}), java.util.function.Supplier::get)`;
        init.push(`this.${name} = this.${legacy ? "addButton" : "addRenderableWidget"}(${made} {\n            @Override\n            ${draw} {\n            }\n        });`);
      } else init.push(legacy
        ? `this.${name} = this.addButton(new ${type}(${at(w)}, ${width}, ${height}, ${t}, button -> this.press(${w.index})));`
        : `this.${name} = this.addRenderableWidget(${type}.builder(${t}, button -> this.press(${w.index})).bounds(${at(w)}, ${width}, ${height}).build());`);
      shownField(w, name);
      if (w.invisible !== true && textScaleOf(w) !== 1) {
        // The button's own text would be drawn at the normal size: it is left empty and drawn scaled with the labels.
        init.push(`this.${name}.setMessage(${legacy ? "net.minecraft.util.text.StringTextComponent.EMPTY" : "net.minecraft.network.chat.Component.empty()"});`);
      }
    } else if (w.kind === "image_button") {
      const { w: width, h: height } = { w: int(w.width, 16), h: int(w.height, 16) };
      const id = idExpr(env, `${env.modId}:textures/screens/${gui.id}_${w.index}.png`);
      // Sprite ids leave out "textures/gui/sprites/" and ".png".
      const spriteId = `${env.modId}:screens/${gui.id}_${w.index}`;
      const sprite = idExpr(env, spriteId);
      const highlighted = idExpr(env, `${spriteId}_highlighted`);
      const type = legacy ? "net.minecraft.client.gui.widget.button.ImageButton" : "net.minecraft.client.gui.components.ImageButton";
      fields.push(`    private ${type} ${name};`);
      // Q273: 1.16.5's ImageButton draws without blending; a translucent one turns it on first.
      const blendButton = translucent(w) ? ` {\n            @Override\n            public void renderButton(com.mojang.blaze3d.matrix.MatrixStack matrix, int mouseX, int mouseY, float partial) {\n                ${LEGACY_BLEND}\n                super.renderButton(matrix, mouseX, mouseY, partial);\n            }\n        }` : "";
      // Q275: modern buttons draw their own sprite: hovered only under the mouse or with keyboard focus (LIT), and the
      // pressed sprite for PRESSED_MS after a click when there is one.
      const pressed = !legacy && str(w.pressedImage) ? idExpr(env, `${spriteId}_pressed`) : "";
      if (pressed) fields.push(`    private long ${name}Pressed;`);
      const onPress = pressed ? `button -> { this.${name}Pressed = System.currentTimeMillis() + ${PRESSED_MS}L; this.press(${w.index}); }` : `button -> this.press(${w.index})`;
      const spriteRender = v26 ? "public void extractContents(net.minecraft.client.gui.GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partial)"
        : "public void renderWidget(net.minecraft.client.gui.GuiGraphics graphics, int mouseX, int mouseY, float partial)";
      const spritePipeline = v26 ? "net.minecraft.client.renderer.RenderPipelines.GUI_TEXTURED" : "net.minecraft.client.renderer.RenderType::guiTextured";
      const shown = `this.sprites.get(this.isActive(), ${LIT})`;
      const pick = pressed ? `System.currentTimeMillis() < ${cls}.this.${name}Pressed ? ${pressed} : ${shown}` : shown;
      const spriteBody = ` {\n            @Override\n            ${spriteRender} {\n                graphics.blitSprite(${spritePipeline}, ${pick}, this.getX(), this.getY(), this.width, this.height);\n            }\n        }`;
      init.push(legacy
        ? `this.${name} = this.addButton(new ${type}(${at(w)}, ${width}, ${height}, 0, 0, ${height}, ${id}, ${width}, ${height * 2}, button -> this.press(${w.index}))${blendButton});`
        : `this.${name} = this.addRenderableWidget(new ${type}(${at(w)}, ${width}, ${height}, new net.minecraft.client.gui.components.WidgetSprites(${sprite}, ${highlighted}), ${onPress})${spriteBody});`);
      shownField(w, name);
    } else if (w.kind === "toggle_button" && w.toggle) {
      // KUYRUK 96: a button that draws one of four textures (off / on, each plain or under the mouse); the state
      // procedure says on or off every frame, a click runs the procedure on the server like any button.
      const width = int(w.width, 16), height = int(w.height, 16);
      const type = legacy ? "net.minecraft.client.gui.widget.button.Button" : "net.minecraft.client.gui.components.Button";
      fields.push(`    private ${type} ${name};`);
      const state = str(w.stateProcedure) ? procedureCallById(env, w.stateProcedure, clientDeps, `gui/${gui.id}`, "logic") : undefined;
      if (state) members.push(`    /** On or off state of toggle button ${w.index}, read every frame. */\n    private boolean ${name}On() {\n        return ${state};\n    }`);
      const draw = (tex: DrawnTexture) => {
        const id = idExpr(env, `${env.modId}:textures/${tex.path}.png`);
        const v = tex.animation ? `(float) (${frameIndexExpr(env, tex.animation, "System.currentTimeMillis()")} * ${tex.fh})` : "0.0F";
        if (legacy) return `net.minecraft.client.Minecraft.getInstance().getTextureManager().bind(${id});
                com.mojang.blaze3d.systems.RenderSystem.enableBlend();
                blit(matrix, this.x, this.y, ${width}, ${height}, 0.0F, ${v}, ${tex.fw}, ${tex.fh}, ${tex.tw}, ${tex.th});`;
        const pipeline = v26 ? "net.minecraft.client.renderer.RenderPipelines.GUI_TEXTURED" : "net.minecraft.client.renderer.RenderType::guiTextured";
        return `graphics.blit(${pipeline}, ${id}, this.getX(), this.getY(), 0.0F, ${v}, ${width}, ${height}, ${tex.fw}, ${tex.fh}, ${tex.tw}, ${tex.th});`;
      };
      // Q275: with pressed textures, the pressed one of the current state shows for PRESSED_MS after a click.
      const pressedTex = w.toggle.length > 4;
      if (pressedTex) fields.push(`    private long ${name}Pressed;`);
      const onPress = pressedTex ? `button -> { this.${name}Pressed = System.currentTimeMillis() + ${PRESSED_MS}L; this.press(${w.index}); }` : `button -> this.press(${w.index})`;
      const body = `boolean on = ${state ? `${cls}.this.${name}On()` : "false"};
                int state = (on ? 2 : 0) + (this.isHovered() ? 1 : 0);
                ${pressedTex ? `if (System.currentTimeMillis() < ${cls}.this.${name}Pressed) state = on ? 5 : 4;\n                ` : ""}${w.toggle.map((tex, s) => `${s ? "else " : ""}if (state == ${s}) {\n                    ${draw(tex).replaceAll("\n                ", "\n                    ")}\n                }`).join("\n                ")}`;
      const render = legacy ? "public void renderButton(com.mojang.blaze3d.matrix.MatrixStack matrix, int mouseX, int mouseY, float partial)"
        : v26 ? "protected void extractContents(net.minecraft.client.gui.GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partial)"
        : "protected void renderWidget(net.minecraft.client.gui.GuiGraphics graphics, int mouseX, int mouseY, float partial)";
      const empty = legacy ? "net.minecraft.util.text.StringTextComponent.EMPTY" : "net.minecraft.network.chat.Component.empty()";
      const made = legacy
        ? `new ${type}(${at(w)}, ${width}, ${height}, ${empty}, ${onPress})`
        : `new ${type}(${at(w)}, ${width}, ${height}, ${empty}, ${onPress}, java.util.function.Supplier::get)`;
      init.push(`this.${name} = this.${legacy ? "addButton" : "addRenderableWidget"}(${made} {\n            @Override\n            ${render} {\n                ${body}\n            }\n        });`);
      shownField(w, name);
    } else if (w.kind === "text_field") {
      const type = legacy ? "net.minecraft.client.gui.widget.TextFieldWidget" : "net.minecraft.client.gui.components.EditBox";
      fields.push(`    private ${type} ${name};`);
      init.push(`this.${name} = new ${type}(this.font, ${at(w)}, ${int(w.width, 120)}, ${int(w.height, 20)}, ${t});`);
      init.push(`this.${name}.setMaxLength(32767);`);
      if (!legacy && str(w.text)) init.push(`this.${name}.setHint(${t});`);
      init.push(legacy ? `this.addButton(this.${name});` : `this.addRenderableWidget(this.${name});`);
      focus.push(name);
    } else if (w.kind === "checkbox") {
      init.push(legacy
        ? `this.addButton(new net.minecraft.client.gui.widget.button.CheckboxButton(${at(w)}, 20, 20, ${t}, ${w.checked === true}));`
        : `this.addRenderableWidget(net.minecraft.client.gui.components.Checkbox.builder(${t}, this.font).pos(${at(w)}).selected(${w.checked === true}).build());`);
    }
  }
  // Images and labels draw in z order (KUYRUK 103): z <= 0 in their normal place (images in the background, labels in
  // renderLabels), z > 0 over slots, items and buttons in the front pass after the screen's own drawing.
  const inFront = (w: Widget) => zOf(w) > 0;
  /** `rel`: drawn relative to the GUI's corner (renderLabels and the front pass have leftPos/topPos applied). */
  const drawImage = (w: Widget, rel: boolean) => {
    // Q273: 1.16.5 draws the background without blending; a translucent image turns it on first.
    const blend = legacy && translucent(w) ? `${LEGACY_BLEND}\n        ` : "";
    if (w.kind === "state_image") {
      const prefix = `this.widget${w.index}`;
      const pos = rel ? [String(int(w.x, 0)), String(int(w.y, 0))] : [`this.leftPos + ${int(w.x, 0)}`, `this.topPos + ${int(w.y, 0)}`];
      return conditional(w, stateDraw(env, w, w.stateTex ?? [], prefix, pos[0], pos[1], (id) => `${blend}this.minecraft.getTextureManager().bind(${id});`));
    }
    const id = idExpr(env, `${env.modId}:textures/screens/${gui.id}_${w.index}.png`);
    const { w: iw, h: ih } = w.size;
    const anim = w.animation;
    // The texture is scaled to the widget, as the editor draws it: a frame strip becomes iw x (ih * frames).
    const tw = iw;
    const th = anim ? ih * anim.frameCount : ih;
    const vOffset = anim ? `(float) (${frameIndexExpr(env, anim, imageClock(w))} * ${ih})` : "0.0F";
    const pos = rel ? `${int(w.x, 0)}, ${int(w.y, 0)}` : at(w);
    if (legacy) return conditional(w, `${blend}this.minecraft.getTextureManager().bind(${id});\n        blit(g, ${pos}, 0.0F, ${vOffset}, ${iw}, ${ih}, ${tw}, ${th});`);
    const pipeline = v26 ? "net.minecraft.client.renderer.RenderPipelines.GUI_TEXTURED" : "net.minecraft.client.renderer.RenderType::guiTextured";
    return conditional(w, `g.blit(${pipeline}, ${id}, ${pos}, 0.0F, ${vOffset}, ${iw}, ${ih}, ${tw}, ${th});`);
  };
  const serverTexts = new Set(guiServerTexts(gui as unknown as Element, procedureBuild(env).scope).map((t) => t.index));
  const drawLabel = (w: Widget) => {
    // A text that needs the server comes from the menu (KUYRUK 105); calling it here would send a packet every frame.
    const dynamic = serverTexts.has(w.index) ? guiTextRead(env, "this.menu.containerId", w.index)
      : str(w.textProcedure) ? procedureCallById(env, w.textProcedure, clientDeps, `gui/${gui.id}`) : undefined;
    const t = !dynamic ? text(env, w.key) : legacy ? `new net.minecraft.util.text.StringTextComponent(${dynamic})` : `net.minecraft.network.chat.Component.literal(${dynamic})`;
    return conditional(w, labelText(env.mc, w, String(int(w.x, 0)), String(int(w.y, 0)), "this.font", t, argb(w.color)));
  };
  const isImage = (w: Widget) => (w.kind === "image" && str(w.image)) || (w.kind === "state_image" && (w.stateTex ?? []).some(Boolean));
  for (const w of all.filter((w) => w.kind === "state_image" && isImage(w))) {
    const expression = stateExpression(w, imageStates(w).length, (id, returns) => procedureCallById(env, id, clientDeps, `gui/${gui.id}`, returns));
    members.push(stateMembers(w, `widget${w.index}`, expression, false, `State image ${w.index}`));
  }
  const drawn = byZ(all.filter((w) => isImage(w) || w.kind === "label"));
  const bgImages = drawn.filter((w) => w.kind !== "label" && !inFront(w)).map((w) => drawImage(w, false));
  const labels = drawn.filter((w) => w.kind === "label" && !inFront(w)).map(drawLabel);
  // Front pass, in order: each element above the one before. 1.16.5 draws with the depth test off, 1.21.5 one depth
  // step higher each (items reach about 250, tooltips 400), 26.x a new stratum each (items of a stratum draw after its
  // images).
  const frontPass = drawn.filter(inFront).map((w, k) => {
    const line = w.kind !== "label" ? drawImage(w, true) : drawLabel(w);
    if (legacy) return line;
    if (v26) return `g.nextStratum();\n        ${line}`;
    return `g.pose().pushPose();
        g.pose().translate(0.0F, 0.0F, ${300 + Math.min(k, 90)}.0F);
        ${line}
        g.pose().popPose();`;
  });
  // Buttons with scaled text: white with a shadow like vanilla's, centred on the button, while the button shows.
  for (const w of all) {
    if (w.kind !== "button" || w.invisible === true || textScaleOf(w) === 1) continue;
    const t = text(env, w.key);
    const cx = String(int(w.x, 0) + Math.floor(int(w.width, 60) / 2)), cy = String(int(w.y, 0) + Math.floor(int(w.height, 20) / 2));
    const line = scaledText(env.mc, textScaleOf(w), cx, cy, () => (legacy
      ? `this.font.drawShadow(g, ${t}, -this.font.width(${t}) / 2.0F, -4.0F, 0xFFFFFF);`
      : `g.${v26 ? "text" : "drawString"}(this.font, ${t}, -this.font.width(${t}) / 2, -4, 0xFFFFFFFF, true);`));
    labels.push(`if (this.widget${w.index}.visible) {
            ${line}
        }`);
  }
  const panel = gui.renderBgLayer !== false
    ? `        int l = this.leftPos, t = this.topPos, r = l + ${W}, b = t + ${H};
        ${fill}l, t, r, b, 0xFFC6C6C6);
        ${fill}l, t, r - 1, t + 1, 0xFFFFFFFF);
        ${fill}l, t, l + 1, b - 1, 0xFFFFFFFF);
        ${fill}l + 1, b - 1, r, b, 0xFF555555);
        ${fill}r - 1, t + 1, r, b, 0xFF555555);
`
    : "";
  const slotFrames = `        for (${legacy ? "net.minecraft.inventory.container.Slot" : "net.minecraft.world.inventory.Slot"} slot : this.menu.slots) {
            int sx = this.leftPos + slot.x - 1, sy = this.topPos + slot.y - 1;
            ${fill}sx, sy, sx + 18, sy + 18, 0xFF8B8B8B);
            ${fill}sx, sy, sx + 17, sy + 1, 0xFF373737);
            ${fill}sx, sy, sx + 1, sy + 17, 0xFF373737);
            ${fill}sx + 1, sy + 17, sx + 18, sy + 18, 0xFFFFFFFF);
            ${fill}sx + 17, sy + 1, sx + 18, sy + 18, 0xFFFFFFFF);
        }
`;
  const background = `${shown.map((line) => `        ${line}\n`).join("")}${panel}${slotFrames}${bgImages.map((line) => `        ${line}\n`).join("")}`;
  const Inv = legacy ? "net.minecraft.entity.player.PlayerInventory" : "net.minecraft.world.entity.player.Inventory";
  const Comp = legacy ? "net.minecraft.util.text.ITextComponent" : "net.minecraft.network.chat.Component";
  const sup = legacy ? `net.minecraft.client.gui.screen.inventory.ContainerScreen<${menu}>` : `net.minecraft.client.gui.screens.inventory.AbstractContainerScreen<${menu}>`;
  const ctor = v26 ? `        super(menu, inventory, title, ${W}, ${H});` : `        super(menu, inventory, title);
        this.imageWidth = ${W};
        this.imageHeight = ${H};`;
  const focused = focus.map((f) => `        if (this.${f}.isFocused()) return this.${f}.keyPressed(${v26 ? "event" : "key, scan, modifiers"});`).join("\n");
  const keyPressed = v26
    ? `    @Override
    public boolean keyPressed(net.minecraft.client.input.KeyEvent event) {
        if (event.isEscape()) {
            this.minecraft.player.closeContainer();
            return true;
        }
${focused}
        return super.keyPressed(event);
    }`
    : `    @Override
    public boolean keyPressed(int key, int scan, int modifiers) {
        if (key == 256) {
            this.minecraft.player.closeContainer();
            return true;
        }
${focused}
        return super.keyPressed(key, scan, modifiers);
    }`;
  const lines = (list: string[]) => list.map((l) => `        ${l}\n`).join("");
  let render: string;
  if (legacy) {
    render = `    @Override
    public void render(${G} g, int mouseX, int mouseY, float partialTicks) {
        this.renderBackground(g);
        super.render(g, mouseX, mouseY, partialTicks);
        this.renderTooltip(g, mouseX, mouseY);
    }

    @Override
    protected void renderBg(${G} g, float partialTicks, int mouseX, int mouseY) {
        com.mojang.blaze3d.systems.RenderSystem.color4f(1.0F, 1.0F, 1.0F, 1.0F);
${background}    }

    @Override
    protected void renderLabels(${G} g, int mouseX, int mouseY) {
${lines(labels)}${frontPass.length ? `        com.mojang.blaze3d.systems.RenderSystem.enableBlend();
        com.mojang.blaze3d.systems.RenderSystem.defaultBlendFunc();
        com.mojang.blaze3d.systems.RenderSystem.disableDepthTest();
        g.pushPose();
        g.translate(0.0D, 0.0D, 300.0D);
${lines(frontPass)}        g.popPose();
        com.mojang.blaze3d.systems.RenderSystem.enableDepthTest();
        com.mojang.blaze3d.systems.RenderSystem.disableBlend();
` : ""}    }`;
  } else if (v26) {
    render = `    @Override
    public void extractBackground(${G} g, int mouseX, int mouseY, float a) {
        super.extractBackground(g, mouseX, mouseY, a);
${background}    }

    @Override
    protected void extractLabels(${G} g, int mouseX, int mouseY) {
${lines(labels)}    }${frontPass.length ? `

    @Override
    public void extractContents(${G} g, int mouseX, int mouseY, float a) {
        super.extractContents(g, mouseX, mouseY, a);
        g.pose().pushMatrix();
        g.pose().translate((float) this.leftPos, (float) this.topPos);
${lines(frontPass)}        g.pose().popMatrix();
    }` : ""}`;
  } else {
    render = `    @Override
    public void render(${G} g, int mouseX, int mouseY, float partialTicks) {
        super.render(g, mouseX, mouseY, partialTicks);
        this.renderTooltip(g, mouseX, mouseY);
    }

    @Override
    protected void renderBg(${G} g, float partialTicks, int mouseX, int mouseY) {
${background}    }

    @Override
    protected void renderLabels(${G} g, int mouseX, int mouseY) {
${lines(labels)}${lines(frontPass)}    }`;
  }
  const code = `package ${pkg}.client.gui;

/** Generated by MCEdge: screen of GUI "${gui.id}". */
public class ${cls} extends ${sup} {
${fields.join("\n")}
    public ${cls}(${menu} menu, ${Inv} inventory, ${Comp} title) {
${ctor}
    }

    @Override
    protected void init() {
        super.init();
${init.map((l) => `        ${l}\n`).join("")}    }

    /** Runs the button's procedure on the server. */
    private void press(int button) {
        this.minecraft.gameMode.handleInventoryButtonClick(this.menu.containerId, button);
    }
${members.map((m) => `\n${m}\n`).join("")}
${render}

${keyPressed}

    @Override
    public boolean isPauseScreen() {
        return ${gui.doesPauseGame === true};
    }
}
`;
  return { path: `${pkg.replaceAll(".", "/")}/client/gui/${cls}.java`, code };
}

/** <Mod>Menus: menu types, open helpers and the item inventory container. */
function menusSource(env: GenEnv, guis: ElementContext[]): { source: JavaSourceFile; init: string } {
  const N = names(env);
  const legacy = env.mc === "1.16.5";
  const pkg = env.project.mod.package;
  const cls = `${modClassName(env)}Menus`;
  const owner = `${pkg}.init.${cls}`;
  const menu = (g: ElementContext) => `${pkg}.world.inventory.${pascal(g.id as string)}Menu`;
  const C = (g: ElementContext) => String(g.id).toUpperCase();
  // The client builds a menu from the block position the server sends with it, so block GUIs read their block.
  const fabricMenu = env.mc === "26.3"
    ? { type: "net.fabricmc.fabric.api.menu.v1.ExtendedMenuType", provider: "net.fabricmc.fabric.api.menu.v1.ExtendedMenuProvider" }
    : { type: "net.fabricmc.fabric.api.screenhandler.v1.ExtendedScreenHandlerType", provider: "net.fabricmc.fabric.api.screenhandler.v1.ExtendedScreenHandlerFactory" };
  let fields: string;
  let init: string;
  if (legacy) {
    fields = `    public static final net.minecraftforge.registries.DeferredRegister<${N.MenuType}<?>> REGISTRY = net.minecraftforge.registries.DeferredRegister.create(net.minecraftforge.registries.ForgeRegistries.CONTAINERS, ${jstr(env.modId)});
${guis.map((g) => `    public static final net.minecraftforge.fml.RegistryObject<${N.MenuType}<${menu(g)}>> ${C(g)} = REGISTRY.register(${jstr(g.id as string)}, () -> net.minecraftforge.common.extensions.IForgeContainerType.create((id, inventory, buf) -> new ${menu(g)}(id, inventory, null, buf.readBlockPos())));`).join("\n")}`;
    init = `${owner}.REGISTRY.register(modBus);`;
  } else if (env.loader === "neoforge") {
    fields = `    public static final net.neoforged.neoforge.registries.DeferredRegister<${N.MenuType}<?>> REGISTRY = net.neoforged.neoforge.registries.DeferredRegister.create(net.minecraft.core.registries.Registries.MENU, ${jstr(env.modId)});
${guis.map((g) => `    public static final net.neoforged.neoforge.registries.DeferredHolder<${N.MenuType}<?>, ${N.MenuType}<${menu(g)}>> ${C(g)} = REGISTRY.register(${jstr(g.id as string)}, () -> net.neoforged.neoforge.common.extensions.IMenuTypeExtension.create((id, inventory, buf) -> new ${menu(g)}(id, inventory, null, buf.readBlockPos())));`).join("\n")}`;
    init = `${owner}.REGISTRY.register(modBus);`;
  } else {
    fields = `${guis.map((g) => `    public static final ${N.MenuType}<${menu(g)}> ${C(g)} = net.minecraft.core.Registry.register(net.minecraft.core.registries.BuiltInRegistries.MENU, ${idExpr(env, `${env.modId}:${g.id}`)}, new ${fabricMenu.type}<>((id, inventory, pos) -> new ${menu(g)}(id, inventory, null, pos), ${N.Pos}.STREAM_CODEC));`).join("\n")}

    /** Loads the class, which registers the menu types. */
    public static void init() {}`;
    init = `${owner}.init();`;
  }
  const level = legacy ? "player.level" : "player.level()";
  const be = legacy ? "net.minecraft.tileentity.TileEntity" : "net.minecraft.world.level.block.entity.BlockEntity";
  // A screen reads variables as it opens, so they go out before it rather than at the end of the tick.
  const flush = env.project.variables.length && procedureBuild(env).compiled.size ? `        ${pkg}.procedures.${modClassName(env)}Variables.flush(player);\n` : "";
  const openCall = (g: ElementContext) => {
    const title = text(env, `gui.${env.modId}.${g.id}`);
    const provider = `new ${N.Provider}((id, inventory, p) -> new ${menu(g)}(id, inventory, slots, pos), ${title})`;
    if (legacy) return `net.minecraftforge.fml.network.NetworkHooks.openGui(player, ${provider}, pos);`;
    if (env.loader === "neoforge") return `player.openMenu(${provider}, pos);`;
    return `player.openMenu(new ${fabricMenu.provider}<${N.Pos}>() {
            @Override
            public ${N.Pos} getScreenOpeningData(${N.ServerPlayer} target) {
                return pos;
            }

            @Override
            public net.minecraft.network.chat.Component getDisplayName() {
                return ${title};
            }

            @Override
            public ${N.Menu} createMenu(int id, ${N.Inv} inventory, ${N.Player} target) {
                return new ${menu(g)}(id, inventory, slots, pos);
            }
        });`;
  };
  const opens = guis.map((g) => `    /** Opens GUI "${g.id}"; slots use \`container\`, else the inventory of the block entity at \`pos\`, else a temporary one. */
    public static void open${pascal(g.id as string)}(${N.ServerPlayer} player, ${N.Pos} pos, ${N.Container} container) {
${flush}        ${be} blockEntity = ${level}.getBlockEntity(pos);
        ${N.Container} slots = container != null ? container : blockEntity instanceof ${N.Container} ? (${N.Container}) blockEntity : null;
        ${openCall(g)}
    }`);
  const cases = guis.map((g) => `            case ${jstr(g.id as string)}:\n                open${pascal(g.id as string)}(player, pos, null);\n                break;`);
  // Q205: session GUIs open on a shared inventory named by a text id, at the player's position.
  const sessions = guiSessionsClass(env);
  const sessionCases = guis.filter((g) => isSessionGui(g)).map((g) => `            case ${jstr(g.id as string)}:
                session = ${sessions}.open(id, ${sessionSize(g as unknown as Element, guiSlots(g as unknown as Element))});
                ${sessions}.opening(session, player, true);
                try {
                    open${pascal(g.id as string)}(player, player.blockPosition(), session);
                } finally {
                    ${sessions}.opening(session, player, false);
                }
                break;`);
  const openSession = sessionCases.length ? `
    /** Opens session GUI \`gui\` for a player on session \`id\` (Q205): every player with the same id shares its slots and values. */
    public static void openSession(${N.Entity} entity, String gui, String id) {
        if (!(entity instanceof ${N.ServerPlayer}) || id == null || id.isEmpty()) return;
        ${N.ServerPlayer} player = (${N.ServerPlayer}) entity;
        ${sessions}.Session session;
        switch (gui) {
${sessionCases.join("\n")}
            default:
                break;
        }
    }
` : `
    /** No GUI takes a session (Q205): nothing opens. */
    public static void openSession(${N.Entity} entity, String gui, String id) {
    }
`;
  const itemContainer = legacy
    ? `    /** An inventory kept in the item's item handler capability, saved as \`ForgeCaps.Parent\` of the stack like MCreator did; it stays usable while the player holds that stack. */
    public static class ItemContainer extends ${N.Simple} {
        private final ${N.Stack} stack;
        private final int maxStack;
        private boolean loading;

        public ItemContainer(${N.Stack} stack, int size, int maxStack) {
            super(size);
            this.stack = stack;
            this.maxStack = maxStack;
            net.minecraftforge.items.IItemHandler handler = stack.getCapability(net.minecraftforge.items.CapabilityItemHandler.ITEM_HANDLER_CAPABILITY).orElse(null);
            this.loading = true;
            if (handler != null) {
                for (int i = 0; i < Math.min(size, handler.getSlots()); i++) super.setItem(i, handler.getStackInSlot(i).copy());
            }
            this.loading = false;
        }

        /** The item does not go into its own inventory. */
        public boolean accepts(${N.Stack} other) {
            return other.getItem() != this.stack.getItem();
        }

        @Override
        public int getMaxStackSize() {
            return this.maxStack;
        }

        @Override
        public void setChanged() {
            super.setChanged();
            if (this.loading) return;
            net.minecraftforge.items.IItemHandler handler = this.stack.getCapability(net.minecraftforge.items.CapabilityItemHandler.ITEM_HANDLER_CAPABILITY).orElse(null);
            if (!(handler instanceof net.minecraftforge.items.IItemHandlerModifiable)) return;
            for (int i = 0; i < Math.min(this.getContainerSize(), handler.getSlots()); i++) ((net.minecraftforge.items.IItemHandlerModifiable) handler).setStackInSlot(i, this.getItem(i).copy());
        }

        @Override
        public boolean stillValid(${N.Player} player) {
            return player.getMainHandItem() == this.stack || player.getOffhandItem() == this.stack;
        }
    }`
    : `    /** An inventory stored in an item stack's container component; it stays usable while the player holds that stack. */
    public static class ItemContainer extends ${N.Simple} {
        private final ${N.Stack} stack;
        private final int maxStack;

        public ItemContainer(${N.Stack} stack, int size, int maxStack) {
            super(size);
            this.stack = stack;
            this.maxStack = maxStack;
            stack.getOrDefault(net.minecraft.core.component.DataComponents.CONTAINER, net.minecraft.world.item.component.ItemContainerContents.EMPTY).copyInto(this.getItems());
        }

        @Override
        public int getMaxStackSize() {
            return this.maxStack;
        }

        @Override
        public void setChanged() {
            super.setChanged();
            this.stack.set(net.minecraft.core.component.DataComponents.CONTAINER, net.minecraft.world.item.component.ItemContainerContents.fromItems(this.getItems()));
        }

        /** The item does not go into its own inventory. */
        public boolean accepts(${N.Stack} other) {
            return other.getItem() != this.stack.getItem();
        }

        @Override
        public boolean stillValid(${N.Player} player) {
            return player.getMainHandItem() == this.stack || player.getOffhandItem() == this.stack;
        }
    }`;
  const code = `package ${pkg}.init;

/** Generated by MCEdge: menu types of the mod's GUIs. */
public final class ${cls} {
    private ${cls}() {}

${fields}

    /** Opens a GUI by element id for a player (other entities are ignored). */
    public static void open(${N.Entity} entity, String gui, ${N.Pos} pos) {
        if (!(entity instanceof ${N.ServerPlayer})) return;
        ${N.ServerPlayer} player = (${N.ServerPlayer}) entity;
        switch (gui) {
${cases.join("\n")}
            default:
                break;
        }
    }
${openSession}
${opens.join("\n\n")}

${itemContainer}
}
`;
  return { source: { path: `${pkg.replaceAll(".", "/")}/init/${cls}.java`, code }, init };
}

/** <Mod>Screens (client): binds each menu type to its screen. */
function screensSource(env: GenEnv, guis: ElementContext[]): { source: JavaSourceFile; init: string } {
  const pkg = env.project.mod.package;
  const cls = `${modClassName(env)}Screens`;
  const type = (g: ElementContext) => `${menusClass(env)}.${String(g.id).toUpperCase()}${env.loader === "fabric" ? "" : ".get()"}`;
  const screen = (g: ElementContext) => `${pkg}.client.gui.${pascal(g.id as string)}Screen::new`;
  let body: string;
  let init: string;
  if (env.mc === "1.16.5") {
    body = `    public static void register(net.minecraftforge.eventbus.api.IEventBus modBus) {
        modBus.addListener(${cls}::setup);
    }

    private static void setup(net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent event) {
        event.enqueueWork(() -> {
${guis.map((g) => `            net.minecraft.client.gui.ScreenManager.register(${type(g)}, ${screen(g)});`).join("\n")}
        });
    }`;
    init = `${pkg}.client.${cls}.register(modBus);`;
  } else if (env.loader === "neoforge") {
    body = `    public static void register(net.neoforged.bus.api.IEventBus modBus) {
        modBus.addListener(${cls}::screens);
    }

    private static void screens(net.neoforged.neoforge.client.event.RegisterMenuScreensEvent event) {
${guis.map((g) => `        event.register(${type(g)}, ${screen(g)});`).join("\n")}
    }`;
    init = `${pkg}.client.${cls}.register(modBus);`;
  } else {
    body = `    public static void register() {
${guis.map((g) => `        net.minecraft.client.gui.screens.MenuScreens.register(${type(g)}, ${screen(g)});`).join("\n")}
    }`;
    init = `${pkg}.client.${cls}.register();`;
  }
  const code = `package ${pkg}.client;

/** Generated by MCEdge: screens of the mod's GUIs; loaded only on the physical client. */
public final class ${cls} {
    private ${cls}() {}

${body}
}
`;
  return { source: { path: `${pkg.replaceAll(".", "/")}/client/${cls}.java`, code }, init };
}

/** Q229: when the screen opened, the start of its images' animations. */
const OPENED_AT = "    private final long openedAt = System.currentTimeMillis();";

export default {
  element,
  runtime(guis, env) {
    if (!guis.length) return {};
    const menus = menusSource(env, guis);
    const screens = screensSource(env, guis);
    return {
      sources: [...guis.flatMap((g) => [menuSource(env, g), screenSource(env, g)]), menus.source, screens.source,
        ...(guis.some((g) => isSessionGui(g)) ? [guiSessionsSource(env)] : []), textureAnimationsSource(env)],
      init: [menus.init],
      clientInit: [screens.init],
    };
  },
} satisfies TypeModule;
