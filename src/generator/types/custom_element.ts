import { pascal, str } from "../java.ts";
import type { GenEnv, JavaSourceFile, TypeModule } from "../typeModule.ts";

/**
 * Custom elements are hand-written Java classes copied into the mod as they are. The file goes where its package
 * declaration and first top-level type say; code without a package goes to <mod package>.custom. An empty
 * element gets a stub class, the same stub the editor starts the code from.
 */

const PACKAGE = /^\s*package\s+([\w.]+)\s*;/m;
const TYPE = /^(?:public\s+|abstract\s+|final\s+|sealed\s+|non-sealed\s+)*(?:class|interface|enum|record|@interface)\s+(\w+)/m;

export function customStub(packageName: string, className: string): string {
  return `package ${packageName};

/** Custom code of this mod. MCEdge copies this file into the build as it is. */
public final class ${className} {
    private ${className}() {}
}
`;
}

function source(env: GenEnv, id: string, code: string): JavaSourceFile {
  const fallbackPackage = `${env.project.mod.package}.custom`;
  const text = code.trim() ? code : customStub(fallbackPackage, pascal(id));
  const pkg = PACKAGE.exec(text)?.[1];
  const withPackage = pkg ? text : `package ${fallbackPackage};\n\n${text}`;
  const name = TYPE.exec(withPackage)?.[1] ?? pascal(id);
  return { path: `${(pkg ?? fallbackPackage).replaceAll(".", "/")}/${name}.java`, code: withPackage };
}

export default {
  element: () => ({}),
  runtime(elements, env) {
    return { sources: elements.map((e) => source(env, String(e.id), str(e.code))) };
  },
} satisfies TypeModule;
