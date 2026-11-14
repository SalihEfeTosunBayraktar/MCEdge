/** A javac diagnostic from a Gradle log. */
export interface JavacDiagnostic {
  /** Absolute path as javac printed it. */
  file: string;
  line: number;
  severity: "error" | "warning";
  message: string;
  /** The lines javac adds: the source line, the caret, "symbol:" and "location:". */
  detail: string[];
}

const HEADER = /^\s*(.+?\.java):(\d+): (error|warning): (.*)$/;

/**
 * javac errors and warnings of a build log, in order, each with its detail lines. Gradle repeats the compiler output
 * (indented) in its failure report; a diagnostic already seen is not listed again.
 */
export function parseJavacDiagnostics(lines: string[]): JavacDiagnostic[] {
  const out: JavacDiagnostic[] = [];
  let current: JavacDiagnostic | undefined;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const m = HEADER.exec(line);
    if (m) {
      if (out.some((d) => d.file === m[1] && d.line === Number(m[2]) && d.message === m[4])) {
        current = undefined;
        continue;
      }
      current = { file: m[1], line: Number(m[2]), severity: m[3] as JavacDiagnostic["severity"], message: m[4], detail: [] };
      out.push(current);
      continue;
    }
    // Detail lines follow the header until Gradle or javac prints something else ("> Task", "3 errors", "Note:").
    if (current && current.detail.length < 6 && line && !/^(> |\d+ (errors?|warnings?)$|Note: |FAILURE|BUILD |\* )/.test(line)) current.detail.push(line);
    else current = undefined;
  }
  return out;
}
