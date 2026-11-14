// A throwaway project of 900 elements (600 procedures, 200 items, 100 blocks) with some in folders, for the list and folder checks.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addElement } from "../ui-test/fixtures.ts";

/** Procedures proc_000..599 (every third in "Logic" or "Logic/Jobs"), items item_000..199 (every fourth in "Shop"), blocks block_000..099 unfiled. */
export function buildBigProject(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mcedge.json"), JSON.stringify({ schemaVersion: 2, mod: { id: "bigmod", name: "Big", version: "1.0.0", package: "bigmod", authors: [], description: "", license: "MIT", website: "", credits: "", logo: "", dependencies: [] } }));
  const placement: Record<string, string> = {};
  for (let i = 0; i < 600; i++) {
    addElement(dir, "procedure", `proc_${String(i).padStart(3, "0")}`);
    if (i % 3 === 0) placement[`procedure/proc_${String(i).padStart(3, "0")}`] = i % 2 === 0 ? "Logic/Jobs" : "Logic";
  }
  for (let i = 0; i < 200; i++) {
    addElement(dir, "item", `item_${String(i).padStart(3, "0")}`, { name: i === 7 ? "Ruby Sword" : `Thing ${i}` });
    if (i % 4 === 0) placement[`item/item_${String(i).padStart(3, "0")}`] = "Shop";
  }
  for (let i = 0; i < 100; i++) addElement(dir, "block", `block_${String(i).padStart(3, "0")}`);
  writeFileSync(join(dir, "folders.json"), JSON.stringify({ folders: ["Logic", "Logic/Jobs", "Shop"], placement }));
}
