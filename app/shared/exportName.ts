/** File name pattern of exported mod jars; {placeholders} are filled per engine. */
export const DEFAULT_EXPORT_PATTERN = "{modid}-{modversion}-{loader}-{mc}.jar";

export interface ExportNameValues {
  modid: string;
  modversion: string;
  loader: string;
  mc: string;
  engine: string;
}

/** Fills the pattern; characters Windows does not allow in file names become "_", and ".jar" is added if missing. */
export function exportFileName(pattern: string, values: ExportNameValues): string {
  const filled = pattern.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key as keyof ExportNameValues] : match));
  const safe = filled.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || values.engine;
  return safe.toLowerCase().endsWith(".jar") ? safe : `${safe}.jar`;
}
