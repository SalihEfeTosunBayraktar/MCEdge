# Java completion in code project mode (Q240)

## What runs

- **Eclipse JDT Language Server (jdtls) 1.63.0**, pinned in `config/toolchains.json` (`jdtls` entry: URL on
  download.eclipse.org, SHA-256 checked after download). It is downloaded (about 51 MB) the first time a Java file is
  opened in code mode, like the JDKs (`ensureToolchain`), and extracted to `<toolchains>/jdtls-1.63.0`.
- jdtls runs on **JDK 25** from the same toolchain mechanism (the Eclipse platform of jdtls 1.6x needs Java 25; JDK 21
  no longer starts it). The mod's Gradle import runs with the mod's own wrapper on the mod's JDK
  (`java.import.gradle.java.home`), and the mod's JDK is the project's runtime, so completion sees that target's
  Minecraft classpath (for ForgeGradle mods, the mapped Minecraft and Forge jars).
- One jdtls per open code project, started by the main process (`app/main/javaServer.ts`, `src/java/jdtls.ts`) over
  stdio with a small hand-written LSP client: didOpen/didChange (full text)/didClose, completion + resolve, hover,
  publishDiagnostics. No monaco-languageclient dependency.
- The renderer (`app/renderer/src/code/javaLanguage.ts`) maps these to Monaco: completion items, hover, error/warning
  markers. The status line under the editor shows downloading / starting / importing / ready / failed; editing never
  waits for jdtls, and when it fails the line says why.
- **Mod ids in strings** (`src/java/resourceIds.ts`, `src/java/scanResources.ts`): inside a Java string literal,
  completion offers the mod's registry ids (`modid:name`) from `src/main/resources`: blockstates, item and block models,
  texture sprites, sounds.json events, particles, recipes, loot tables, tags, advancements, lang keys
  (`item.modid.x` also gives `modid:x`), and resource paths (`modid:textures/...png`, `modid:sounds/...ogg`).
- **Side markers** (`src/java/sideCheck.ts`): client-only API (`net.minecraft.client`, `com.mojang.blaze3d`, loader
  client packages, LWJGL) used in common or server code, and dedicated-server API used in client code, are warnings
  (never errors). Client code is: a class or member with `@OnlyIn(Dist.CLIENT)` / `@Environment(EnvType.CLIENT)`, a
  client `@EventBusSubscriber`, a `ClientModInitializer`, a `client` package, or a `DistExecutor` client argument. The
  open file's side (Client / Server / Common) is a badge in the status line.

## Where data goes

- jdtls workspace and OSGi state: `<app user data>/jdtls/<hash of the project folder>/` (`workspace/`, `config/`).
  Never inside the project. The extracted jdtls folder is shared and read-only.
- Gradle caches: the user's normal Gradle home (`~/.gradle`), shared with builds.
- Eclipse metadata (`.project`, `.classpath`, `.settings`) is kept out of the mod with
  `-Djava.import.generatesMetadataFilesAtProjectRoot=false`. The Gradle import itself still runs the mod's build
  scripts, so ForgeGradle may create its usual `build/` and `run/` folders, as a build would.

## Lifecycle and limits

- jdtls stops when the code project closes, when the app quits, and after 15 minutes without Java editing (it starts
  again on the next edit and reopens the open files). Stopping ends its process tree, including the Gradle daemon the
  import started.
- RAM: jdtls is capped at `-Xmx1G`; the Gradle daemon of the import uses the mod's own `org.gradle.jvmargs`.
- The first import of a ForgeGradle mod can take several minutes: Buildship asks for source jars and ForgeGradle then
  decompiles and recompiles Minecraft once (cached in `~/.gradle` afterwards).
- Classpath completion is empty until the import is done; mod ids in strings and side markers work right away.
- Monaco is loaded as `editor.api` plus only the suggest, snippet and hover contributions; Monaco's own widget texts
  (for example "View Problem", "Loading...") stay English.
- Workspace autobuild is off: diagnostics are reported for open files only.
- The side checker reads the source text, not types: it knows client classes by package and imports, so a client
  class reached only through a method call of a common class is not flagged, and `level.isClientSide()` checks do not
  count as client code.
