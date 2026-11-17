// ---------------------------------------------------------------------------
// Entry point for the low-poly 3D look, loaded on demand by game.js with
// import(), so players on the classic look never download Three.js.
// ---------------------------------------------------------------------------
import { Stage, LowPolyRenderer, LENSES } from "./renderer.js";

let stage = null;

export { LENSES };

// Throws when WebGL isn't available, so the game can fall back to classic.
export function createRenderer(city, viewport, canvas, opts) {
  if (!stage) stage = new Stage(canvas);
  return new LowPolyRenderer(city, stage, viewport, opts);
}

export function projector(viewport) {
  return stage ? stage.projector(viewport) : null;
}

export function onQuality(fn) {
  if (stage) stage.onQuality = fn;
}
