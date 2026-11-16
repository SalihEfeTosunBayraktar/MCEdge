/**
 * Q240: client-only API in common/server code and server-only API in client code (pure checker, no app).
 *   node tools/java-test/side-check.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSides } from "../../src/java/sideCheck.ts";
import { assert } from "../mcp-test/client.ts";

const names = (source: string) => checkSides(source).markers.map((m) => `${m.line}:${m.name}:${m.api}>${m.usedIn}`);

// Forge common class: an imported client class in a plain method is flagged; the same inside @OnlyIn(Dist.CLIENT) is not.
const forge = `package demo;

import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.RenderType;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.api.distmarker.OnlyIn;

public class Thing {
   // Minecraft.getInstance() in a comment is not code
   String s = "Minecraft";

   public void tick() {
      Minecraft.getInstance().player.jump();
   }

   @OnlyIn(Dist.CLIENT)
   public void render() {
      RenderType.cutout();
      Minecraft.getInstance();
   }

   @OnlyIn(Dist.CLIENT)
   private static RenderType LAYER = RenderType.solid();

   public void other() {
      net.minecraft.client.Minecraft.getInstance();
      something.Minecraft.call();
   }
}
`;
const forgeReport = checkSides(forge);
assert(forgeReport.side === "common", `class side common: ${forgeReport.side}`);
assert(JSON.stringify(names(forge)) === JSON.stringify(["13:Minecraft:client>common", "26:net.minecraft.client.Minecraft.getInstance:client>common"]), `Forge markers: ${names(forge)}`);
const first = forgeReport.markers[0];
assert(first.column === 7 && first.endColumn === 16, `marker columns: ${first.column}-${first.endColumn}`);

// Whole-file client: class annotation, client package, ClientModInitializer.
assert(checkSides(`package demo;\nimport net.minecraft.client.Minecraft;\n@OnlyIn(Dist.CLIENT)\npublic class Screen {\n  void a() { Minecraft.getInstance(); }\n}\n`).side === "client", "@OnlyIn class is client");
assert(names(`package demo;\nimport net.minecraft.client.Minecraft;\n@OnlyIn(Dist.CLIENT)\npublic class Screen {\n  void a() { Minecraft.getInstance(); }\n}\n`).length === 0, "client API in a client class: no marker");
assert(checkSides(`package demo.client;\nimport net.minecraft.client.Minecraft;\nclass A { void a() { Minecraft.getInstance(); } }\n`).markers.length === 0, "client package: no marker");
const fabric = `package demo;\nimport net.fabricmc.api.ClientModInitializer;\nimport net.minecraft.client.MinecraftClient;\nimport net.minecraft.server.dedicated.MinecraftDedicatedServer;\npublic class DemoClient implements ClientModInitializer {\n  public void onInitializeClient() { MinecraftClient.getInstance(); MinecraftDedicatedServer s = null; }\n}\n`;
assert(checkSides(fabric).side === "client", "ClientModInitializer is client");
assert(JSON.stringify(names(fabric)) === JSON.stringify(["6:MinecraftDedicatedServer:server>client"]), `server-only API in client code: ${names(fabric)}`);

// Fabric @Environment on a method; server side file.
const env = `package demo;\nimport net.minecraft.client.MinecraftClient;\nclass A {\n  @Environment(EnvType.CLIENT)\n  void a() { MinecraftClient.getInstance(); }\n  void b() { MinecraftClient.getInstance(); }\n}\n`;
assert(JSON.stringify(names(env)) === JSON.stringify(["6:MinecraftClient:client>common"]), `@Environment(EnvType.CLIENT): ${names(env)}`);
const server = `package demo;\nimport net.minecraft.client.Minecraft;\n@OnlyIn(Dist.DEDICATED_SERVER)\nclass S {\n  void a() { Minecraft.getInstance(); }\n}\n`;
assert(checkSides(server).side === "server" && JSON.stringify(names(server)) === JSON.stringify(["5:Minecraft:client>server"]), `server class: ${names(server)}`);

// Client event subscriber and DistExecutor arguments.
const subscriber = `package demo;\nimport net.minecraft.client.Minecraft;\n@Mod.EventBusSubscriber(modid = "demo", bus = Bus.MOD, value = Dist.CLIENT)\npublic class ClientEvents {\n  static void a() { Minecraft.getInstance(); }\n}\n`;
assert(checkSides(subscriber).side === "client" && names(subscriber).length === 0, "client EventBusSubscriber");
const dist = `package demo;\nimport net.minecraft.client.Minecraft;\nclass A {\n  void a() {\n    DistExecutor.unsafeRunWhenOn(Dist.CLIENT, () -> () -> Minecraft.getInstance());\n    DistExecutor.unsafeRunForDist(() -> () -> Minecraft.getInstance(), () -> () -> null);\n    Minecraft.getInstance();\n  }\n}\n`;
assert(JSON.stringify(names(dist)) === JSON.stringify(["7:Minecraft:client>common"]), `DistExecutor client arguments: ${names(dist)}`);

// Text blocks and static imports.
const misc = `package demo;\nimport static net.minecraft.client.Minecraft.getInstance;\nclass A {\n  String t = """\n    Minecraft getInstance\n    """;\n  void a() { getInstance(); }\n}\n`;
assert(JSON.stringify(names(misc)) === JSON.stringify(["7:getInstance:client>common"]), `static import, text block: ${names(misc)}`);

// A real decompiled Forge 1.16.5 class (read-only): the packet handler uses Minecraft in common code.
const real = readFileSync(join("C:/MyProjects/AI-Assisted/ETREconomy-Legacy/src/main/java/etreco/EtrecoModVariables.java"), "utf8");
const realReport = checkSides(real);
assert(realReport.side === "common" && realReport.markers.some((m) => m.name === "Minecraft" && m.usedIn === "common"), `EtrecoModVariables: ${realReport.markers.length} markers`);
const screen = checkSides(readFileSync("C:/MyProjects/AI-Assisted/ETREconomy-Legacy/src/main/java/etreco/gui/Adminbookgui1GuiWindow.java", "utf8"));
assert(screen.side === "client" && screen.markers.length === 0, "a client screen class has no markers");
console.log("PASS side check");
