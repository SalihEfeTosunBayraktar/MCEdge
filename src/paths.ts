import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Root of the MCEdge core (config/, engines/, layers/, schemas/ live here). Bundled hosts such as the
 * Electron app set MCEDGE_ROOT because their bundle no longer sits next to these folders.
 */
export const ROOT = process.env.MCEDGE_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
