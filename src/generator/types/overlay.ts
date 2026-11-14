import type { Element } from "../../elements/model.ts";
import { idExpr, jstr, list, str } from "../java.ts";
import { procedureBuild, procedureCall, procedureCallById } from "../procedures.ts";
import { modClassName } from "../registries.ts";
import type { ElementContext, GenEnv, TypeModule } from "../typeModule.ts";
import { imageStates, labelText, stateDraw, stateExpression, stateMembers, stateTextures, zOf, type GuiWidget } from "./gui.ts";
import SCREENS from "../data/screens.json" with { type: "json" };
import { anchorParts, fixedScaleOf, scaleModeOf, widgetAnchor } from "../../elements/overlayLayout.ts";

/**
 * Overlays: labels and images drawn over the in-game HUD or over a screen (overlayTarget) from <Mod>Overlays
 * (client). Widgets use the gui_layout format on a 427x240 canvas; each keeps its distance to the canvas point its
 * anchor names (KUYRUK 170, src/elements/overlayLayout.ts: the centre by default, as before), and the overlay's scale
 * mode draws a canvas pixel as one GUI pixel, at a fixed GUI scale, or scaled to fill the screen. The base texture is
 * stretched over the whole screen. The display condition procedure (logic) runs on the client with the local player,
 * and so do a widget's own `condition` and a label's `textProcedure` (text shown instead, read every frame).
 * Forge and NeoForge register the render listener at the chosen priority; Fabric runs listeners in registration
 * order, so overlays register highest priority first. Screen classes per version are in data/screens.json
 * (tools/gen-screens.ts); a screen the version does not have is not generated there (layer.json).
 */

const ORDER = ["HIGHEST", "HIGH", "NORMAL", "LOW", "LOWEST"];
const screenOf = (env: GenEnv, overlay: ElementContext): string | undefined => {
  const target = str(overlay.overlayTarget) || "Ingame";
  return target === "Ingame" ? undefined : ((SCREENS as Record<string, Record<string, string | null>>)[target]?.[env.mc] ?? undefined);
};
const PRIORITY: Record<string, string> = { HIGHEST: "HIGHEST", HIGH: "HIGH", NORMAL: "NORMAL", LOW: "LOW", LOWEST: "LOWEST" };
const int = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) && value !== "" && value !== undefined ? Math.round(Number(value)) : fallback);
const argb = (color: unknown) => `0xFF${(/^#[0-9a-fA-F]{6}$/.test(str(color)) ? str(color).slice(1) : "FFFFFF").toUpperCase()}`;

function element(overlay: Element, env: GenEnv): ElementContext {
  const lang: Record<string, string> = {};
  const textures: NonNullable<ElementContext["textures"]> = [];
  if (str(overlay.baseTexture)) textures.push({ from: str(overlay.baseTexture), to: `screens/${overlay.id}` });
  // Drawn in z order (KUYRUK 103), list order among equal ones; i stays the widget's index (texture, key).
  const ordered = list<GuiWidget>(overlay.components).map((w, i) => ({ w, i })).sort((a, b) => zOf(a.w) - zOf(b.w) || a.i - b.i);
  ordered.forEach(({ w, i }) => {
    if (w.kind === "label" && str(w.text)) lang[`gui.${env.modId}.${overlay.id}.${str(w.name) || `label_${i}`}`] = str(w.text);
    if (w.kind === "image" && str(w.image)) textures.push({ from: str(w.image), to: `screens/${overlay.id}_${i}` });
    if (w.kind === "state_image") textures.push(...stateTextures(env.projectDir, w, String(overlay.id), i).copies);
  });
  return { lang, textures };
}

/**
 * Scale mode (KUYRUK 170): "gui" draws a canvas pixel as one GUI pixel (no code); "fixed" and "fit" scale the pose by
 * s and place widgets on the screen in canvas pixels (w, h divided by s), so anchors and the base texture still reach
 * its edges.
 */
