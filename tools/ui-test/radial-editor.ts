/**
 * Q227: a radial menu is its own element. New element > Radial menu creates one; its editor shows a live wheel that
 * follows the form (size, colours) and picks the slice under the mouse by direction, as the game does; a tab of a
 * runtime image folder shows placeholder slices; a procedure's "open radial menu" block picks the menu from its list.
 * English and Turkish, dark and light; screenshots go to design/227/. Q228: the opening uses the shared show / hide
 * timing fields (effects, length, easing); Replay plays them on the wheel (design/228/). usage:
 * node tools/ui-test/radial-editor.ts (after npm run build:app)
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, launchApp, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/227");
const OUT_228 = evidence("design/228");
mkdirSync(OUT, { recursive: true });
mkdirSync(OUT_228, { recursive: true });
const trTypes = JSON.parse(readFileSync("config/element-types/tr.json", "utf8")).radial_menu as { name: string; fields: Record<string, { label: string }> };
const enType = JSON.parse(readFileSync("element-types/radial_menu/type.json", "utf8")) as { name: string; pages: { groups: { fields: { key: string; label: string }[] }[] }[] };
const enLabels = Object.fromEntries(enType.pages.flatMap((p) => p.groups.flatMap((g) => g.fields.map((f) => [f.key, f.label]))));
const enOptions = (key: string): Record<string, string> => Object.fromEntries(enType.pages.flatMap((p) => p.groups.flatMap((g) => g.fields.filter((f) => f.key === key).flatMap((f) => ((f as unknown as { options: { value: string; label: string }[] }).options ?? []).map((o) => [o.value, o.label])))));
const en = JSON.parse(readFileSync("config/ui-strings/en.json", "utf8")) as Record<string, string>;
const tr = JSON.parse(readFileSync("config/ui-strings/tr.json", "utf8")) as Record<string, string>;

const slice = (id: string, label: string, extra: Record<string, unknown> = {}) => ({ id, label, description: "", iconKind: "none", icon: "", item: "", action: "none", conditionMode: "hidden", ...extra });

function makeProject(): string {
  const project = exampleProject();
  copyFileSync("tools/codegen-test/project/textures/bubble_frame.png", join(project, "textures", "bubble_frame.png"));
  addElement(project, "procedure", "main", { program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }] }] } });
  addElement(project, "radial_menu", "emotes", {
    title: "Emotes",
    tabs: [
      { id: "main", label: "Main", source: "list", slices: [
        slice("wave", "Wave", { description: "Waves at everyone", iconKind: "texture", icon: "textures/ruby.png", action: "command", command: "/say hi" }),
        slice("trade", "Trade", { iconKind: "item", item: "minecraft:emerald", action: "command", command: "/takas" }),
        slice("dance", "Dance"), slice("sit", "Sit"), slice("locked", "Locked", { condition: "main", conditionMode: "disabled" }),
      ] },
      { id: "images", label: "Images", source: "folder", folder: "emotes", pageSize: 6, slices: [] },
    ],
  });
  return project;
}

const CANVAS = `document.querySelector(".radialpreview canvas")`;
const picture = (app: App) => app.eval<string>(`${CANVAS}.toDataURL()`);
const layout = (app: App) => app.eval<Record<string, number>>(`JSON.parse(${CANVAS}.dataset.layout)`);
const hovered = (app: App) => app.eval<number>(`Number(${CANVAS}.dataset.hover)`);
/** Moves the mouse to `dx`, `dy` canvas pixels from the canvas's middle. */
async function hoverAt(app: App, dx: number, dy: number) {
  const r = await app.eval<{ x: number; y: number; k: number }>(`(() => { const c = ${CANVAS}.getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2, k: c.width / ${CANVAS}.width }; })()`);
  await app.mouse("mouseMoved", r.x + dx * r.k, r.y + dy * r.k, 0);
  await app.sleep(200);
}

