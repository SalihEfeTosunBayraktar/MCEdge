/**
 * Q216: a bubble is designed in the app like a small overlay. New element > Bubble creates one; its editor shows a live
 * canvas (the bubble above a player head) that follows the form: icon, caption and a 9-slice background change the
 * picture, dragging the icon on the canvas switches it to the free position. The element is saved, reopens with its
 * values, and a procedure's "show bubble" block picks it from the bubble list. English and Turkish, dark and light;
 * screenshots go to design/216/. Q228: the show / hide timing fields and the preview's timeline (appear | hold |
 * disappear, Play, scrub, loop) follow the shared transition rule; screenshots mid-appear and mid-disappear go to
 * design/228/. usage: node tools/ui-test/bubble-editor.ts (after npm run build:app)
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, launchApp, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";
import { timelineAt, timelineLengths, timingOf } from "../../src/elements/transitions.ts";

const OUT = evidence("design/216");
const OUT_223 = evidence("design/223");
const OUT_228 = evidence("design/228");
mkdirSync(OUT_228, { recursive: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(OUT_223, { recursive: true });
const trTypes = JSON.parse(readFileSync("config/element-types/tr.json", "utf8")).bubble as { name: string; fields: Record<string, { label: string }> };
const enType = JSON.parse(readFileSync("element-types/bubble/type.json", "utf8")) as { name: string; pages: { groups: { fields: { key: string; label: string }[] }[] }[] };
const enOptions = (key: string): Record<string, string> => Object.fromEntries(enType.pages.flatMap((p) => p.groups.flatMap((g) => g.fields.filter((f) => f.key === key).flatMap((f) => ((f as unknown as { options: { value: string; label: string }[] }).options ?? []).map((o) => [o.value, o.label])))));
const enLabels = Object.fromEntries(enType.pages.flatMap((p) => p.groups.flatMap((g) => g.fields.map((f) => [f.key, f.label]))));

function makeProject(): string {
  const project = exampleProject();
  copyFileSync("tools/codegen-test/project/textures/bubble_frame.png", join(project, "textures", "bubble_frame.png"));
  addElement(project, "procedure", "main", { program: { format: 1, variables: [], stacks: [{ x: 40, y: 40, blocks: [{ block: "start" }] }] } });
  return project;
}

const CANVAS = `document.querySelector(".bubblepreview canvas")`;
const picture = (app: App) => app.eval<string>(`${CANVAS}.toDataURL()`);
interface Boxes { frame: { top: number; bottom: number }; tag: { top: number; bottom: number } | null; headTop: number; liftBlocks: number }
const boxes = (app: App) => app.eval<Boxes>(`JSON.parse(${CANVAS}.dataset.boxes)`);
const layout = (app: App) => app.eval<Record<string, number>>(`JSON.parse(${CANVAS}.dataset.layout)`);
const saved = (project: string) => JSON.parse(readFileSync(join(project, "elements", "bubbles", "trade_offer.json"), "utf8")) as Record<string, unknown>;
const WS = `document.querySelector(".blocklyhost").blocklyWorkspace`;
const en = JSON.parse(readFileSync("config/ui-strings/en.json", "utf8")) as Record<string, string>;
const tr = JSON.parse(readFileSync("config/ui-strings/tr.json", "utf8")) as Record<string, string>;
/** A drag with pauses, as Blockly and the canvas need to see the mouse move. */
const slowDrag = async (app: App, from: [number, number], to: [number, number]) => {
  await app.mouse("mouseMoved", from[0], from[1], 0);
  await app.mouse("mousePressed", from[0], from[1]);
  for (let i = 1; i <= 20; i++) (await app.mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / 20, from[1] + ((to[1] - from[1]) * i) / 20, 1), await app.sleep(15));
  await app.mouse("mouseReleased", to[0], to[1], 0);
  await app.sleep(400);
};

/** Picks a texture in the texture picker of the field labelled `label`. */
async function pickTexture(app: App, label: string, path: string) {
  await app.eval(`[...document.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > label")?.textContent.replace("*", "").trim() === ${JSON.stringify(label)}).querySelector(".texpicked").click()`);
  await app.waitFor(`document.querySelector('.texpop .texcell[title=${JSON.stringify(path)}]')`);
  await app.eval(`document.querySelector('.texpop .texcell[title=${JSON.stringify(path)}]').click()`);
  await app.sleep(300);
}

/** Waits until the saved element has `key` = `value` (the editor saves on its own). */
async function waitSaved(app: App, project: string, key: string, value: unknown) {
  for (let i = 0; i < 50 && JSON.stringify(saved(project)[key]) !== JSON.stringify(value); i++) await app.sleep(100);
  assert(JSON.stringify(saved(project)[key]) === JSON.stringify(value), `saved ${key} = ${JSON.stringify(saved(project)[key])}, expected ${JSON.stringify(value)}`);
}

