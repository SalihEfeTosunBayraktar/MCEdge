import { join } from "node:path";
import { app } from "electron";

// Must run before any core module reads ROOT or the toolchains folder.
if (app.isPackaged) {
  // electron-builder copies config/, engines/, layers/, schemas/ and the example to resources/core.
  process.env.MCEDGE_ROOT ??= join(process.resourcesPath, "core");
  // The install folder may be read-only; downloaded JDKs and Gradle live with the user's data.
  process.env.MCEDGE_TOOLCHAINS ??= join(app.getPath("userData"), "toolchains");
} else {
  // In development the bundled main script sits in out/main; the app path is the repository root.
  process.env.MCEDGE_ROOT ??= app.getAppPath();
}
