/**
 * Minimal logic-less template renderer.
 *   {{name}}                  value lookup (dot paths allowed)
 *   {{#each list}}...{{/each}} repeat with the element merged into the context;
 *                             inside, {{@comma}} is "," except on the last element
 *   {{#if key}}...{{/if}}      keep the body when the value is truthy (non-empty for lists)
 * Blocks nest; the body of a false {{#if}} is not evaluated.
 */
export type Context = Record<string, unknown>;

const BLOCK_OPEN = /\{\{#(each|if) ([\w.]+)\}\}/;
const VALUE = /\{\{([@\w.]+)\}\}/g;

export function render(template: string, context: Context): string {
  const open = BLOCK_OPEN.exec(template);
  if (!open) return values(template, context);
  const [tag, kind, key] = open;
  const bodyStart = open.index + tag.length;
  const close = matchingClose(template, kind, bodyStart);
  const rest = template.slice(close + `{{/${kind}}}`.length);
  return values(template.slice(0, open.index), context) + block(kind, key, template.slice(bodyStart, close), context) + render(rest, context);
}

function block(kind: string, key: string, body: string, context: Context): string {
  const value = lookup(context, key);
  if (kind === "if") return (Array.isArray(value) ? value.length > 0 : Boolean(value)) ? render(body, context) : "";
  if (!Array.isArray(value)) throw new Error(`template: "${key}" is not a list`);
  return value
    .map((element, i) => render(body, { ...context, ...element, "@comma": i < value.length - 1 ? "," : "" }))
    .join("");
}

/** Position of the {{/kind}} closing the block whose body starts at `from`; nested blocks of the same kind are skipped. */
function matchingClose(template: string, kind: string, from: number): number {
  const tokens = new RegExp(`\\{\\{(#${kind} [\\w.]+|/${kind})\\}\\}`, "g");
  tokens.lastIndex = from;
  let depth = 1;
  for (let match = tokens.exec(template); match; match = tokens.exec(template)) {
    depth += match[1].startsWith("#") ? 1 : -1;
    if (depth === 0) return match.index;
  }
  throw new Error(`template: unclosed {{#${kind}}}`);
}

function values(text: string, context: Context): string {
  return text.replace(VALUE, (_, key: string) => {
    const value = lookup(context, key);
    if (value === undefined) throw new Error(`template: unknown value "${key}"`);
    return String(value);
  });
}

function lookup(context: Context, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value as Context | undefined)?.[key], context);
}
