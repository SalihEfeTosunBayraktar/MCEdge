/**
 * Q225, Q226: a block's Seat page. Turning Seatable on shows the block in 3D with a sitting player on every seat; the automatic
 * sit height reads the boxes (a slab-high box gives 0.5 blocks), a manual height overrides it; Spread with 2 seats shows
 * two figures; a click on the top surface adds a seat, dragging a seat moves it, dragging its arrow and R turn it, Delete
 * removes it; the form's seat rows hold the same values; the element is saved and reopens with them. A seat set to lie
 * shows a lying figure. On the Bounding boxes page, Spans several blocks with a box reaching x 32 outlines two cells
 * (and the Seat page shows them too). English and Turkish, dark and light; screenshots go to design/225/ and design/226/. usage: node tools/ui-test/seat-editor.ts (after npm run build:app)
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, exampleProject, launchApp, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/225";
const OUT_MULTI = "design/226";
mkdirSync(OUT, { recursive: true });
mkdirSync(OUT_MULTI, { recursive: true });
const enType = JSON.parse(readFileSync("element-types/block/type.json", "utf8")) as { pages: { id: string; title: string; groups: { fields: { key: string; label: string; fields?: { key: string; label: string }[] }[] }[] }[] };
const trType = JSON.parse(readFileSync("config/element-types/tr.json", "utf8")).block as { pages: Record<string, string>; fields: Record<string, { label: string }> };
const seatPage = enType.pages.find((p) => p.id === "seat")!;
const boxesPage = enType.pages.find((p) => p.id === "bounding_boxes")!;
const enLabels = Object.fromEntries([seatPage, boxesPage].flatMap((p) => p.groups).flatMap((g) => g.fields.flatMap((f) => [[f.key, f.label], ...(f.fields ?? []).map((s) => [`${f.key}.${s.key}`, s.label])])));
const ui = { en: JSON.parse(readFileSync("config/ui-strings/en.json", "utf8")), tr: JSON.parse(readFileSync("config/ui-strings/tr.json", "utf8")) } as Record<string, Record<string, string>>;

interface Seat { x: number; y: number; z: number; yaw: number; pose?: string }
const HOST = `document.querySelector(".seatcanvas")`;
const shown = (app: App) => app.eval<Seat[]>(`JSON.parse(${HOST}.dataset.seats)`);
const figures = (app: App) => app.eval<number>(`Number(${HOST}.dataset.figures)`);
const lying = (app: App) => app.eval<number>(`Number(${HOST}.dataset.lying)`);
const cells = (app: App) => app.eval<number[][]>(`JSON.parse(${HOST}.dataset.cells)`);
const project3 = (app: App, x: number, y: number, z: number) => app.eval<{ x: number; y: number }>(`${HOST}.seatStage.project(${x}, ${y}, ${z})`);
const pick = (app: App, p: { x: number; y: number }) => app.eval<string>(`${HOST}.seatStage.pick(${p.x}, ${p.y})`);
const stored = (project: string) => JSON.parse(readFileSync(join(project, "elements", "blocks", "ruby_bench.json"), "utf8")) as Record<string, unknown>;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Waits until the saved element's seats satisfy `check` (the editor saves on its own). */
async function waitSaved(app: App, project: string, what: string, check: (seats: Seat[]) => boolean) {
  for (let i = 0; i < 60 && !check((stored(project).seats ?? []) as Seat[]); i++) await app.sleep(100);
  assert(check((stored(project).seats ?? []) as Seat[]), `saved ${what}: ${JSON.stringify(stored(project).seats)}`);
}

/** A drag with pauses so the canvas sees every move. */
async function slowDrag(app: App, from: { x: number; y: number }, to: { x: number; y: number }) {
  await app.mouse("mouseMoved", from.x, from.y, 0);
  await app.mouse("mousePressed", from.x, from.y, 1);
  for (let i = 1; i <= 15; i++) (await app.mouse("mouseMoved", from.x + ((to.x - from.x) * i) / 15, from.y + ((to.y - from.y) * i) / 15, 1), await app.sleep(20));
  await app.mouse("mouseReleased", to.x, to.y, 0);
  await app.sleep(300);
}

async function openBench(app: App, page: string) {
  await app.waitFor(`document.querySelector(".tile")`);
  await app.click(".tile", "Ruby Bench", { double: true });
  await app.waitFor(`document.querySelector(".edname")?.textContent === "Ruby Bench"`);
  await app.click(".pagetabs .ltab", page);
  await app.sleep(300);
}

