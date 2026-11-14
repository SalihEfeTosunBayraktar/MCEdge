import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LIVE_DIR, readPresence } from "./activity.ts";
export { parseScreen, type Screen, type ShowRequest } from "./screen.ts";
import { parseScreen, type ShowRequest } from "./screen.ts";

/**
 * Asking the running app to show a screen (KUYRUK 153), for editor_screenshot: the MCP server writes
 * .mcedge/live/show.json, the app (which watches the folder) switches there and confirms in presence-app.json
 * (`shown`), then the server captures the window.
 */
const showFile = (dir: string) => join(dir, LIVE_DIR, "show.json");

export function readShow(dir: string): ShowRequest | undefined {
  try {
    return existsSync(showFile(dir)) ? (JSON.parse(readFileSync(showFile(dir), "utf8")) as ShowRequest) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Asks the app to show `screen` and waits until it says it does. Throws when the app is not running, does not answer
 * in time, or cannot show it (an element that does not exist).
 */
export async function showInApp(dir: string, screen: string, timeoutMs = 8000): Promise<void> {
  if (!parseScreen(screen)) throw new Error(`unknown screen "${screen}"; see the tool description for the screens`);
  const app = readPresence(dir, "app");
  if (!app || Date.now() - Date.parse(app.at) > 60_000) throw new Error("the MCEdge app does not have this project open");
  const request: ShowRequest = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), screen };
  mkdirSync(dirname(showFile(dir)), { recursive: true });
  writeFileSync(showFile(dir), JSON.stringify(request) + "\n");
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const shown = readPresence(dir, "app")?.shown;
    if (shown?.id === request.id) {
      if (shown.error) throw new Error(shown.error);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the app did not switch to ${screen} within ${timeoutMs / 1000} s`);
}
