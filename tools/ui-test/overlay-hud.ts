/**
 * KUYRUK 169: the overlay editor draws the game's HUD (hotbar, XP bar, health, armor, hunger, crosshair) where
 * vanilla's Gui puts it on the 427 x 240 overlay screen, under the widgets: a widget over the hotbar is still picked
 * by a click. The Game HUD box in the side panel turns it off, and the app remembers that when the editor opens again.
 * BEFORE=1 only takes the before screenshot. Screenshots go to design/169/ (en and tr, dark and light).
 */
import { assert, exampleProject, run, type App, evidence, textOf } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/169");
const project = exampleProject();
addElement(project, "overlay", "moneyhud", {
  components: [
    { kind: "label", x: 6, y: 6, text: "Money: 100" },
    { kind: "label", x: 230, y: 186, text: "Over hunger" },
  ],
});

/** Colour of one GUI pixel of the HUD canvas, as [r, g, b, a]. */
const pixel = (app: App, x: number, y: number) => app.eval<number[]>(`[...document.querySelector(".ghud").getContext("2d").getImageData(${x}, ${y}, 1, 1).data]`);
const openEditor = async (app: App) => {
  await app.click(".tile", "moneyhud", { double: true });
  await app.waitFor(`document.querySelector(".guistage.overlay")`);
  await app.sleep(400);
};

for (const language of ["en", "tr"]) {
  await run(async (app) => {
    await app.waitFor(`document.querySelector(".tile")`, 60000);
    await openEditor(app);
    if (process.env.BEFORE) {
      await app.shot(`${OUT}/before-${language}-dark.png`);
      return;
    }
    await app.waitFor(`document.querySelector(".guistage .ghud")`);
    const size = await app.eval<number[]>(`(() => { const c = document.querySelector(".ghud"); const s = document.querySelector(".guistage").getBoundingClientRect(), r = c.getBoundingClientRect(); return [c.width, c.height, Math.round(r.width - s.width), Math.round(r.height - s.height)]; })()`);
    assert(size.join() === "427,240,0,0", `HUD canvas is the 427 x 240 screen, scaled with the stage: ${size}`);
    // Vanilla places, for w = 427, h = 240 (left = 213 - 91 = 122): hotbar 122..303 x 218..239, hearts from (122, 201),
    // armor from (122, 191), hunger rightmost at (295, 201), crosshair box at (206, 112).
    const hotbar = await pixel(app, 150, 230), outside = await pixel(app, 20, 230);
    assert(hotbar[3] > 0 && outside[3] === 0, `hotbar at the bottom middle only: ${hotbar} / ${outside}`);
    const heart = await pixel(app, 122 + 3, 201 + 3), hunger = await pixel(app, 295 + 5, 201 + 2), armor = await pixel(app, 122 + 3, 191 + 3);
    assert(heart[0] > 150 && heart[1] < 80, `first heart is red: ${heart}`);
    assert(hunger[0] > 120 && hunger[2] < 80 && hunger[3] === 255, `last drumstick is brown: ${hunger}`);
    assert(armor[0] > 150 && armor[1] > 150 && armor[2] > 150, `first armor icon is light grey: ${armor}`);
    const cross = await pixel(app, 206 + 7, 112 + 7);
    assert(cross[0] > 200 && cross[3] > 150, `crosshair in the middle: ${cross}`);

    // Widgets stay on top and pickable over the HUD.
    await app.click(".gwidget", "Over hunger");
    await app.waitFor(`(() => { const e = document.querySelector(".gwidget.sel"); return !!e && ${textOf("e")}.includes("Over hunger"); })()`);
    await app.key("Escape");
    await app.shot(`${OUT}/after-${language}-dark.png`);
    await app.setTheme("light");
    await app.sleep(400);
    await app.shot(`${OUT}/after-${language}-light.png`);
    await app.setTheme("dark");

    if (language !== "en") return;
    // The box turns it off; the editor opened again remembers.
    await app.click(".hudctl input");
    await app.waitFor(`!document.querySelector(".ghud")`);
    await app.shot(`${OUT}/after-off-en-dark.png`);
    await app.key("w", 2);
    await app.waitFor(`!document.querySelector(".guistage")`);
    await openEditor(app);
    assert(await app.eval<boolean>(`!document.querySelector(".ghud") && !document.querySelector(".hudctl input").checked`), "stays off when opened again");
    await app.click(".hudctl input");
    await app.waitFor(`document.querySelector(".ghud")`);
  }, { project, language, width: 1440, height: 900 });
}
