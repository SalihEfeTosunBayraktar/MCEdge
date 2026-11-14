// MCreator 1.16.5 import, GUIs (KUYRUK #11): every <X>Gui + <X>GuiWindow pair becomes a gui element: size, background
// and images, labels (fixed or from a procedure, with conditions), buttons and image buttons with their procedures,
// slots with their locks, the player inventory position, and the opened / closed / tick procedures.
// usage: node tools/import-mcreator/guis.ts <legacy mod dir> <project dir>
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { newElement } from "../../src/elements/model.ts";
import { typeRegistry } from "../../src/elements/registry.ts";
import { callArguments, copyTexture, methodBody, procedureCalls, procedureId } from "./javaText.ts";

const [legacyDir, projectDir] = process.argv.slice(2);
if (!legacyDir || !projectDir) {
  console.log("usage: node tools/import-mcreator/guis.ts <legacy mod dir> <project dir>");
  process.exit(1);
}
const main = join(legacyDir, "src/main");
const modId = /^modId\s*=\s*"([^"]*)"/m.exec(readFileSync(join(main, "resources/META-INF/mods.toml"), "utf8"))![1];
const assets = join(main, "resources/assets", modId);
const javaRoot = join(main, "java");
const guiDir = join(javaRoot, readdirSync(javaRoot)[0], "gui");
const itemDir = join(javaRoot, readdirSync(javaRoot)[0], "item");
const readJson = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
const langs = Object.fromEntries(readdirSync(join(assets, "lang")).map((f) => [f.slice(0, -5), readJson<Record<string, string>>(join(assets, "lang", f))]));
const type = typeRegistry().byId.get("gui")!;
mkdirSync(join(projectDir, "elements/guis"), { recursive: true });

/** Item ids by their class name, for slots limited to one item. */
const itemIds = new Map(readdirSync(itemDir).filter((f) => f.endsWith(".java")).map((f) => [f.slice(0, -5), /setRegistryName\("(\w+)"\)/.exec(readFileSync(join(itemDir, f), "utf8"))?.[1]]));

function copyScreenTexture(ref: string): string {
  const path = ref.replace(`${modId}:`, "");
  const source = join(assets, `${path}`);
  if (!existsSync(source)) return "";
  mkdirSync(dirname(join(projectDir, path)), { recursive: true });
  copyTexture(source, join(projectDir, path));
  return path;
}

