import type { Element } from "../../elements/model.ts";
import { procedureBuild } from "../procedures.ts";
import type { GenEnv, TypeModule } from "../typeModule.ts";

/**
 * Procedures: each becomes a class with a static execute(dependencies...) method (compiled from its block IR in
 * src/procedures/), plus the shared runtime: helpers, packets for side switches, trigger registrations and
 * variable storage. Templates: layers/common/src/main/java/[javaSources.path] writes the sources.
 */
function element(procedure: Element, env: GenEnv) {
  const compiled = procedureBuild(env).compiled.get(procedure.id);
  return { segments: compiled?.segments.length ?? 0 };
}

export default {
  element,
  runtime: (_contexts, env) => {
    const build = procedureBuild(env);
    return { sources: build.sources, init: build.init, clientInit: build.clientInit };
  },
} satisfies TypeModule;