for (const language of ["en", "tr"] as const) {
  const label = (key: string) => (language === "en" ? enLabels[key] : trType.fields[key].label);
  const page = language === "en" ? seatPage.title : trType.pages.seat;
  const boxes = language === "en" ? boxesPage.title : trType.pages.bounding_boxes;
  const tick = (key: string) => app.eval(`[...document.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > label")?.textContent.replace("*", "").trim() === ${JSON.stringify(label(key))}).querySelector("input[type=checkbox]").click()`);
  const project = exampleProject();
  addElement(project, "block", "ruby_bench", { name: "Ruby Bench", texture: "textures/ruby_block.png", boundingBoxes: [{ mx: 0, my: 0, mz: 0, Mx: 16, My: 8, Mz: 16, subtract: false }] });
  const app = await launchApp({ project, language, width: 1440, height: 900 });
  try {
    await openBench(app, page);
    // Seatable on: the preview replaces the texture preview.
    await app.eval(`[...document.querySelectorAll(".frow")].find((r) => r.querySelector(":scope > label")?.textContent.replace("*", "").trim() === ${JSON.stringify(label("seatable"))}).querySelector("input[type=checkbox]").click()`);
    await app.waitFor(`document.querySelector(".seatcanvas canvas")`, 15000);
    await app.sleep(800);

    // Automatic height: the one seat sits on the slab-high box, 0.5 blocks.
    let seats = await shown(app);
    assert(seats.length === 1 && near(seats[0].y / 16, 0.5), `${language}: auto height from the slab box ${JSON.stringify(seats)}`);
    assert(await figures(app) === 1, `${language}: one figure`);
    assert(await app.eval<boolean>(`document.querySelector(".seatlist li").textContent.includes("0.5")`), `${language}: the seat list says 0.5`);

    // Manual height: the seat's own Y (12 px = 0.75 blocks) is used; back to automatic gives 0.5 again.
    await app.setField(label("seatHeightMode"), "1");
    await app.waitFor(`[...document.querySelectorAll(".frow")].some((r) => r.querySelector(":scope > label")?.textContent.trim() === ${JSON.stringify(label("seats.y"))})`);
    await app.setField(label("seats.y"), "12");
    await app.sleep(300);
    seats = await shown(app);
    assert(near(seats[0].y / 16, 0.75), `${language}: manual height 0.75 ${JSON.stringify(seats)}`);
    await app.setField(label("seatHeightMode"), "0");
    await app.sleep(300);
    assert(near((await shown(app))[0].y / 16, 0.5), `${language}: automatic again`);

    // Two seats spread along the block: two figures.
    await app.setValue(".seatpreview input[type=number]", "2");
    await app.click(".seatspread");
    await app.sleep(400);
    seats = await shown(app);
    assert(seats.length === 2 && seats[0].x === 4 && seats[1].x === 12 && seats.every((s) => s.z === 8 && near(s.y, 8)), `${language}: spread ${JSON.stringify(seats)}`);
    assert(await figures(app) === 2, `${language}: two figures`);
    await waitSaved(app, project, "two spread seats", (s) => s.length === 2);

    // A click on the top surface adds a seat there (a corner nothing covers on screen).
    const corners: [number, number][] = [[2, 14], [14, 14], [2, 2], [14, 2], [1, 15]];
    let added: [number, number] | undefined;
    for (const [x, z] of corners) {
      const p = await project3(app, x, 8, z);
      if (await pick(app, p) !== "surface") continue;
      await app.mouse("mouseMoved", p.x, p.y, 0);
      await app.mouse("mousePressed", p.x, p.y, 1);
      await app.mouse("mouseReleased", p.x, p.y, 0);
      added = [x, z];
      break;
    }
    assert(added, `${language}: a free top surface point on screen`);
    await app.sleep(400);
    seats = await shown(app);
    assert(seats.length === 3 && near(seats[2].x, added![0]) && near(seats[2].z, added![1]) && near(seats[2].y, 8), `${language}: click added ${JSON.stringify(seats[2])} at ${added}`);

    // Dragging the new seat's marker moves it (whole pixels).
    const target: [number, number] = [added![0] < 8 ? 5 : 11, added![1] < 8 ? 4 : 12];
    const from = await project3(app, seats[2].x, 8, seats[2].z);
    assert(await pick(app, from) === "marker", `${language}: the new seat's marker is grabbable (${await pick(app, from)})`);
    await slowDrag(app, from, await project3(app, target[0], 8, target[1]));
    seats = await shown(app);
    assert(seats[2].x === target[0] && seats[2].z === target[1], `${language}: dragged to ${target}: ${JSON.stringify(seats[2])}`);

    // Dragging its arrow tip to the east turns it to 90; R turns it on to 180.
    const tip = await project3(app, target[0], 8.1, target[1] - 7);
    assert(await pick(app, tip) === "handle", `${language}: the arrow tip is grabbable (${await pick(app, tip)})`);
    await slowDrag(app, tip, await project3(app, target[0] + 8, 8, target[1]));
    assert((await shown(app))[2].yaw === 90, `${language}: turned to 90 ${JSON.stringify((await shown(app))[2])}`);
    await app.eval(`${HOST}.focus()`);
    await app.key("r");
    await app.sleep(300);
    assert((await shown(app))[2].yaw === 180, `${language}: R turned to 180 ${JSON.stringify((await shown(app))[2])}`);

    // The form's third seat row holds the same values.
    await app.click(".listrows .lrow", "3");
    await app.sleep(200);
    const row = await app.eval<string[]>(`["x", "z", "yaw"].map((k) => document.querySelector('.frow[data-field="seats[2].' + k + '"] input').value)`);
    assert(row.join(",") === `${target[0]},${target[1]},180`, `${language}: form row ${row}`);

    // Delete removes the selected seat: select the first by its list line, then Delete.
    await app.click(".seatlist li");
    await app.eval(`${HOST}.focus()`);
    await app.key("Delete");
    await app.sleep(300);
    seats = await shown(app);
    assert(seats.length === 2 && seats[0].x === 12, `${language}: deleted the first seat ${JSON.stringify(seats)}`);
    const expected = (s: Seat[]) => s.length === 2 && s[0].x === 12 && s[0].z === 8 && s[1].x === target[0] && s[1].z === target[1] && s[1].yaw === 180;
    await waitSaved(app, project, "after editing", expected);
    assert(stored(project).seatable === true, `${language}: seatable saved`);

    for (const theme of ["dark", "light"] as const) {
      await app.setTheme(theme);
      await app.sleep(500);
      await app.shot(`${OUT}/editor-${language}-${theme}.png`);
    }
    await app.setTheme("dark");

    // Reopen: the seats come back.
    await app.click(".abtn", ui[language]["editor.back"]);
    await openBench(app, page);
    await app.waitFor(`document.querySelector(".seatcanvas canvas")`, 15000);
    await app.sleep(500);
    assert(expected(await shown(app)), `${language}: reopened ${JSON.stringify(await shown(app))}`);
    assert(await figures(app) === 2, `${language}: two figures after reopening`);

    // Lying: the second seat lies down; its figure lies, and it is saved.
    await app.click(".listrows .lrow", "2");
    await app.sleep(200);
    await app.setField(label("seats.pose"), "1");
    await app.sleep(400);
    assert(await lying(app) === 1 && await figures(app) === 2, `${language}: one lying figure (${await lying(app)})`);
    await waitSaved(app, project, "a lying seat", (s) => s.length === 2 && s[1].pose === "lie" && s[0].pose !== "lie");

    // Multi-block: Spans several blocks, then the box reaching x 32 covers two cells, outlined over the model.
    await app.click(".pagetabs .ltab", boxes);
    await app.sleep(300);
    await tick("multiBlock");
    await app.waitFor(`document.querySelector(".seatcanvas canvas")`, 15000);
    await app.setField(label("boundingBoxes.Mx"), "32");
    await app.sleep(500);
    assert(JSON.stringify(await cells(app)) === "[[0,0,0],[1,0,0]]", `${language}: two cells ${JSON.stringify(await cells(app))}`);
    for (let i = 0; i < 60 && stored(project).multiBlock !== true; i++) await app.sleep(100);
    assert(stored(project).multiBlock === true, `${language}: multiBlock saved`);
    for (const theme of ["dark", "light"] as const) {
      await app.setTheme(theme);
      await app.sleep(500);
      await app.shot(`${OUT_MULTI}/cells-${language}-${theme}.png`);
    }
    // The Seat page shows the cells with the seats.
    await app.click(".pagetabs .ltab", page);
    await app.waitFor(`document.querySelector(".seatcanvas canvas")`, 15000);
    await app.sleep(500);
    assert(JSON.stringify(await cells(app)) === "[[0,0,0],[1,0,0]]" && await lying(app) === 1, `${language}: seat page cells and lying figure`);
    for (const theme of ["dark", "light"] as const) {
      await app.setTheme(theme);
      await app.sleep(500);
      await app.shot(`${OUT_MULTI}/seats-${language}-${theme}.png`);
    }
    await app.setTheme("dark");
    console.log(`PASS ${language}`);
  } finally {
    await app.close();
  }
}
console.log("PASS seat-editor");
