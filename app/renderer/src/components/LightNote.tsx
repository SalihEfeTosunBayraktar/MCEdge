import { t } from "../strings.ts";

/** Stands where a 3D view would be while light mode has 3D off (Q250); no canvas, no WebGL context. */
export function LightNote() {
  return <p className="hint lightnote" data-testid="light-note">{t("perf.render3dOff")}</p>;
}
