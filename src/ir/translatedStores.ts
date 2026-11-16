import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../paths.ts";
import type { Element, ElementType, ProjectIssue } from "../elements/model.ts";
import { BLOCKS_BY_ID } from "../procedures/blocks/index.ts";
import { isNode, mainStack, walkNodes, type BlockNode } from "../procedures/model.ts";
import { homeSide, procedureFieldUses, programOf } from "../procedures/project.ts";

/**
 * Translated text stored for the clients (KUYRUK 204). `text_translate` resolves in the language of the side it runs
 * on, which on a server procedure is the server's: a dedicated server has one language for everyone. Written into a
 * store the server syncs to the clients, every player would read that language. The setters below are such stores;
 * showing a translation through a chat message or a title is not (those blocks translate on the player's game).
 */

/** Setter blocks of synced text stores, and the input holding the value. */
const SYNCED_TEXT_SETTERS: readonly string[] = [
  "global_text_set", "player_text_set", "block_set_data_text", "entity_data_set_text", "item_set_data_text", "session_set_data_text",
];
const VALUE_INPUT = "value";

const TRANSLATE = "text_translate";
const LOCAL_TEXT_SET = "local_text_set";
const LOCAL_TEXT_GET = "local_text_get";

const children = (node: BlockNode): BlockNode[] =>
  Object.values(node.inputs ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v])).filter(isNode);

/** Whether a text value holds a translation: a translate block, or text built from one (a join, a trim, a local variable set from one). */
function carriesTranslation(node: BlockNode, translatedLocals: ReadonlySet<string>): boolean {
  if (node.disabled) return false;
  if (node.block === TRANSLATE) return true;
  if (node.block === LOCAL_TEXT_GET) return translatedLocals.has(String(node.fields?.var ?? ""));
  if (BLOCKS_BY_ID.get(node.block)?.output !== "text") return false;
  return children(node).some((c) => carriesTranslation(c, translatedLocals));
}

/** First translate block inside a value that carries one, for the issue path. */
function translateIn(node: BlockNode, nodePath: string, translatedLocals: ReadonlySet<string>): string | undefined {
  if (node.block === TRANSLATE) return nodePath;
  for (const [name, value] of Object.entries(node.inputs ?? {})) {
    const list = Array.isArray(value) ? value : [value];
    for (let i = 0; i < list.length; i++) {
      const child = list[i];
      if (!isNode(child) || !carriesTranslation(child, translatedLocals)) continue;
      return translateIn(child, `${nodePath}.inputs.${name}${Array.isArray(value) ? `[${i}]` : ""}`, translatedLocals) ?? nodePath;
    }
  }
  return undefined;
}

/** Problems for translations written into synced text stores by procedures that run on the server. */
export function translatedStoreIssues(elements: Record<string, Element[]>, variables: { name: string; type: string; scope: string }[], types: ReadonlyMap<string, ElementType>): ProjectIssue[] {
  const procedures = elements.procedure ?? [];
  if (!procedures.length) return [];
  const uses = procedureFieldUses({ elements, variables }, types);
  const messages = JSON.parse(readFileSync(join(ROOT, "config/messages.json"), "utf8")) as Record<string, string>;
  const issues: ProjectIssue[] = [];
  for (const procedure of procedures) {
    if (homeSide(procedure, uses) === "client") continue;
    const program = programOf(procedure);
    const main = mainStack(program);
    if (!main) continue;
    const live = [...walkNodes(program)].filter((n) => program.stacks[n.stack] === main && !n.node.disabled);
    // A local variable set from a translation holds one wherever it is read (order of the blocks is not followed).
    const translatedLocals = new Set<string>();
    for (const { node } of live) {
      if (node.block !== LOCAL_TEXT_SET) continue;
      const value = node.inputs?.[VALUE_INPUT];
      if (isNode(value) && carriesTranslation(value, translatedLocals)) translatedLocals.add(String(node.fields?.var ?? ""));
    }
    for (const { node, path } of live) {
      if (!SYNCED_TEXT_SETTERS.includes(node.block)) continue;
      const value = node.inputs?.[VALUE_INPUT];
      if (!isNode(value) || !carriesTranslation(value, translatedLocals)) continue;
      const at = translateIn(value, `${path}.inputs.${VALUE_INPUT}`, translatedLocals) ?? `${path}.inputs.${VALUE_INPUT}`;
      issues.push({
        path: `procedure/${procedure.id}.program.${at}`,
        message: messages.translatedStore.replace("{block}", node.block),
        code: "translatedStore",
        values: { block: node.block },
      });
    }
  }
  return issues;
}
