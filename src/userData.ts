import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The app's per-user data folder (Electron's userData of "MCEdge") for code that runs without Electron, the CLI and the
 * MCP server: $MCEDGE_USER_DATA or the platform's default.
 */
export function userDataDir(): string {
  return process.env.MCEDGE_USER_DATA ?? (process.platform === "win32" ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "MCEdge")
    : process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "MCEdge") : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "MCEdge"));
}
