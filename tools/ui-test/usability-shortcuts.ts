/**
 * KUYRUK #65 (fix 5): the texture, GUI and procedure editors have a keyboard button (and the ? key) that lists
 * their shortcuts; the texture editor's old hint ("saved as you paint", missing Ctrl+S and the shape keys) is
 * gone. Runs in English and Turkish. Screenshots go to design/usability/.
 */
import { assert, exampleProject, run, type App, evidence } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = evidence("design/usability");
const project = exampleProject();
addElement(project, "gui", "shop", { type: 1, width: 176, height: 166 });
addElement(project, "procedure", "main");

const rows = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".keytable tr")].map((r) => r.textContent)`);
const openList = async (app: App, how: "button" | "key", shot?: string) => {
  if (how === "button") await app.click(".abtn.compact[aria-label='Keyboard shortcuts'], .abtn.compact[aria-label='Klavye kısayolları']");
  else {
    await app.eval(`document.activeElement?.blur()`);
    await app.eval(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true }))`);
  }
  await app.waitFor(`document.querySelector(".dialog.shortcuts")`);
  if (shot) await app.shot(shot);
  const list = await rows(app);
  await app.key("Escape");
  await app.waitFor(`!document.querySelector(".dialog.shortcuts")`);
  return list;
};
const openTile = async (app: App, name: string) => {
  await app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".tname")?.textContent === ${JSON.stringify(name)}).id = "target"`);
  await app.click("#target", undefined, { double: true });
};

for (const language of ["en", "tr"] as const) {
  const tr = language === "tr";
  await run(async (app) => {
    await app.waitFor(`document.querySelector(".tile")`);
    // Texture editor.
    await app.click(".rtab", tr ? "Kaynaklar" : "Resources");
    await app.waitFor(`document.querySelector(".texcell")`);
    await app.click(".texcell", "ruby", { double: true });
    await app.waitFor(`document.querySelector(".paintcanvas")`);
    const paint = await openList(app, "button", `${OUT}/after-shortcuts-texture-${language}.png`);
    for (const key of ["Ctrl+S", "Ctrl+Shift+S", "Shift+F", "L", "R", "O", "Y"]) assert(paint.some((r) => r.startsWith(key)), `${key} listed: ${paint}`);
    const hint = await app.eval<string>(`[...document.querySelectorAll(".paintform > .hint")].map((p) => p.textContent).join(" ")`);
    assert(!/as you paint|boyadıkça/.test(hint), `stale hint gone: ${hint}`);
    assert((await openList(app, "key")).length === paint.length, "? opens the same list");
    await app.click(".abtn", tr ? "Kaynaklara dön" : "Back to resources");

    // GUI editor.
    await app.click(".rtab", tr ? "Mod öğeleri" : "Mod elements");
    await openTile(app, "shop");
    await app.waitFor(`document.querySelector(".guistage")`);
    const gui = await openList(app, "button", `${OUT}/after-shortcuts-gui-${language}.png`);
    assert(gui.some((r) => r.startsWith("P")) && gui.some((r) => r.includes(tr ? "Shift+tık" : "Shift+click")), `gui list: ${gui}`);
    await app.click(".abtn", tr ? "Öğelere dön" : "Back to elements");

    // Procedure editor.
    await openTile(app, "main");
    await app.waitFor(`document.querySelector(".blocklyhost")?.dataset.blocks`);
    const proc = await openList(app, "button", `${OUT}/after-shortcuts-procedure-${language}.png`);
    assert(proc.some((r) => r.startsWith("Ctrl+F")) && proc.some((r) => r.includes(tr ? "Sağ tık" : "Right click")), `procedure list: ${proc}`);
    console.log(language, "rows:", paint.length, gui.length, proc.length);
  }, { project, language });
}
