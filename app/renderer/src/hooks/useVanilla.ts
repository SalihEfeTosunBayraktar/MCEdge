import { useEffect, useState } from "react";
import type { PickerKind, VanillaCatalog } from "../../../shared/api.ts";
import { api } from "../api.ts";
import { language } from "../strings.ts";

/** Game language file of the UI language. */
const gameLanguage = () => (language() === "tr" ? "tr_tr" : "en_us");

const catalogs = new Map<string, Promise<VanillaCatalog>>();

/** Vanilla ids, names and tags of a picker kind for the engine's Minecraft version (KUYRUK 127); loaded once per app run. */
export function useVanillaCatalog(kind: PickerKind, minecraft?: string): VanillaCatalog | undefined {
  const key = `${kind}|${minecraft ?? ""}|${gameLanguage()}`;
  const [catalog, setCatalog] = useState<VanillaCatalog>();
  useEffect(() => {
    if (!catalogs.has(key)) catalogs.set(key, api.vanillaCatalog(kind, minecraft, gameLanguage()));
    let live = true;
    catalogs.get(key)!.then((c) => live && setCatalog(c), () => catalogs.delete(key));
    return () => void (live = false);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return catalog;
}

const icons = new Map<string, string | null>();
const waiting = new Map<string, Set<() => void>>();
let queue: { kind: PickerKind; minecraft?: string; ids: Set<string> } | undefined;

/** Asks the main process for every icon requested in the same tick at once. */
function request(kind: PickerKind, minecraft: string | undefined, id: string, done: () => void) {
  const key = `${kind}|${minecraft ?? ""}|${id}`;
  if (!waiting.has(key)) waiting.set(key, new Set());
  waiting.get(key)!.add(done);
  if (queue && (queue.kind !== kind || queue.minecraft !== minecraft)) flush();
  if (!queue) {
    queue = { kind, minecraft, ids: new Set() };
    setTimeout(flush, 0);
  }
  queue.ids.add(id);
}

function flush() {
  const batch = queue;
  queue = undefined;
  if (!batch?.ids.size) return;
  const ids = [...batch.ids];
  api.vanillaIcons(batch.kind, ids, batch.minecraft).then((found) => {
    for (const id of ids) {
      const key = `${batch.kind}|${batch.minecraft ?? ""}|${id}`;
      icons.set(key, found[id] ?? null);
      waiting.get(key)?.forEach((f) => f());
      waiting.delete(key);
    }
  });
}

/** Data URL of a vanilla id's icon; undefined while loading, null when there is none. */
export function useVanillaIcon(kind: PickerKind, id: string, minecraft?: string): string | null | undefined {
  const key = `${kind}|${minecraft ?? ""}|${id}`;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!id || icons.has(key)) return;
    let live = true;
    request(kind, minecraft, id, () => live && setTick((n) => n + 1));
    return () => void (live = false);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return id ? icons.get(key) : null;
}
