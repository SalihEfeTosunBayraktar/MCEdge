/**
 * KUYRUK #68: the theme button is a sun/moon icon without text. It shows the current theme and switches on click.
 * Screenshots go to design/theme-toggle/.
 */
import { assert, exampleProject, run } from "./cdp.ts";

const OUT = "design/theme-toggle";
const state = `(() => { const b = document.querySelector(".themebtn"); return { text: b.textContent.trim(), icon: !!b.querySelector("svg.ico"), rects: b.querySelectorAll("svg rect").length, theme: document.documentElement.dataset.theme, title: b.title }; })()`;

await run(async (app) => {
  await app.waitFor(`!!document.querySelector(".themebtn")`);
  const dark = await app.eval<{ text: string; icon: boolean; rects: number; theme: string; title: string }>(state);
  assert(dark.text === "" && dark.icon && dark.title, `icon only: ${JSON.stringify(dark)}`);
  assert(dark.theme === "dark", "starts dark");
  await app.shot(`${OUT}/dark-moon.png`);
  await app.click(".themebtn");
  await app.waitFor(`document.documentElement.dataset.theme === "light"`);
  const light = await app.eval<{ text: string; rects: number; theme: string }>(state);
  assert(light.text === "" && light.rects > 0, "still icon only in light");
  await app.shot(`${OUT}/light-sun.png`);
  await app.click(".themebtn");
  await app.waitFor(`document.documentElement.dataset.theme === "dark"`);
}, { project: exampleProject() });