/** Procedure guarding `position`: an `if (XProcedure.executeProcedure(...)) {` still open there, after `from`. */
function guard(code: string, from: number, position: number): string {
  const between = code.slice(from, position);
  let open = "";
  for (const call of procedureCalls(between)) {
    const before = between.slice(Math.max(0, call.start - 8), call.start);
    if (/if \($/.test(before) && !between.slice(call.end).includes("}")) open = call.name;
  }
  return open ? procedureId(open) : "";
}

const number = (text: string) => Number(text.replace(/F$/, ""));
const color = (value: number) => `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;

function images(window: string): { widgets: Record<string, unknown>[]; base: boolean } {
  const body = methodBody(window, /protected void renderBg\(/);
  const texture = /ResourceLocation texture = new ResourceLocation\("[^:]+:([^"]+)"\)/.exec(window)?.[1];
  const widgets: Record<string, unknown>[] = [];
  const baseBlit = /blit\(ms, k, l,/.test(body);
  const width = Number(/this\.imageWidth = (\d+)/.exec(window)?.[1] ?? 176);
  const height = Number(/this\.imageHeight = (\d+)/.exec(window)?.[1] ?? 166);
  if (baseBlit && texture) widgets.push({ kind: "image", x: 0, y: 0, width, height, image: copyScreenTexture(`${modId}:${texture}`) });
  const start = baseBlit ? body.indexOf("blit(ms, k, l,") : 0;
  let last = start;
  for (const m of body.slice(start).matchAll(/\.bind\(new ResourceLocation\("([^"]+)"\)\);\s*blit\(ms, this\.leftPos \+ (-?\d+), this\.topPos \+ (-?\d+), 0\.0F, 0\.0F, (\d+), (\d+), (\d+), (\d+)\);/g)) {
    const at = start + m.index;
    const condition = guard(body, last, at);
    last = at + m[0].length;
    const widget = { kind: "image", x: Number(m[2]), y: Number(m[3]), width: Number(m[4]), height: Number(m[5]), image: copyScreenTexture(`${m[1].replace(/:/, ":")}`) };
    widgets.push(condition ? { ...widget, condition } : widget);
  }
  return { widgets, base: baseBlit };
}

/** Lang key of a widget: its name and English text, with the other languages noted under the MCEdge key. */
function translated(key: string, guiId: string, lang: Record<string, Record<string, string>>): { name: string; text: string } {
  const name = key.slice(key.lastIndexOf(".") + 1).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const target = `gui.${modId}.${guiId}.${name}`;
  for (const [code, entries] of Object.entries(langs)) if (code !== "en_us" && entries[key]) (lang[code] ??= {})[target] = entries[key];
  return { name, text: langs.en_us[key] ?? name };
}

function labels(window: string, guiId: string, lang: Record<string, Record<string, string>>): Record<string, unknown>[] {
  const body = methodBody(window, /protected void renderLabels\(/);
  const widgets: Record<string, unknown>[] = [];
  let last = 0;
  for (const m of body.matchAll(/\.draw\(/g)) {
    const { args, end } = callArguments(body, m.index + m[0].length - 1);
    const [, expression, x, y, tint] = args;
    const condition = guard(body, last, m.index);
    last = end;
    const widget: Record<string, unknown> = { kind: "label", x: number(x), y: number(y), color: color(Number(tint)), ...(condition ? { condition } : {}) };
    const dynamic = procedureCalls(expression)[0];
    const key = /TranslationTextComponent\("([^"]+)"\)/.exec(expression)?.[1];
    if (dynamic) widget.textProcedure = procedureId(dynamic.name);
    else if (key) Object.assign(widget, translated(key, guiId, lang));
    else widget.text = /^"(.*)"$/.exec(expression)?.[1] ?? expression;
    widgets.push(widget);
  }
  return widgets;
}

function buttonProcedures(gui: string): Map<number, string> {
  const body = methodBody(gui, /static void handleButtonAction\(/);
  const found = new Map<number, string>();
  for (const m of body.matchAll(/if \(buttonID == (\d+)\) \{/g)) {
    const next = body.indexOf("buttonID ==", m.index + m[0].length);
    const call = procedureCalls(body.slice(m.index, next < 0 ? undefined : next))[0];
    if (call) found.set(Number(m[1]), procedureId(call.name));
  }
  return found;
}

function buttons(window: string, procedures: Map<number, string>, guiId: string, lang: Record<string, Record<string, string>>): Record<string, unknown>[] {
  const widgets: Record<string, unknown>[] = [];
  for (const m of window.matchAll(/new (ImageButton|Button)\(/g)) {
    const { args, end } = callArguments(window, m.index + m[0].length - 1);
    const position = (arg: string) => Number(/(-?\d+)$/.exec(arg)?.[1] ?? 0);
    const buttonId = Number(/ButtonPressedMessage\((\d+),/.exec(window.slice(m.index, end))?.[1] ?? -1);
    const procedure = procedures.get(buttonId);
    // A button shown only sometimes overrides render with the condition.
    const after = window.slice(end, window.indexOf(";", end));
    const condition = /public void render/.test(after) ? procedureCalls(after)[0]?.name : undefined;
    const common = { x: position(args[0]), y: position(args[1]), width: Number(args[2]), height: Number(args[3]), ...(procedure ? { procedure } : {}), ...(condition ? { condition: procedureId(condition) } : {}) };
    if (m[1] === "ImageButton") {
      const ref = /new ResourceLocation\("([^"]+)"\)/.exec(args[7])?.[1] ?? "";
      widgets.push({ kind: "image_button", ...common, image: copyScreenTexture(ref) });
    } else {
      const key = /TranslationTextComponent\("([^"]+)"\)/.exec(args[4])?.[1];
      widgets.push({ kind: "button", ...common, ...(key ? translated(key, guiId, lang) : { text: /StringTextComponent\("([^"]*)"\)/.exec(args[4])?.[1] ?? "" }) });
    }
  }
  return widgets;
}

/** Slots a legacy menu leaves out when it gives its items back on close ("if (j != 0 && j != 1 ...)" in removed). */
export function keptSlots(gui: string): Set<number> {
  const removed = gui.slice(gui.indexOf("public void removed("));
  // The guard may be split over lines between its "&&" parts.
  const guard = /if \(\s*(\w+ != \d+(?:\s*&&\s*\w+ != \d+)*)\s*\)/.exec(removed.slice(0, removed.indexOf("private ")));
  return new Set([...(guard?.[1].matchAll(/!= (\d+)/g) ?? [])].map((m) => Number(m[1])));
}

function slots(gui: string): Record<string, unknown>[] {
  const widgets: Record<string, unknown>[] = [];
  const kept = keptSlots(gui);
  for (const m of gui.matchAll(/new SlotItemHandler\(this\.internal, (\d+), (-?\d+), (-?\d+)\) \{/g)) {
    const open = m.index + m[0].length - 1;
    const body = methodBody(gui.slice(open - 1), /^ \{|^\) \{/) || gui.slice(open + 1, gui.indexOf("}))", open));
    const place = methodBody(body, /public boolean mayPlace\(/);
    const pickup = methodBody(body, /public boolean mayPickup\(/);
    const widget: Record<string, unknown> = { kind: "slot", id: Number(m[1]), x: Number(m[2]) - 1, y: Number(m[3]) - 1 };
    const limit = /return (\w+Item)\.block == /.exec(place)?.[1] ?? /getItem\(\) == (\w+Item)\.block/.exec(place)?.[1];
    const lock = /return !([\p{L}\p{N}_]+Procedure)\.executeProcedure/u.exec(pickup || place)?.[1];
    if (lock) widget.lockCondition = procedureId(lock);
    else if (/return false/.test(pickup)) widget.locked = true;
    else if (/return false/.test(place)) widget.output = true;
    else if (limit) widget.limit = itemIds.get(limit);
    if (kept.has(Number(m[1]))) widget.keepOnClose = true;
    widgets.push(widget);
  }
  return widgets;
}

/** Player inventory frame relative to where MCEdge puts it for this size. */
function inventory(gui: string, width: number, height: number): Record<string, number> {
  const hotbar = /new Slot\(inv, \w+, (\d+) \+ \w+ \* 18, (\d+)\)/.exec(gui);
  if (!hotbar) return { type: 0 };
  return {
    type: 1,
    inventoryOffsetX: Number(hotbar[1]) - (Math.floor((width - 176) / 2) + 8),
    inventoryOffsetY: Number(hotbar[2]) - 58 - (height - 82),
  };
}

const lang: Record<string, Record<string, string>> = {};
let count = 0;
for (const file of readdirSync(guiDir).filter((f) => /[^w]Gui\.java$/.test(f))) {
  const gui = readFileSync(join(guiDir, file), "utf8");
  const windowFile = join(guiDir, file.replace(/\.java$/, "Window.java"));
  const id = /containerType\.setRegistryName\("(\w+)"\)/.exec(gui)?.[1];
  if (!id || !existsSync(windowFile)) continue;
  const window = readFileSync(windowFile, "utf8");
  const width = Number(/this\.imageWidth = (\d+)/.exec(window)?.[1] ?? 176);
  const height = Number(/this\.imageHeight = (\d+)/.exec(window)?.[1] ?? 166);
  const container = gui.slice(gui.indexOf("class GuiContainerMod"));
  const lifecycle = (body: string) => { const call = procedureCalls(body)[0]; return call ? procedureId(call.name) : ""; };
  // Calls in the constructor outside the slot classes run when the GUI opens.
  const opened = methodBody(container, /public GuiContainerMod\(int id, PlayerInventory inv, PacketBuffer extraData\)/).replace(/new SlotItemHandler\(this\.internal[\s\S]*?\n {15,}\}\s*\)/g, "");
  const element = {
    ...newElement(type, id),
    width, height,
    renderBgLayer: false,
    anyDistance: true,
    ...inventory(gui, width, height),
    components: [...images(window).widgets, ...slots(gui), ...buttons(window, buttonProcedures(gui), id, lang), ...labels(window, id, lang)],
    onOpen: lifecycle(opened),
    // MCreator runs "while the GUI is open" from the menu's broadcastChanges, or from a player tick listener of the GUI.
    onTick: lifecycle(methodBody(container, /public void broadcastChanges\(/)) || lifecycle(methodBody(gui, /public void onPlayerTick\(PlayerTickEvent event\)/)),
    onClosed: lifecycle(methodBody(container, /public void removed\(PlayerEntity playerIn\)/)),
  };
  writeFileSync(join(projectDir, "elements/guis", `${id}.json`), JSON.stringify(element, null, 2));
  count++;
}
for (const [code, entries] of Object.entries(lang)) {
  const file = join(projectDir, "localization", `${code}.json`);
  const existing = existsSync(file) ? readJson<Record<string, string>>(file) : {};
  writeFileSync(file, JSON.stringify({ ...existing, ...entries }, null, 2));
}
console.log(`imported ${count} GUIs`);
