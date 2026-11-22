import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../paths.ts";

/** One rule of config/build-explanations.json (Q246). */
interface Rule {
  id: string;
  kind: "javac" | "gradle";
  match: string;
  params?: Record<string, string>;
}

/** What a failed build's error means: the rule's id (strings `buildError.<id>.*`), the values it found, and the fix hint in English. */
export interface BuildExplanation {
  id: string;
  params: Record<string, string>;
  fix: string;
}

/** A Gradle failure ("What went wrong") a rule recognised. */
export interface GradleFailure {
  /** The failure text, as Gradle printed it. */
  message: string;
  explain: BuildExplanation;
}

let rules: Rule[] | undefined;
let english: Record<string, string> | undefined;

const load = <T>(file: string): T => JSON.parse(readFileSync(join(ROOT, "config", file), "utf8")) as T;

/** Fills {name} placeholders. */
export function fill(text: string, params: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? "");
}

function explanation(rule: Rule, text: string): BuildExplanation {
  const params: Record<string, string> = {};
  for (const [name, pattern] of Object.entries(rule.params ?? {})) {
    const value = new RegExp(pattern, "im").exec(text)?.slice(1).find(Boolean)?.trim();
    if (value) params[name] = value;
  }
  english ??= load<Record<string, string>>("ui-strings/en.json");
  return { id: rule.id, params, fix: fill(english[`buildError.${rule.id}.fix`] ?? "", params) };
}

function ruleFor(kind: Rule["kind"], subject: string): Rule | undefined {
  rules ??= load<{ rules: Rule[] }>("build-explanations.json").rules;
  return rules.find((r) => r.kind === kind && new RegExp(r.match, "i").test(subject));
}

/** The explanation of one compiler error (its message and detail lines), or undefined when no rule knows it. */
export function explainJavac(message: string, detail: string[] = []): BuildExplanation | undefined {
  const rule = ruleFor("javac", message);
  return rule && explanation(rule, [message, ...detail].join("\n"));
}

/**
 * Gradle's own failures in a build log: the text under "What went wrong", for the ones a rule recognises. A compile
 * failure is not among them: its errors are the compiler's (explainJavac).
 */
export function explainGradleFailures(lines: string[]): GradleFailure[] {
  const out: GradleFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\* What went wrong:/.test(lines[i].replace(/\r$/, ""))) continue;
    const block: string[] = [];
    for (let j = i + 1; j < lines.length && !/^\* /.test(lines[j]); j++) block.push(lines[j].replace(/\r$/, ""));
    const message = block.join("\n").trim();
    const rule = ruleFor("gradle", message);
    if (rule && !out.some((f) => f.message === message)) out.push({ message, explain: explanation(rule, message) });
  }
  return out;
}