function overlayScale(env: GenEnv, overlay: ElementContext): { open: string; close: string } {
  const mode = scaleModeOf(overlay);
  if (mode === "gui") return { open: "", close: "" };
  const s = mode === "fit" ? "Math.min(w / 427.0F, h / 240.0F)" : `${fixedScaleOf(overlay)}.0F / (float) mc.getWindow().getGuiScale()`;
  const push = env.mc === "1.16.5" ? "g.pushPose();\n        g.scale(s, s, 1.0F);"
    : env.mc === "26.3" ? "g.pose().pushMatrix();\n        g.pose().scale(s, s);"
    : "g.pose().pushPose();\n        g.pose().scale(s, s, 1.0F);";
  const pop = env.mc === "1.16.5" ? "g.popPose();" : env.mc === "26.3" ? "g.pose().popMatrix();" : "g.pose().popPose();";
  return {
    open: `        float s = ${s};\n        w = Math.round(w / s);\n        h = Math.round(h / s);\n        ${push}\n`,
    close: `        ${pop}\n`,
  };
}

/** Static members of an overlay's state images (KUYRUK 186), keeping each one's state between frames. */
const stateMembersOf = new Map<ElementContext, string[]>();

function method(env: GenEnv, overlay: ElementContext): string {
  const legacy = env.mc === "1.16.5";
  const v26 = env.mc === "26.3";
  const G = legacy ? "com.mojang.blaze3d.matrix.MatrixStack" : v26 ? "net.minecraft.client.gui.GuiGraphicsExtractor" : "net.minecraft.client.gui.GuiGraphics";
  const id = String(overlay.id);
  const lines: string[] = [];
  const members: string[] = [];
  stateMembersOf.set(overlay, members);
  const blit = (texture: string, x: string, y: string, w: string, h: string) => {
    const rl = idExpr(env, `${env.modId}:textures/screens/${texture}.png`);
    if (legacy) return `mc.getTextureManager().bind(${rl});\n        net.minecraft.client.gui.AbstractGui.blit(g, ${x}, ${y}, 0.0F, 0.0F, ${w}, ${h}, ${w}, ${h});`;
    const pipeline = v26 ? "net.minecraft.client.renderer.RenderPipelines.GUI_TEXTURED" : "net.minecraft.client.renderer.RenderType::guiTextured";
    return `g.blit(${pipeline}, ${rl}, ${x}, ${y}, 0.0F, 0.0F, ${w}, ${h}, ${w}, ${h});`;
  };
  const player = "mc.player";
  const deps = { x: `${player}.getX()`, y: `${player}.getY()`, z: `${player}.getZ()`, world: legacy ? `${player}.level` : `${player}.level()`, entity: player };
  if (str(overlay.baseTexture)) lines.push(blit(id, "0", "0", "w", "h"));
  // Drawn in z order (KUYRUK 103), list order among equal ones; i stays the widget's index (texture, key).
  const ordered = list<GuiWidget>(overlay.components).map((w, i) => ({ w, i })).sort((a, b) => zOf(a.w) - zOf(b.w) || a.i - b.i);
  // Anchor origins: the canvas centred (cx, cy, the old placement), its right / bottom edge on the screen's (rx, by), or 0.
  const edges = new Set<string>();
  ordered.forEach(({ w, i }) => {
    const { h, v } = anchorParts(widgetAnchor(w, overlay));
    const ox = ["", "cx", "rx"][h], oy = ["", "cy", "by"][v];
    if (h === 2) edges.add("rx = w - 427");
    if (v === 2) edges.add("by = h - 240");
    const x = ox ? `${ox} + ${int(w.x, 0)}` : String(int(w.x, 0));
    const y = oy ? `${oy} + ${int(w.y, 0)}` : String(int(w.y, 0));
    const test = str(w.condition) ? procedureCallById(env, w.condition, deps, `overlay/${id}`, "logic") : undefined;
    const draw = (line: string) => lines.push(test ? `if (${test}) {\n            ${line}\n        }` : line);
    const dynamic = w.kind === "label" && str(w.textProcedure) ? procedureCallById(env, w.textProcedure, deps, `overlay/${id}`) : undefined;
    if (w.kind === "label" && (dynamic || str(w.text))) {
      const key = jstr(`gui.${env.modId}.${id}.${str(w.name) || `label_${i}`}`);
      const component = legacy
        ? (dynamic ? `new net.minecraft.util.text.StringTextComponent(${dynamic})` : `new net.minecraft.util.text.TranslationTextComponent(${key})`)
        : (dynamic ? `net.minecraft.network.chat.Component.literal(${dynamic})` : `net.minecraft.network.chat.Component.translatable(${key})`);
      draw(labelText(env.mc, w, x, y, "mc.font", component, argb(w.color)));
    } else if (w.kind === "image" && str(w.image)) {
      draw(blit(`${id}_${i}`, x, y, String(int(w.width, 16)), String(int(w.height, 16))));
    } else if (w.kind === "state_image") {
      // KUYRUK 186: the state is kept in static fields of the overlays class, read every frame or every updateTicks.
      const prefix = `${id}${i}`;
      const line = stateDraw(env, w, stateTextures(env.projectDir, w, id, i).drawn, prefix, x, y, (rl) => `mc.getTextureManager().bind(${rl});`);
      if (!line) return;
      const expression = stateExpression(w, imageStates(w).length, (pid, returns) => procedureCallById(env, pid, deps, `overlay/${id}`, returns));
      members.push(stateMembers(w, prefix, expression, true, `Overlay ${id}, state image ${i}`));
      draw(line);
    }
  });
  let condition = "";
  const conditionId = str(overlay.displayCondition);
  if (conditionId) {
    const unit = procedureBuild(env).scope.procedures.get(conditionId);
    if (unit && unit.returnType !== "logic") procedureBuild(env).warnings.push(`overlay/${id}: display condition "${conditionId}" must return logic`);
    else {
      const call = procedureCall(env, "overlay", overlay as unknown as Element, "displayCondition", deps);
      if (call) condition = screenOf(env, overlay) ? `\n        if (${player} != null && !${call}) return;` : `\n        if (!${call}) return;`;
    }
  }
  const scale = overlayScale(env, overlay);
  return `    public static void ${id}(${G} g) {
        net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
${screenOf(env, overlay) ? "" : `        if (${player} == null) return;\n`}${condition.replace(/^\n/, "")}
        int w = mc.getWindow().getGuiScaledWidth(), h = mc.getWindow().getGuiScaledHeight();
${scale.open}        int cx = w / 2 - 213, cy = h / 2 - 120${[...edges].map((e) => `, ${e}`).join("")};
${legacy ? "        com.mojang.blaze3d.systems.RenderSystem.enableBlend();\n        com.mojang.blaze3d.systems.RenderSystem.defaultBlendFunc();\n        com.mojang.blaze3d.systems.RenderSystem.color4f(1.0F, 1.0F, 1.0F, 1.0F);\n" : ""}${lines.map((l) => `        ${l}\n`).join("")}${scale.close}    }`;
}