for (const language of ["en", "tr"] as const) {
  const label = (key: string) => (language === "en" ? enLabels[key] : trTypes.fields[key].label);
  const typeName = language === "en" ? enType.name : trTypes.name;
  const project = makeProject();
  const app = await launchApp({ project, language, width: 1440, height: 900 });
  try {
    await app.waitFor(`document.querySelector(".tile")`);
    // New element > Bubble.
    await app.click(".view .actions .abtn.primary");
    await app.waitFor(`document.querySelector(".addpop")`);
    await app.setValue(".addpop .popsearch input", typeName);
    await app.sleep(200);
    assert(await app.eval<boolean>(`!![...document.querySelectorAll(".addpop .ptype")].find((b) => b.querySelector(".pname").textContent === ${JSON.stringify(typeName)} && !b.disabled)`), `${language}: ${typeName} is in New element`);
    await app.eval(`[...document.querySelectorAll(".addpop .ptype")].find((b) => b.querySelector(".pname").textContent === ${JSON.stringify(typeName)}).click()`);
    await app.waitFor(`document.querySelector(".popform input")`);
    await app.setValue(".popform input", "trade offer");
    await app.key("Enter");
    await app.waitFor(`document.querySelector(".bubblepreview canvas")`, 15000);
    await app.sleep(400);

    // The canvas follows the form: the built-in bubble first, then the icon, the caption and a 9-slice frame.
    const empty = await picture(app);
    await pickTexture(app, label("icon"), "textures/ruby.png");
    const withIcon = await picture(app);
    assert(withIcon !== empty, `${language}: picking an icon redraws the canvas`);
    await app.setField(label("caption"), "Trade: {text}");
    await app.sleep(300);
    assert(await picture(app) !== withIcon, `${language}: the caption shows on the canvas`);
    await pickTexture(app, label("background"), "textures/bubble_frame.png");
    await app.setField(label("backgroundMode"), "1"); // option index: 9-slice
    await app.setField(label("width"), "48");
    await app.sleep(300);
    const sliced = await layout(app);
    assert(sliced.slice === 4 && sliced.width === 48 && sliced.iconX === 14, `${language}: 9-slice layout ${JSON.stringify(sliced)}`);

    // Q223: with the name tag the frame sits on the tag's box (the game's OVER_NAME lift), without it just over the head.
    const tagOn = `document.querySelector(".bubblepreview .check input")`;
    assert(await app.eval<boolean>(`${tagOn}.checked`), `${language}: name tag is on by default`);
    await app.sleep(600); // the show animation settles
    const withTag = await boxes(app);
    assert(withTag.tag !== null, `${language}: the name tag box is drawn`);
    assert(withTag.tag!.top >= withTag.frame.bottom - 0.01, `${language}: name tag box (top ${withTag.tag!.top}) does not overlap the frame (bottom ${withTag.frame.bottom})`);
    assert(Math.abs(withTag.liftBlocks - 0.525) < 0.01, `${language}: lift with the tag ${withTag.liftBlocks}`);
    for (const theme of ["dark", "light"] as const) {
      await app.setTheme(theme);
      await app.sleep(400);
      await app.shot(`${OUT_223}/editor-${language}-${theme}-tag-on.png`);
    }
    await app.setTheme("dark");
    await app.click(".bubblepreview .check input");
    await app.sleep(700);
    const noTag = await boxes(app);
    assert(noTag.tag === null, `${language}: no name tag box when off`);
    assert(Math.abs(noTag.liftBlocks - 0.05) < 0.01, `${language}: lift without the tag ${noTag.liftBlocks}`);
    assert(noTag.headTop - noTag.frame.bottom < withTag.headTop - withTag.frame.bottom || noTag.liftBlocks < withTag.liftBlocks, `${language}: bubble sits lower with the tag off`);
    for (const theme of ["dark", "light"] as const) {
      await app.setTheme(theme);
      await app.sleep(400);
      await app.shot(`${OUT_223}/editor-${language}-${theme}-tag-off.png`);
    }
    await app.setTheme("dark");
    await app.click(".bubblepreview .check input");
    await app.sleep(500);

    // Dragging the icon on the canvas places it freely.
    const r = await app.eval<{ x: number; y: number; k: number }>(`(() => { const c = ${CANVAS}.getBoundingClientRect(); return { x: c.x, y: c.y, k: c.width / ${CANVAS}.width }; })()`);
    const before = await layout(app);
    // The icon's middle on the canvas: the average of the ruby red pixels it draws.
    const middle = await app.eval<[number, number]>(`(() => {
      const c = ${CANVAS}, g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height).data;
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] > 150 && d[i + 1] < 80 && d[i + 2] < 110) (sx += x, sy += y, n++);
      }
      return n ? [sx / n, sy / n] : [c.width / 2, c.height / 2];
    })()`);
    const from: [number, number] = [r.x + middle[0] * r.k, r.y + middle[1] * r.k];
    await slowDrag(app, from, [from[0] + 24, from[1] + 12]);
    await app.sleep(300);
    const dragged = await layout(app);
    assert(dragged.iconX > before.iconX && dragged.iconY > before.iconY, `${language}: dragging moved the icon ${JSON.stringify(before)} -> ${JSON.stringify(dragged)}`);
    await waitSaved(app, project, "layout", "free");
    await waitSaved(app, project, "caption", "Trade: {text}");
    await waitSaved(app, project, "backgroundMode", "nine_slice");
    await waitSaved(app, project, "icon", "textures/ruby.png");
    const iconX = saved(project).iconX;
    for (const theme of ["dark", "light"] as const) {
      await app.setTheme(theme);
      await app.sleep(500);
      await app.shot(`${OUT}/editor-${language}-${theme}.png`);
    }
    await app.setTheme("dark");

    // Q228: appear with fade + slide up, 10 ticks; active 30 ticks; disappear 10 ticks. The timeline shows appear | hold | disappear.
    const effect = (key: string, value: string) => (language === "en" ? enOptions(key)[value] : (trTypes.fields[key] as unknown as { options: Record<string, string> }).options[value]);
    const toggleChoice = (key: string, value: string) => app.eval(`(() => { const row = [...document.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > label")?.textContent.replace("*", "").trim() === ${JSON.stringify(label(key))});
      const box = [...row.querySelectorAll(".check")].find((c) => c.textContent.trim() === ${JSON.stringify(effect(key, value))}).querySelector("input"); box.click(); })()`);
    await toggleChoice("appear", "scale");
    await toggleChoice("appear", "fade");
    await toggleChoice("appear", "slide_up");
    await app.setField(label("appearTicks"), "10");
    await app.setField(label("disappearTicks"), "10");
    await app.setField(label("duration"), "30");
    await waitSaved(app, project, "appear", ["fade", "slide_up"]);
    await waitSaved(app, project, "duration", 30);
    const TIMELINE = `document.querySelector('[data-testid="bubble-timeline"]')`;
    const lengths = await app.eval<Record<string, number>>(`JSON.parse(${TIMELINE}.dataset.lengths)`);
    assert(JSON.stringify(lengths) === JSON.stringify({ appear: 10, hold: 20, disappear: 10, total: 40 }), `${language}: timeline lengths ${JSON.stringify(lengths)}`);
    assert(await app.eval<boolean>(`${TIMELINE}.dataset.phase === "idle"`), `${language}: the timeline rests until played`);
    const timing = timingOf({ appear: ["fade", "slide_up"], appearTicks: 10, appearEasing: "back", disappear: ["scale"], disappearTicks: 10, disappearEasing: "back", duration: 30 });
    assert(JSON.stringify(timelineLengths(timing)) === JSON.stringify(lengths), `${language}: the editor and the model agree on the lengths`);
    const scrub = async (age: number) => {
      await app.eval(`(() => { const e = document.querySelector('[data-testid="bubble-scrub"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${age}); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await app.sleep(250);
      return app.eval<{ alpha: number; scale: number; offset: number; phase: string }>(`JSON.parse(${CANVAS}.dataset.state)`);
    };
    const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
    const pictures: Record<string, string> = {};
    for (const [age, phase] of [[0, "appear"], [4, "appear"], [15, "hold"], [34, "disappear"], [38, "disappear"], [40, "gone"]] as const) {
      const state = await scrub(age);
      const expected = timelineAt(timing, age);
      assert(state.phase === phase && expected.phase === phase, `${language}: tick ${age} is in ${phase}, the canvas says ${state.phase}`);
      assert(near(state.alpha, expected.state.alpha) && near(state.scale, expected.state.scale) && near(state.offset, expected.state.offset), `${language}: tick ${age} ${JSON.stringify(state)} follows the shared rule ${JSON.stringify(expected.state)}`);
      pictures[age] = await picture(app);
    }
    const early = await scrub(2);
    assert(early.alpha < 1 && early.offset < 0, `${language}: mid-appear is faded and still below its place`);
    assert(pictures[0] !== pictures[15] && pictures[15] !== pictures[34] && pictures[15] !== pictures[40], `${language}: appear, hold and disappear look different`);
    assert(await app.eval<boolean>(`${TIMELINE}.dataset.phase === "disappear" || ${TIMELINE}.dataset.phase === "appear"`), `${language}: the timeline follows the scrubber`);
    for (const [age, name] of [[2, "appear"], [34, "disappear"]] as const) {
      await scrub(age);
      for (const theme of ["dark", "light"] as const) {
        await app.setTheme(theme);
        await app.sleep(400);
        await app.shot(`${OUT_228}/editor-${language}-${theme}-${name}.png`);
      }
    }
    await app.setTheme("dark");
    // Play runs the timeline once and rests; Loop keeps it going.
    await app.eval(`document.querySelector('[data-testid="bubble-play"]').click()`);
    await app.sleep(300);
    assert(await app.eval<boolean>(`${TIMELINE}.dataset.phase !== "idle"`), `${language}: Play starts the timeline`);
    await app.waitFor(`${TIMELINE}.dataset.phase === "idle"`, 6000);
    await app.eval(`document.querySelector('[data-testid="bubble-loop"]').click()`);
    await app.eval(`document.querySelector('[data-testid="bubble-play"]').click()`);
    await app.sleep(2600); // longer than the 40 tick timeline: it has restarted, not rested
    assert(await app.eval<boolean>(`${TIMELINE}.dataset.phase !== "idle"`), `${language}: Loop keeps playing past the end`);
    await app.eval(`document.querySelector('[data-testid="bubble-loop"]').click()`);
    await app.waitFor(`${TIMELINE}.dataset.phase === "idle"`, 6000);
    await app.shot(`${OUT_228}/editor-${language}-dark-idle.png`);

    // Reopen: the values come back.
    await app.click(".abtn", (language === "en" ? en : tr)["editor.back"]);
    await app.waitFor(`document.querySelector(".tile")`);
    await app.click(".tile", "trade offer", { double: true });
    await app.waitFor(`document.querySelector(".bubblepreview canvas")`, 15000);
    await app.sleep(300);
    const reopened = await layout(app);
    assert(reopened.iconX === iconX && reopened.slice === 4 && reopened.width === 48, `${language}: reopened with its values ${JSON.stringify(reopened)}`);

    // A procedure's show bubble block picks it.
    await app.click(".abtn", (language === "en" ? en : tr)["editor.back"]);
    await app.waitFor(`document.querySelector(".tile")`);
    await app.click(".tile", "main", { double: true });
    await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`);
    const list = await app.eval<string[]>(`[...document.querySelectorAll("#ref-bubble_element option")].map((o) => o.value)`);
    assert(list.includes("trade_offer"), `${language}: the bubble list holds trade_offer: ${list}`);
    await app.click(".blocklyToolboxCategory", language === "en" ? "Bubbles" : "Baloncuklar");
    await app.sleep(400);
    const types = await app.eval<string[]>(`${WS}.getToolbox().getFlyout().getWorkspace().getTopBlocks(true).map((b) => b.type)`);
    assert(types[0] === "bubble_show", `${language}: show bubble leads the Bubbles category: ${types}`);
    const fromBlock = await app.eval<[number, number]>(`(() => { const b = ${WS}.getToolbox().getFlyout().getWorkspace().getTopBlocks(true).find((b) => b.type === "bubble_show"); const r = b.getSvgRoot().getBoundingClientRect(); return [r.x + 20, r.y + 8]; })()`);
    const to = await app.eval<[number, number]>(`(() => { const b = ${WS}.getTopBlocks(false).find((b) => b.type === "start"); const r = b.getSvgRoot().getBoundingClientRect(); return [r.x + 40, r.bottom + 14]; })()`);
    await slowDrag(app, fromBlock, to);
    await app.sleep(400);
    await app.eval(`${WS}.getTopBlocks(false).find((b) => b.type === "start").getNextBlock().getField("bubble").setValue("trade_offer")`);
    const chain = await app.eval<string>(`(() => { const b = ${WS}.getTopBlocks(false).find((b) => b.type === "start").getNextBlock(); return b ? b.type + ":" + b.getFieldValue("bubble") : ""; })()`);
    assert(chain === "bubble_show:trade_offer", `${language}: the block shows trade_offer: ${chain}`);
    let program = "";
    for (let i = 0; i < 50 && !program.includes("trade_offer"); i++) (await app.sleep(100), (program = readFileSync(join(project, "elements", "procedures", "main.json"), "utf8")));
    assert(/"block": "bubble_show"/.test(program) && program.includes("trade_offer"), `${language}: the procedure is saved with the block`);
    for (const theme of ["dark", "light"] as const) {
      await app.setTheme(theme);
      await app.sleep(500);
      await app.shot(`${OUT}/procedure-${language}-${theme}.png`);
    }
  } finally {
    await app.close();
  }
}
console.log("PASS bubble-editor");
