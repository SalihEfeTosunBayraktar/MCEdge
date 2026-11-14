/**
 * KUYRUK 166: animated textures (.png.mcmeta) play in block and 3D model previews. First the schedule as the game plays
 * it (frame size, order, per-frame time, interpolate); then, on a copy of ETREconomy, the open Solar Panel Charger
 * (batteryrechargeropened, custom JSON model whose texture 0 is solarcharger_texture_animated) redraws its form and
 * right-hand model previews over time, and Electronized Diamond Block (animated main texture) animates in the right-hand
 * preview, while a still texture stays a plain image. LIGHT=1 also takes the light screenshots. Screenshots go to design/166/.
 */
import { showInApp } from "../../src/live/show.ts";
import { animationSchedule, frameAt } from "../../src/resources/textureAnimation.ts";
import { assert, copyProject, run, type App } from "./cdp.ts";

const OUT = "design/166";

// ---- the schedule
const solar = animationSchedule(JSON.stringify({ animation: { frametime: 4, interpolate: true } }), 256, 2304)!;
assert(solar.frameCount === 9 && solar.frameWidth === 256 && solar.total === 36 && solar.interpolate, `solar ${JSON.stringify(solar)}`);
assert(frameAt(solar, 0).index === 0 && frameAt(solar, 4 * 50).index === 1 && frameAt(solar, 36 * 50).index === 0, "frames advance every 4 ticks and loop");
assert(frameAt(solar, 2 * 50).blend === 0.5 && frameAt(solar, 2 * 50).next === 1, "interpolate blends towards the next frame");
const ordered = animationSchedule(JSON.stringify({ animation: { frametime: 2, frames: [3, { index: 1, time: 10 }, 9] } }), 16, 64)!;
assert(JSON.stringify(ordered.frames) === JSON.stringify([{ index: 3, time: 2 }, { index: 1, time: 10 }]), `frame order, unknown index dropped ${JSON.stringify(ordered.frames)}`);
assert(frameAt(ordered, 5 * 50).index === 1 && frameAt(ordered, 5 * 50).blend === 0, "own frame time, no blend without interpolate");
assert(animationSchedule(JSON.stringify({ animation: {} }), 16, 16) === undefined, "a single frame is not an animation");
assert(animationSchedule("{}", 16, 64) === undefined && animationSchedule("not json", 16, 64) === undefined, "no animation section");
const wide = animationSchedule(JSON.stringify({ animation: { width: 8, height: 8 } }), 16, 16)!;
assert(wide.frameCount === 4, "frames narrower than the image are counted row by row");

// ---- the previews
const project = copyProject("C:/MyProjects/AI-Assisted/ETREconomy-MCEdge", "etr");
const pixels = (app: App, selector: string) => app.eval<string>(`(() => {
  const c = document.querySelector(${JSON.stringify(selector)});
  return c ? c.toDataURL() : "";
})()`);
/** Distinct pictures of a canvas sampled `count` times, `ms` apart. */
async function pictures(app: App, selector: string, count = 12, ms = 150): Promise<number> {
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) (seen.add(await pixels(app, selector)), await app.sleep(ms));
  seen.delete("");
  return seen.size;
}

await run(async (app) => {
  await app.waitFor(`document.querySelector(".tile")`, 60000);
  await app.sleep(2000);
  await showInApp(project, "block/batteryrechargeropened", 20000);
  await app.waitFor(`document.querySelector(".form .mpcanvas canvas") && document.querySelector(".pvmodel .mpcanvas canvas")`, 15000);
  await app.eval(`document.querySelector(".form .modelpreview").scrollIntoView({ block: "center" })`);
  await app.sleep(1500);
  const form = await pictures(app, ".form .mpcanvas canvas");
  assert(form >= 3, `form model preview animates: ${form} pictures`);
  const side = await pictures(app, ".pvmodel .mpcanvas canvas");
  assert(side >= 3, `right-hand model preview animates: ${side} pictures`);
  await app.shot(`${OUT}/after-model-dark.png`);
  await app.sleep(700);
  await app.shot(`${OUT}/after-model-later-dark.png`);

  await showInApp(project, "block/electronizeddiamondblock", 20000);
  await app.waitFor(`document.querySelector(".pvbig canvas[data-animated]")`, 15000);
  const big = await pictures(app, ".pvbig canvas[data-animated]");
  assert(big >= 3, `right-hand texture animates: ${big} pictures`);
  const slot = await pictures(app, ".pvinv canvas[data-animated]");
  assert(slot >= 3, `inventory slot animates: ${slot} pictures`);
  await app.shot(`${OUT}/after-texture-dark.png`);
  if (process.env.LIGHT) {
    await app.setTheme("light");
    await app.sleep(600);
    await app.shot(`${OUT}/after-texture-light.png`);
    await showInApp(project, "block/batteryrechargeropened", 20000);
    await app.waitFor(`document.querySelector(".pvmodel .mpcanvas canvas")`, 15000);
    await app.sleep(1500);
    await app.shot(`${OUT}/after-model-light.png`);
    await app.setTheme("dark");
  }

  // A still texture stays the plain image.
  await showInApp(project, "block/battery_recharger", 20000);
  await app.waitFor(`document.querySelector(".pvinv img")`, 15000);
  await app.sleep(800);
  assert(!await app.eval(`!!document.querySelector(".formpreview canvas[data-animated]")`), "a still texture is not animated");
}, { project, language: "tr", width: 1440, height: 900 });