/** `anchor`: the HUD layer an in-game overlay is drawn after on Fabric (the vanilla camera overlay layer, or the previous overlay). */
function registration(env: GenEnv, overlay: ElementContext, owner: string, anchor: string): string {
  const id = String(overlay.id);
  const priority = PRIORITY[str(overlay.priority)] ?? "NORMAL";
  const screen = screenOf(env, overlay);
  if (screen) {
    if (env.mc === "1.16.5") {
      return `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.${priority}, false, net.minecraftforge.client.event.GuiScreenEvent.DrawScreenEvent.Post.class, event -> {
            if (event.getGui() instanceof ${screen}) ${owner}.${id}(event.getMatrixStack());
        });`;
    }
    if (env.loader === "neoforge") {
      return `net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.bus.api.EventPriority.${priority}, false, net.neoforged.neoforge.client.event.ScreenEvent.Render.Post.class, event -> {
            if (event.getScreen() instanceof ${screen}) ${owner}.${id}(event.getGuiGraphics());
        });`;
    }
    const after = env.mc === "26.3" ? "afterExtract" : "afterRender";
    return `net.fabricmc.fabric.api.client.screen.v1.ScreenEvents.AFTER_INIT.register((client, screen, width, height) -> {
            if (screen instanceof ${screen}) net.fabricmc.fabric.api.client.screen.v1.ScreenEvents.${after}(screen).register((s, graphics, mouseX, mouseY, delta) -> ${owner}.${id}(graphics));
        });`;
  }
  if (env.mc === "1.16.5") {
    return `net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener(net.minecraftforge.eventbus.api.EventPriority.${priority}, false, net.minecraftforge.client.event.RenderGameOverlayEvent.Post.class, event -> {
            if (event.getType() == net.minecraftforge.client.event.RenderGameOverlayEvent.ElementType.HELMET) ${owner}.${id}(event.getMatrixStack());
        });`;
  }
  if (env.loader === "neoforge") {
    return `net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.bus.api.EventPriority.${priority}, false, net.neoforged.neoforge.client.event.RenderGuiLayerEvent.Post.class, event -> {
            if (event.getName().equals(net.neoforged.neoforge.client.gui.VanillaGuiLayers.CAMERA_OVERLAYS)) ${owner}.${id}(event.getGuiGraphics());
        });`;
  }
  if (env.mc === "26.3") {
    return `net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry.attachElementAfter(${anchor}, ${idExpr(env, `${env.modId}:${id}`)}, (graphics, delta) -> ${owner}.${id}(graphics));`;
  }
  return `net.fabricmc.fabric.api.client.rendering.v1.HudLayerRegistrationCallback.EVENT.register(drawer -> drawer.attachLayerAfter(${anchor}, ${idExpr(env, `${env.modId}:${id}`)}, (graphics, delta) -> ${owner}.${id}(graphics)));`;
}