for (const language of ["en", "tr"] as const) {
  const label = (key: string) => (language === "en" ? enLabels[key] : trTypes.fields[key].label);
  const strings = language === "en" ? en : tr;
  const typeName = language === "en" ? enType.name : trTypes.name;
  const project = makeProject();
  const app = await launchApp({ project, language, width: 1440, height: 900 });
  try {
    await app.waitFor(`document.querySelector(".tile")`);
    // New element > Radial menu opens its editor with the wheel preview.
    await app.click(".view .actions .abtn.primary");
    await app.waitFor(`document.querySelector(".addpop")`);
    await app.setValue(".addpop .popsearch input", typeName);
    await app.sleep(200);
    await app.eval(`[...document.querySelectorAll(".addpop .ptype")].find((b) => b.querySelector(".pname").textContent === ${JSON.stringify(typeName)}).click()`);
    await app.waitFor(`document.querySelector(".popform input")`);
    await app.setValue(".popform input", "quick menu");
    await app.key("Enter");
    await app.waitFor(CANVAS, 15000);
    await app.click(".abtn", strings["editor.back"]);
    await app.waitFor(`document.querySelector(".tile")`);

    // The designed menu: five slices, the cursor picks one by direction, the form changes the wheel.
    await app.click(".tile", "emotes", { double: true });
    await app.waitFor(CANVAS, 15000);
    await app.sleep(600);
    const plain = await picture(app);
    await hoverAt(app, 0, -60);
    assert((await hovered(app)) === 0, `${language}: the top slice is under the mouse (${await hovered(app)})`);
    await hoverAt(app, 60, -10);
    assert((await hovered(app)) === 1, `${language}: the right slice is under the mouse (${await hovered(app)})`);
    await hoverAt(app, 0, 0);
    assert((await hovered(app)) === -1, `${language}: no slice in the middle`);
    await hoverAt(app, 0, -60);
    const hover = await picture(app);
    assert(hover !== plain, `${language}: the hovered slice is drawn in the hover colour`);
    for (const theme of ["dark", "light"] as const) {
      await app.setTheme(theme);
      await app.sleep(400);
      await hoverAt(app, 0, -60);
      await app.shot(`${OUT}/editor-${language}-${theme}.png`);
    }
    await app.setTheme("dark");
    await app.setField(label("size"), "200");
    await app.setField(label("hole"), "50");
    await app.sleep(300);
    const resized = await layout(app);
    assert(resized.size === 200 && resized.hole === 0.5, `${language}: the wheel follows size and hole ${JSON.stringify(resized)}`);

    // The runtime folder tab shows its page of placeholder slices.
    await app.click(".radialtabs button", "Images");
    await app.sleep(300);
    await hoverAt(app, 0, -70);
    assert((await hovered(app)) === 0, `${language}: folder tab slices are picked too`);
    assert(await app.eval<boolean>(`!!document.querySelector(".radialpreview")?.textContent.includes("config/<modid>/emotes/")`), `${language}: the folder tab names its folder`);
    await app.shot(`${OUT}/editor-${language}-dark-folder.png`);

    // Q228: the opening transition. Fade + slide up over 20 ticks instead of the default pop; Replay shows the wheel mid-opening.
    const effect = (value: string) => (language === "en" ? enOptions("appear")[value] : (trTypes.fields.appear as unknown as { options: Record<string, string> }).options[value]);
    const toggleChoice = (value: string) => app.eval(`(() => { const row = [...document.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > label")?.textContent.replace("*", "").trim() === ${JSON.stringify(label("appear"))});
      [...row.querySelectorAll(".check")].find((c) => c.textContent.trim() === ${JSON.stringify(effect(value))}).querySelector("input").click(); })()`);
    await toggleChoice("scale");
    await toggleChoice("fade");
    await toggleChoice("slide_up");
    await app.setField(label("appearTicks"), "20");
    await app.sleep(300);
    const timing = await app.eval<{ appear: { effects: string[]; ticks: number } }>(`JSON.parse(${CANVAS}.dataset.layout).timing`);
    assert(JSON.stringify(timing.appear.effects) === JSON.stringify(["fade", "slide_up"]) && timing.appear.ticks === 20, `${language}: the wheel reads the opening transition ${JSON.stringify(timing)}`);
    await app.sleep(800);
    const settled = await picture(app);
    await app.click(".abtn", strings["radial.replay"]);
    await app.sleep(150);
    const opening = await picture(app);
    assert(opening !== settled, `${language}: Replay draws the wheel mid-opening (faded, lower)`);
    for (const theme of ["dark", "light"] as const) {
      await app.setTheme(theme);
      await app.click(".abtn", strings["radial.replay"]);
      await app.sleep(250);
      await app.shot(`${OUT_228}/radial-${language}-${theme}-opening.png`);
    }
    await app.setTheme("dark");

    // A procedure's "open radial menu" block lists the menus.
    await app.click(".abtn", strings["editor.back"]);
    await app.waitFor(`document.querySelector(".tile")`);
    await app.click(".tile", "main", { double: true });
    await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`);
    const list = await app.eval<string[]>(`[...document.querySelectorAll("#ref-radial_menu_element option")].map((o) => o.value)`);
    assert(list.includes("emotes") && list.includes("quick_menu"), `${language}: the radial menu list holds both menus: ${list}`);
  } finally {
    await app.close();
  }
}
console.log("PASS radial-editor");
