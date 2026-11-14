/**
 * A creative tab with sections for the tab order editor tests (KUYRUK 163-165): examples/hello's Rubies tab plus three
 * items, ordered as  ruby_apple | Gems: ruby, gem_a, gem_b, ruby_block | Tools: ruby_pickaxe, spacer | Food: gem_c.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleProject, type App } from "./cdp.ts";
import { addElement } from "./fixtures.ts";

export type Entry = { kind: string; type?: string; id?: string; title?: string; slots?: number };

export function tabOrderProject(): string {
  const project = exampleProject();
  for (const id of ["gem_a", "gem_b", "gem_c"]) addElement(project, "item", id, { name: id.replace("_", " ").toUpperCase(), creativeTabs: ["ruby_tab"] });
  const file = join(project, "elements", "creative_tabs", "ruby_tab.json");
  const tab = JSON.parse(readFileSync(file, "utf8"));
  const el = (type: string, id: string) => ({ kind: "element", type, id });
  tab.order = [
    el("item", "ruby_apple"),
    { kind: "section", title: "Gems" }, el("item", "ruby"), el("item", "gem_a"), el("item", "gem_b"), el("block", "ruby_block"),
    { kind: "section", title: "Tools" }, el("tool", "ruby_pickaxe"), { kind: "spacer" },
    { kind: "section", title: "Food" }, el("item", "gem_c"),
  ];
  writeFileSync(file, JSON.stringify(tab, null, 2) + "\n");
  return project;
}

/** The stored order, as "id" for elements and "#Title" / "_" / "/" for sections, spacers and section ends. */
export const savedOrder = (project: string): string[] =>
  ((JSON.parse(readFileSync(join(project, "elements", "creative_tabs", "ruby_tab.json"), "utf8")).order ?? []) as Entry[])
    .map((e) => (e.kind === "element" ? e.id! : e.kind === "section" ? `#${e.title}` : e.kind === "end" ? "/" : "_"));

/** Opens the Rubies tab editor and waits for its order list. */
export async function openTab(app: App): Promise<void> {
  await app.waitFor(`document.querySelector(".tile")`, 30000);
  await app.eval(`[...document.querySelectorAll(".tile:not(.foldertile)")].find((e) => e.querySelector("code")?.textContent === "ruby_tab").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await app.waitFor(`document.querySelectorAll(".taborder .torow").length > 5`, 15000);
  await app.eval(`document.querySelector(".taborder").scrollIntoView({ block: "start" })`);
  await app.sleep(200);
}

/** Waits until the editor saved (autosave). */
export async function waitSaved(app: App): Promise<void> {
  await app.sleep(500);
  await app.waitFor(`!document.querySelector(".smsg.saving")`);
}

/** The visible rows: "id" / "#Title" / "_", with "+" before a selected one. */
export const visibleRows = (app: App) => app.eval<string[]>(`[...document.querySelectorAll(".taborder .torow")].map((r) =>
  (r.classList.contains("sel") ? "+" : "") + (r.dataset.entry ?? ""))`);
