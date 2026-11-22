import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * Releases the orbit controls and the renderer of a preview stage (Q280).
 *
 * OrbitControls puts a keydown listener on `domElement.getRootNode()` and takes it off the same way. React runs the
 * cleanup of an effect after the stage's DOM left the page, when the canvas's root is its detached parent, so the
 * listener stayed on the document and held the whole editor page in memory: ~4,000 DOM nodes per opened block
 * editor. The canvas goes back into the page for the dispose call. The renderer also gives its WebGL context back at once.
 */
export function disposeStage(controls: OrbitControls[], renderer: THREE.WebGLRenderer): void {
  const canvas = renderer.domElement;
  if (!canvas.isConnected) document.body.appendChild(canvas);
  controls.forEach((c) => c.dispose());
  canvas.remove();
  renderer.dispose();
  renderer.forceContextLoss();
}
