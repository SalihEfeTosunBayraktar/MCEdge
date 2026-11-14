/**
 * KUYRUK #72: element forms in Turkish. With the app in Turkish the New element popup, the type name and
 * description, group titles, field labels, help and select options of the Procedure and Block forms read
 * Turkish; in English the type.json text is shown. Screenshots go to design/element-types-tr/.
 */
import { assert, exampleProject, run } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

const OUT = "design/element-types-tr";

for (const language of ["tr", "en"] as const) {
  const project = exampleProject();
  addElement(project, "procedure", "demo");
  await run(async (app) => {
    const tr = language === "tr";
    await app.click(".rtab", tr ? "Mod öğeleri" : "Mod elements");
    await app.waitFor(`[...document.querySelectorAll(".tile")].some((t) => t.textContent.includes("demo"))`, 20000);
    // The New element popup lists the type names.
    await app.click(".view .actions .abtn.primary");
    await app.waitFor(`document.querySelector(".ptype")`);
    const names = await app.eval<string[]>(`[...document.querySelectorAll(".pname")].map((n) => n.textContent)`);
    console.log(language, "types", names.join(" | "));
    assert(names.includes(tr ? "Prosedür" : "Procedure"), "procedure type name");
    assert(tr ? names.includes("Canlı varlık") && names.includes("Yaratıcı sekme") : names.includes("Living entity"), "more type names");
    await app.shot(`${OUT}/new-element-${language}.png`);
    await app.key("Escape");
    await app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.textContent.includes("demo")).setAttribute("id", "target")`);
    await app.click("#target", undefined, { double: true });
    await app.waitFor(`document.querySelector(".edname")`);
    const form = await app.eval<string>(`document.querySelector(".view, main")?.innerText ?? document.body.innerText`);
    if (tr) {
      for (const text of ["Prosedür", "Genel tetikleyici", "Dönüş türü", "Bağımlılık denetimini atla", "ayarlar"])
        assert(form.toLowerCase().includes(text.toLowerCase()), `Turkish text "${text}" in the procedure form`);
      assert(!form.includes("Global trigger") && !form.includes("Return type"), "no English labels left");
      const options = await app.eval<string[]>(`[...document.querySelectorAll("select option")].map((o) => o.textContent)`);
      assert(options.includes("Blok kırıldığında") && options.some((o) => o.startsWith("Yok (ögeler")), `Turkish options: ${options.slice(0, 4)}`);
    } else {
      for (const text of ["Global trigger", "Return type"]) assert(form.includes(text), `English text "${text}" kept`);
    }
    await app.shot(`${OUT}/procedure-form-${language}.png`);
    // A block form: page tabs, groups, labels, help and a select with many options.
    await app.click(".abtn", tr ? "Öğelere dön" : "Back");
    await app.eval(`document.getElementById("target")?.removeAttribute("id"); [...document.querySelectorAll(".tile")].find((t) => t.textContent.includes("Block of Ruby")).setAttribute("id", "target")`);
    await app.click("#target", undefined, { double: true });
    await app.waitFor(`document.querySelector(".ltab")`);
    const tabs = await app.eval<string[]>(`[...document.querySelectorAll(".ltab")].map((n) => n.textContent)`);
    console.log(language, "tabs", tabs.join(" | "));
    assert(tr ? tabs.includes("Sınır kutuları") && tabs.includes("Görünüm") : tabs.includes("Bounding boxes"), "page tabs");
    await app.click(".ltab", tr ? "Görünüm" : "Visual");
    await app.sleep(400);
    const block = await app.eval<string>(`document.body.innerText`);
    assert(tr ? block.includes("Doku") && !block.includes("Texture") : block.includes("Texture"), "block labels by language");
    await app.shot(`${OUT}/block-visual-${language}.png`);
  }, { project, language });
}
