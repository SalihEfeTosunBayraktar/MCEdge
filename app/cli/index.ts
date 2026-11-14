/**
 * The core CLI (src/cli.ts) bundled with the app, so an installed MCEdge serves MCP without Node.js or the sources:
 * an agent starts `MCEdge.exe <resources>/app.asar/out/cli/index.js mcp <project folder>` with ELECTRON_RUN_AS_NODE=1,
 * which runs the exe as plain Node (no window, stdout carries only the protocol). See docs/MCP.md.
 */
import "./env.ts";
import "../../src/cli.ts";
