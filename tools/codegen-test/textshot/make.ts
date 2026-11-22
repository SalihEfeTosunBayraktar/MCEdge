/**
 * Q276: copies examples/hello to a temp dir with the text GUI (layout.ts) and prints the project path.
 *   node tools/codegen-test/textshot/make.ts
 */
import { exampleProject } from "../../ui-test/cdp.ts";
import { addElement } from "../../ui-test/fixtures.ts";
import { TEXT_GUI } from "./layout.ts";

const project = exampleProject();
addElement(project, "gui", "texttest", TEXT_GUI);
console.log(project);
