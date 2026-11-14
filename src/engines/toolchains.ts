import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ROOT } from "../paths.ts";

/**
 * JDKs and Gradle distributions MCEdge builds with. They are not shipped with the app: each one is
 * downloaded once, on first need, into the toolchains folder ($MCEDGE_TOOLCHAINS, else <root>/.toolchains).
 */
export type ToolchainKind = "jdk" | "gradle";

interface ToolchainEntry {
  /** Extracted folder name; a trailing "*" matches the single folder with that prefix. */
  folder: string;
  /** Archive URL; {os} and {arch} are filled with Adoptium's platform names. */
  download: string;
}

export type ProgressListener = (message: { kind: ToolchainKind; version: string; received: number; total?: number }) => void;

const config: Record<ToolchainKind, Record<string, ToolchainEntry>> = JSON.parse(
  readFileSync(join(ROOT, "config/toolchains.json"), "utf8"),
);

export function toolchainsDir(): string {
  return process.env.MCEDGE_TOOLCHAINS ?? join(ROOT, ".toolchains");
}

/** Installed folder of a toolchain, or undefined when it still has to be downloaded. */
export function findToolchain(kind: ToolchainKind, version: string | number): string | undefined {
  const entry = entryFor(kind, version);
  const base = toolchainsDir();
  if (!existsSync(base)) return undefined;
  const match = entry.folder.endsWith("*")
    ? readdirSync(base).find((name) => name.startsWith(entry.folder.slice(0, -1)))
    : readdirSync(base).find((name) => name === entry.folder);
  return match && join(base, match);
}

/** Like findToolchain, but fails with a clear message instead of returning undefined. */
export function toolchainPath(kind: ToolchainKind, version: string | number): string {
  const path = findToolchain(kind, version);
  if (!path) throw new Error(`${kind} ${version} is not installed in ${toolchainsDir()}; run ensureToolchain first`);
  return path;
}

/** Downloads and extracts a toolchain if it is missing; returns its folder. */
export async function ensureToolchain(kind: ToolchainKind, version: string | number, onProgress?: ProgressListener): Promise<string> {
  const existing = findToolchain(kind, version);
  if (existing) return existing;

  const url = entryFor(kind, version).download.replace("{os}", adoptiumOs()).replace("{arch}", adoptiumArch());
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`download failed (${response.status}): ${url}`);

  const total = Number(response.headers.get("content-length")) || undefined;
  const work = mkdtempSync(join(tmpdir(), "mcedge-toolchain-"));
  const archive = join(work, process.platform === "win32" ? "archive.zip" : "archive.tar.gz");
  try {
    let received = 0;
    const counted = Readable.fromWeb(response.body as never).on("data", (chunk: Buffer) => {
      received += chunk.length;
      onProgress?.({ kind, version: String(version), received, total });
    });
    await pipeline(counted, createWriteStream(archive));
    mkdirSync(toolchainsDir(), { recursive: true });
    const result = spawnSync(tarCommand(), ["-xf", archive, "-C", toolchainsDir()], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`extracting ${kind} ${version} failed: ${result.stderr}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return toolchainPath(kind, version);
}

/** Every toolchain a build needs, downloaded in sequence. */
export async function ensureToolchains(needs: { kind: ToolchainKind; version: string | number }[], onProgress?: ProgressListener): Promise<void> {
  for (const need of needs) await ensureToolchain(need.kind, need.version, onProgress);
}

function entryFor(kind: ToolchainKind, version: string | number): ToolchainEntry {
  const entry = config[kind][String(version)];
  if (!entry) throw new Error(`no ${kind} ${version} toolchain is configured in config/toolchains.json`);
  return entry;
}

/**
 * bsdtar extracts both zip and tar.gz and ships with Windows 10+. Use the system copy explicitly: a GNU tar
 * earlier on PATH (Git Bash) cannot read zip and treats "C:" in paths as a remote host.
 */
function tarCommand(): string {
  return process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

function adoptiumOs(): string {
  return { win32: "windows", darwin: "mac", linux: "linux" }[process.platform as string] ?? process.platform;
}

function adoptiumArch(): string {
  return { x64: "x64", arm64: "aarch64" }[process.arch as string] ?? process.arch;
}
