// Small readers for decompiled MCreator Java, shared by the import scripts.
import { copyFileSync, existsSync } from "node:fs";

/** Copies a texture with its animation (.mcmeta), when it has one. */
export function copyTexture(from: string, to: string): void {
  copyFileSync(from, to);
  if (existsSync(`${from}.mcmeta`)) copyFileSync(`${from}.mcmeta`, `${to}.mcmeta`);
}

/** Index just past the bracket closing the one at `open`. Strings and characters are skipped. */
export function closing(code: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'") {
      for (i++; code[i] !== c; i++) if (code[i] === "\\") i++;
    } else if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return i + 1;
    }
  }
  throw new Error(`unbalanced bracket at ${open}`);
}

/** Splits the argument list starting at the "(" at `open` on its top level commas. */
export function callArguments(code: string, open: number): { args: string[]; end: number } {
  const end = closing(code, open);
  const args: string[] = [];
  let start = open + 1;
  for (let i = open + 1; i < end - 1; i++) {
    const c = code[i];
    if (c === '"' || c === "'") {
      for (i++; code[i] !== c; i++) if (code[i] === "\\") i++;
    } else if (c === "(" || c === "{" || c === "[") i = closing(code, i) - 1;
    else if (c === ",") {
      args.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = code.slice(start, end - 1).trim();
  if (last) args.push(last);
  return { args, end };
}

/** Body (without the braces) of the first method matching `signature`, or "" when there is none. */
export function methodBody(code: string, signature: RegExp): string {
  const match = signature.exec(code);
  if (!match) return "";
  const open = code.indexOf("{", match.index + match[0].length - 1);
  return open < 0 ? "" : code.slice(open + 1, closing(code, open) - 1);
}

/** Id of a mod class name: "TeleporterGuiThisGUIIsOpened" -> "teleporter_gui_this_g_u_i_is_opened". */
export const snakeId = (name: string) => name.replace(/^./, (c) => c.toLowerCase()).replace(/[^a-zA-Z0-9]/g, "_").replace(/([A-Z])/g, "_$1").toLowerCase();

/** Procedure element id of a generated class name such as "CoinproduceProcedure". */
export const procedureId = (className: string) => snakeId(className.replace(/Procedure$/, ""));

/** Calls `Name.executeProcedure(` in `code`, with where each starts and ends. */
export function procedureCalls(code: string): { name: string; start: number; end: number; args: string }[] {
  const calls = [];
  for (const m of code.matchAll(/([\p{L}\p{N}_]+Procedure)\s*\.executeProcedure\(/gu)) {
    const open = m.index + m[0].length - 1;
    const end = closing(code, open);
    calls.push({ name: m[1], start: m.index, end, args: code.slice(open + 1, end - 1) });
  }
  return calls;
}
