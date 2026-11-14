/** KUYRUK #111 (audit U12): does Escape close the New element popup and the Export mod jar dialog? Prints, never fails. */
import { exampleProject, launchApp } from "./cdp.ts";

const app = await launchApp({ project: exampleProject() });
try {
  await app.waitFor(`document.querySelector(".tiles .tile")`);
  await app.click(".view .actions .abtn.primary");
  await app.waitFor(`document.querySelector(".addpop")`);
  await app.key("Escape");
  await app.sleep(300);
  console.log(`New popup open after Escape: ${await app.eval<boolean>(`!!document.querySelector(".addpop")`)}`);
  await app.click(".view .actions .abtn.primary");
  await app.sleep(200);
  await app.key("e", 2);
  await app.waitFor(`document.querySelector(".dialog")`);
  await app.key("Escape");
  await app.sleep(300);
  console.log(`Export dialog open after Escape: ${await app.eval<boolean>(`!!document.querySelector(".dialog")`)}`);
  // Escape sent while focus is inside the dialog.
  await app.eval(`document.querySelector(".dialog input, .dialog button")?.focus()`);
  await app.key("Escape");
  await app.sleep(300);
  console.log(`Export dialog open after Escape with focus inside: ${await app.eval<boolean>(`!!document.querySelector(".dialog")`)}`);
} finally {
  await app.close();
}
