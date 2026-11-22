/**
 * Q278: captures the real app shell (menu bar, nav rail, status bar; en and tr) and the rendered GUI stage of a big
 * GUI from a copy of ETREconomy-MCEdge, as input for the static mockups in design/278/mockups/. Hidden window.
 *   ETRC=<copy of the project> node tools/ui-test/capture-q278-shell.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { launchApp, REPO } from "./cdp.ts";

const OUT = `${REPO}/design/278/mockups/assets`;
mkdirSync(OUT, { recursive: true });
const shell: Record<string, Record<string, string>> = {};
for (const lang of ["en", "tr"] as const) {
  const app = await launchApp({ project: process.env.ETRC!, language: lang, width: 1440, height: 900 });
  try {
    await app.eval(`(() => { const f = [...document.querySelectorAll(".foldertile")].find((e) => /guis/i.test(e.textContent)); f?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); })()`);
    await app.sleep(500);
    await app.eval(`(() => { const t = [...document.querySelectorAll(".tile:not(.foldertile)")].find((e) => /vending/i.test(e.textContent)); t?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); })()`);
    await app.waitFor(`document.querySelector(".guistage")`, 20000);
    await app.sleep(1200);
    shell[lang] = await app.eval<Record<string, string>>(`(() => {
      const strip = (e) => e.outerHTML;
      const rail = document.querySelector("nav.rail").cloneNode(true);
      return { menubar: strip(document.querySelector("header.menubar")), rail: strip(rail), status: strip(document.querySelector("footer.status")),
        railTitles: [...rail.querySelectorAll(".rlabel")].map((e) => e.textContent), edtab: document.querySelector(".edtabs") ? document.querySelector(".edtabs").outerHTML : "" };
    })()`);
    if (lang === "en") {
      const r = await app.rect(".guistage");
      const { data } = await app.cdp("Page.captureScreenshot", { format: "png", clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } });
      writeFileSync(`${OUT}/gui-stage.png`, Buffer.from(data, "base64"));
      console.log("stage", r.width, r.height);
    }
  } finally {
    await app.close();
  }
}
writeFileSync(`${OUT}/shell.json`, JSON.stringify(shell, null, 1));
console.log("shell captured", Object.keys(shell));
