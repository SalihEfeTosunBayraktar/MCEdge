/**
 * Problem severity and the project's problem settings (problems.json, KUYRUK 196). Pure: the renderer uses it too;
 * reading and writing the file is in src/ir/storage.ts.
 *
 * Rule: a check is an error when the generator, the Java compiler or the game would break on it (bad ids, files the
 * generator copies, broken references, values outside what Minecraft takes). Errors block the CLI build, can never be
 * ignored and their severity never changes. A check whose problem still builds and loads is a warning (the game
 * shows or logs something odd); a legal but unusual value (a field's warnAbove/warnBelow) is info. Only those checks
 * are listed in DEFAULT_SEVERITY: the user may ignore them per problem or per check, or set their severity (raising
 * one to error makes it block the build).
 */
import type { CheckCode } from "../elements/model.ts";

export type Severity = "error" | "warning" | "info";

/** Checks that do not break generation or the game, with their default severity; every other check is an error. */
export const DEFAULT_SEVERITY: Partial<Record<CheckCode, Severity>> = {
  // A language file with an odd name is generated; Minecraft just never loads it.
  languageCode: "warning",
  // sounds.json names a file the jar lacks: the game logs it and the sound is silent.
  soundFile: "warning",
  // An integration this app does not know is skipped by the generator.
  unknownIntegration: "warning",
  // Legal values past a field's soft limit (warnAbove/warnBelow).
  unusualHigh: "info",
  unusualLow: "info",
};

/** problems.json: problems and checks the user ignored, and severities changed per check. */
export interface ProblemSettings {
  /** One problem: its check and path ("item/ruby.stackSize"). */
  ignore?: { code: string; path: string }[];
  /** Every problem of these checks. */
  ignoreChecks?: string[];
  severity?: Record<string, Severity>;
}

export type ProblemAction =
  | { kind: "ignore" | "unignore"; code: string; path: string }
  | { kind: "ignoreCheck" | "unignoreCheck"; code: string }
  | { kind: "severity"; code: string; severity: Severity | "default" };

/** Whether a check may be ignored or have its severity changed (it is not an error by nature). */
export const adjustable = (code?: string): boolean => !!code && code in DEFAULT_SEVERITY;

export function severityOf(code: string | undefined, settings: ProblemSettings): Severity {
  const base = code ? DEFAULT_SEVERITY[code as CheckCode] : undefined;
  return base ? settings.severity?.[code!] ?? base : "error";
}

/** Whether a problem is ignored; a problem whose severity is error never is. */
export function isIgnored(issue: { path: string; code?: string }, settings: ProblemSettings): boolean {
  const { code, path } = issue;
  if (!adjustable(code) || severityOf(code, settings) === "error") return false;
  return !!settings.ignoreChecks?.includes(code!) || !!settings.ignore?.some((e) => e.code === code && e.path === path);
}

/**
 * Issues with their severity, split into the ones shown and the ignored ones. `prefix` turns the field paths of
 * one element ("damageCount") into project paths ("item/battery.damageCount") as problems.json stores them.
 */
export function classify<T extends { path: string; code?: string }>(issues: T[], settings: ProblemSettings, prefix = ""): { shown: (T & { severity: Severity })[]; ignored: (T & { severity: Severity })[] } {
  const shown: (T & { severity: Severity })[] = [];
  const ignored: (T & { severity: Severity })[] = [];
  for (const issue of issues) {
    const rated = { ...issue, severity: severityOf(issue.code, settings) };
    (isIgnored({ path: prefix + issue.path, code: issue.code }, settings) ? ignored : shown).push(rated);
  }
  return { shown, ignored };
}

/** Whether these problems stop a build: any error does. */
export const blocksBuild = (issues: { severity?: Severity }[]): boolean => issues.some((i) => (i.severity ?? "error") === "error");

/** The settings after one change; refuses checks that are errors by nature. */
export function applyProblemAction(settings: ProblemSettings, action: ProblemAction): ProblemSettings {
  const { code } = action;
  if (!adjustable(code)) throw new Error(`"${code}" is an error check (it breaks generation or the game): fix the problem, it cannot be ignored or lowered`);
  const ignore = (settings.ignore ?? []).filter((e) => !(action.kind === "ignore" || action.kind === "unignore") || e.code !== code || e.path !== action.path);
  const ignoreChecks = (settings.ignoreChecks ?? []).filter((c) => c !== code || (action.kind !== "ignoreCheck" && action.kind !== "unignoreCheck"));
  const severity = { ...settings.severity };
  if (action.kind === "ignore") ignore.push({ code, path: action.path });
  if (action.kind === "ignoreCheck") ignoreChecks.push(code);
  if (action.kind === "severity") {
    if (action.severity === "default" || action.severity === DEFAULT_SEVERITY[code as CheckCode]) delete severity[code];
    else severity[code] = action.severity;
  }
  return {
    ...(ignore.length ? { ignore } : {}),
    ...(ignoreChecks.length ? { ignoreChecks } : {}),
    ...(Object.keys(severity).length ? { severity } : {}),
  };
}