export default {
  element,
  runtime(overlays, env) {
    if (!overlays.length) return {};
    const pkg = env.project.mod.package;
    const cls = `${modClassName(env)}Overlays`;
    const owner = `${pkg}.client.${cls}`;
    // Fabric listeners run in registration order: highest priority first, like the event bus orders them.
    const rank = (o: ElementContext) => { const i = ORDER.indexOf(str(o.priority) || "NORMAL"); return i < 0 ? 2 : i; };
    const ordered = env.loader === "fabric" ? [...overlays].sort((a, b) => rank(a) - rank(b)) : overlays;
    // Fabric draws in-game overlays after the vanilla camera overlay layer (where MCreator's helmet overlay is), each after the one before.
    const anchors = new Map<ElementContext, string>();
    let previous = env.mc === "26.3" ? "net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements.MISC_OVERLAYS" : "net.fabricmc.fabric.api.client.rendering.v1.IdentifiedLayer.MISC_OVERLAYS";
    for (const o of ordered) {
      if (screenOf(env, o)) continue;
      anchors.set(o, previous);
      previous = idExpr(env, `${env.modId}:${o.id}`);
    }
    const code = `package ${pkg}.client;

/** Generated by MCEdge: in-game overlays; loaded only on the physical client. */
public final class ${cls} {
    private ${cls}() {}

    public static void register() {
${ordered.map((o) => `        ${registration(env, o, owner, anchors.get(o) ?? "")}`).join("\n")}
    }

${overlays.map((o) => method(env, o)).join("\n\n")}
${overlays.flatMap((o) => stateMembersOf.get(o) ?? []).map((m) => `\n${m}\n`).join("")}}
`;
    return { sources: [{ path: `${pkg.replaceAll(".", "/")}/client/${cls}.java`, code }], clientInit: [`${owner}.register();`] };
  },
} satisfies TypeModule;

