import { basename, dirname, join, resolve } from "node:path";
import { userDataDir } from "../../src/userData.ts";

// Must run before any core module reads ROOT or the toolchains folder. This module is bundled into out/cli/index.js, so
// two folders up is the app: resources/app.asar when installed, the repository in development.
const appDir = resolve(import.meta.dirname, "..", "..");
if (basename(appDir) === "app.asar") {
  // The same core folders and toolchains as the installed app's window (app/main/env.ts).
  process.env.MCEDGE_ROOT ??= join(dirname(appDir), "core");
  process.env.MCEDGE_TOOLCHAINS ??= join(userDataDir(), "toolchains");
} else {
  process.env.MCEDGE_ROOT ??= appDir;
}
