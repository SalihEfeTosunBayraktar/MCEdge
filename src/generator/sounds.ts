import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { idExpr } from "./java.ts";
import { soundEvents } from "../resources/soundEvents.ts";
import { registryClass } from "./registries.ts";
import type { GenEnv, JavaSourceFile, ResourceFile } from "./typeModule.ts";

/**
 * Project sounds: the project's sound events (src/resources/soundEvents.ts: one per sounds/<name>.ogg, or as
 * sound_events.json lists them, KUYRUK 132) become "<modid>:<event>" on every engine. Their files are copied to
 * assets/<modid>/sounds/, sounds.json names each event's files and its subtitle key, and <Mod>Sounds registers the
 * events so registry lookups (sound fields, procedure blocks) find them. Subtitle texts come with the localization.
 */

const NAME = /^[a-z0-9_]+$/;

/** Sound names of the project (files in sounds/ named [a-z0-9_]+.ogg). */
export function projectSoundNames(projectDir: string): string[] {
  const dir = join(projectDir, "sounds");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".ogg") && NAME.test(n.slice(0, -4))).map((n) => n.slice(0, -4)).sort();
}

export interface ProjectSounds {
  /** Project file -> path under src/main/resources. */
  copies: { from: string; to: string }[];
  files: ResourceFile[];
  sources: JavaSourceFile[];
  init: string[];
}

export function projectSounds(env: GenEnv): ProjectSounds {
  const fileNames = projectSoundNames(env.projectDir);
  const events = soundEvents(env.projectDir, env.modId, fileNames);
  // Validation refuses a project with a broken event (src/ir/validate.ts), so every event here is usable.
  const usable = events;
  if (!usable.length) return { copies: [], files: [], sources: [], init: [] };
  const names = usable.map((e) => e.name);
  const legacy = env.mc === "1.16.5";
  const json = Object.fromEntries(usable.map((e) => [e.name, { ...(e.subtitleKey ? { subtitle: e.subtitleKey } : {}), sounds: e.files.map((f) => `${env.modId}:${f}`) }]));
  const files = [...new Set(usable.flatMap((e) => e.files))].sort();
  const registry = registryClass(env, {
    name: "Sounds",
    valueType: legacy ? "net.minecraft.util.SoundEvent" : "net.minecraft.sounds.SoundEvent",
    forge: "net.minecraftforge.registries.ForgeRegistries.SOUND_EVENTS",
    key: "SOUND_EVENT",
    entries: names.map((n) => ({
      constant: n.toUpperCase(),
      id: n,
      factory: legacy ? `new net.minecraft.util.SoundEvent(${idExpr(env, `${env.modId}:${n}`)})` : `net.minecraft.sounds.SoundEvent.createVariableRangeEvent(${idExpr(env, `${env.modId}:${n}`)})`,
    })),
  });
  return {
    copies: files.map((n) => ({ from: `sounds/${n}.ogg`, to: `assets/${env.modId}/sounds/${n}.ogg` })),
    files: [{ path: `assets/${env.modId}/sounds.json`, json: JSON.stringify(json, null, 2) }],
    sources: [registry.source],
    init: [registry.init],
  };
}
