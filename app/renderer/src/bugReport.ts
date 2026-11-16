import { ISSUES_NEW } from "../../shared/api.ts";

/** Longest new-issue URL the report builds; browsers and GitHub reject much longer links. */
export const MAX_URL = 7000;
/** Build output lines a report attaches. */
export const BUILD_TAIL = 40;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Takes personal data out of a text before it is shown or sent (Q208): the home folder becomes ~ (either slash style),
 * the user name that remains elsewhere becomes <user>, e-mail addresses become <email>.
 */
export function mask(text: string, home: string, user: string): string {
  const slash = String.raw`[\\/]+`;
  // E-mail first: a user name inside an address would otherwise leave the rest of the address behind.
  let out = text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>");
  if (home) {
    const parts = home.split(/[\\/]+/).filter(Boolean).map(escapeRegExp);
    out = out.replace(new RegExp((/^[\\/]/.test(home) ? slash : "") + parts.join(slash), "gi"), "~");
  }
  if (user.length >= 2) out = out.replace(new RegExp(String.raw`(?<![\w-])` + escapeRegExp(user) + String.raw`(?![\w-])`, "gi"), "<user>");
  return out;
}

/** The issue body: `### Heading` sections in order, the attachments last so a trim cuts them first. */
export const reportBody = (sections: { heading: string; text: string }[]) =>
  sections.filter((s) => s.text.trim()).map((s) => `### ${s.heading}\n\n${s.text.trim()}`).join("\n\n");

export interface Link {
  url: string;
  /** The body in the link; shorter than the full body when `trimmed`. */
  body: string;
  trimmed: boolean;
}

/**
 * The new-issue link for a title and body. A body that does not fit MAX_URL is cut from the end (so attachments go
 * first) at a line break, and `note` is appended; the caller copies the full body to the clipboard.
 */
export function issueLink(title: string, body: string, note: string): Link {
  const link = (text: string) => `${ISSUES_NEW}title=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}&labels=bug`;
  if (link(body).length <= MAX_URL) return { url: link(body), body, trimmed: false };
  const fits = (n: number) => link(`${body.slice(0, n)}\n\n${note}`).length <= MAX_URL;
  let low = 0, high = body.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid; else high = mid - 1;
  }
  let cut = body.slice(0, low);
  cut = cut.slice(0, Math.max(cut.lastIndexOf("\n"), 0));
  // A cut inside the build output's code block must not leave the fence open.
  if ((cut.match(/^```/gm) ?? []).length % 2) cut += "\n```";
  const text = `${cut}\n\n${note}`;
  return { url: link(text), body: text, trimmed: true };
}
