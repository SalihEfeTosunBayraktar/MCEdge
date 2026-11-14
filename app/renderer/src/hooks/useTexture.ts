import { useEffect, useState } from "react";
import { api } from "../api.ts";

const cache = new Map<string, string>();
/** Bumped per texture when its file is rewritten, so every preview of it reloads. */
const versions = new Map<string, number>();
const listeners = new Set<(key: string) => void>();

/** Drops a cached texture after its PNG changed (texture editor save) and reloads every preview of it. */
export function invalidateTexture(dir: string, path: string): void {
  const key = `${dir}|${path}`;
  cache.delete(key);
  versions.set(key, (versions.get(key) ?? 0) + 1);
  listeners.forEach((l) => l(key));
}

/** Loads a project texture as a data URL; cached per project path. */
export function useTexture(dir: string, path: string): string | undefined {
  const key = `${dir}|${path}`;
  const [url, setUrl] = useState(cache.get(key));
  const [version, setVersion] = useState(versions.get(key) ?? 0);
  useEffect(() => {
    const listener = (changed: string) => changed === key && setVersion(versions.get(key) ?? 0);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, [key]);
  useEffect(() => {
    // Recipes and tabs without a resolvable item have no texture to load.
    if (!path) return setUrl(undefined);
    if (cache.has(key)) return setUrl(cache.get(key));
    let live = true;
    api.readTexture(dir, path).then(
      (data) => {
        cache.set(key, data);
        if (live) setUrl(data);
      },
      () => live && setUrl(undefined),
    );
    return () => {
      live = false;
    };
  }, [key, dir, path, version]);
  return url;
}
