import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../paths.ts";
import type { Element, ProjectIssue } from "../elements/model.ts";
import { walkNodes, type BlockNode, type ProcedureIR } from "../procedures/model.ts";

/**
 * Game rule names in procedures (KUYRUK 51). A world_game_rule_* block names a rule by text; the generated helpers find
 * it in camelCase, snake_case or by the element's ruleName (names compare without underscores and case). This module
 * holds what the project side needs: which blocks name rules, which rule element a name means, the validation problem
 * for a name that means nothing, and rewriting those names when a rule element's ruleName or id changes.
 */

/** Procedure blocks whose `rule` field names a game rule. */
export const GAME_RULE_BLOCKS: readonly string[] = ["world_game_rule_logic", "world_game_rule_number", "world_set_game_rule_number"];
const RULE_FIELD = "rule";

/** A name without underscores and case, the form the helpers compare in. */
export const looseRuleName = (name: string) => name.replaceAll("_", "").toLowerCase();
const camel = (id: string) => id.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** The name /gamerule uses before 26.x: the element's `ruleName`, else the camelCase of its id (as the generator registers it). */
export const ruleNameOf = (rule: Element): string => (typeof rule.ruleName === "string" && rule.ruleName ? rule.ruleName : camel(rule.id));

let vanilla: Set<string> | undefined;
/** Minecraft's own rules, loose names. */
function vanillaRules(): Set<string> {
  vanilla ??= new Set((JSON.parse(readFileSync(join(ROOT, "config/vanilla-game-rules.json"), "utf8")) as { rules: string[] }).rules.map(looseRuleName));
  return vanilla;
}

/** Whether `name` means this rule element: its ruleName or its id. */
export const ruleMatches = (rule: Element, name: string): boolean => {
  const loose = looseRuleName(name);
  return loose === looseRuleName(ruleNameOf(rule)) || loose === looseRuleName(rule.id);
};

/** The game_rule element a name means: an exact ruleName or id first, then the loose match. */
export function ruleElementFor(name: string, rules: readonly Element[]): Element | undefined {
  return rules.find((r) => ruleNameOf(r) === name || r.id === name) ?? rules.find((r) => ruleMatches(r, name));
}

const isProgram = (value: unknown): value is ProcedureIR =>
  !!value && typeof value === "object" && !Array.isArray(value) && (value as ProcedureIR).format === 1 && Array.isArray((value as ProcedureIR).stacks);

/** A rule block of some program in some element. */
export interface RuleRead {
  typeId: string;
  element: Element;
  /** Place inside the element: "program.stacks[0].blocks[1].fields.rule". */
  path: string;
  node: BlockNode;
  name: string;
}

/** Every rule block of every program of the elements, wherever a program sits in the element. */
export function* ruleReads(elements: Record<string, Element[]>): Generator<RuleRead> {
  for (const [typeId, list] of Object.entries(elements)) {
    for (const element of list) {
      const programs: { value: ProcedureIR; path: string }[] = [];
      const find = (value: unknown, path: string) => {
        if (isProgram(value)) programs.push({ value, path });
        else if (Array.isArray(value)) value.forEach((v, i) => find(v, `${path}[${i}]`));
        else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) find(v, `${path}.${k}`);
      };
      for (const [key, value] of Object.entries(element)) if (key !== "id") find(value, key);
      for (const program of programs) {
        for (const { node, path } of walkNodes(program.value)) {
          if (!GAME_RULE_BLOCKS.includes(node.block)) continue;
          const name = node.fields?.[RULE_FIELD];
          if (typeof name === "string") yield { typeId, element, path: `${program.path}.${path}.fields.${RULE_FIELD}`, node, name };
        }
      }
    }
  }
}

/** Problems for rule blocks that name no Minecraft rule and no game_rule element of the project. */
export function gameRuleIssues(elements: Record<string, Element[]>): ProjectIssue[] {
  const messages = JSON.parse(readFileSync(join(ROOT, "config/messages.json"), "utf8")) as Record<string, string>;
  const rules = elements.game_rule ?? [];
  const issues: ProjectIssue[] = [];
  for (const read of ruleReads(elements)) {
    if (!read.name || vanillaRules().has(looseRuleName(read.name)) || ruleElementFor(read.name, rules)) continue;
    issues.push({ path: `${read.typeId}/${read.element.id}.${read.path}`, message: messages.unknownGameRule.replace("{rule}", read.name), code: "unknownGameRule", values: { rule: read.name } });
  }
  return issues;
}

/**
 * Points every rule block that names a rule by `from` (the name it had) at `to`, in the given elements, which are changed in
 * place. Returns the elements that changed. A block that names the rule in the other spelling (snake_case where the
 * name is camelCase) keeps its style: `to` is written in snake_case when the old text had an underscore.
 */
export function renameRuleReads(elements: Record<string, Element[]>, from: string, to: string): { type: string; element: Element }[] {
  const changed = new Map<Element, string>();
  const loose = looseRuleName(from);
  for (const read of ruleReads(elements)) {
    if (looseRuleName(read.name) !== loose) continue;
    read.node.fields![RULE_FIELD] = read.name.includes("_") && !to.includes("_") ? to.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) : to;
    changed.set(read.element, read.typeId);
  }
  return [...changed].map(([element, type]) => ({ type, element }));
}
