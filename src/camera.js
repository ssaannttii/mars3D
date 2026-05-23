import { sphericalPoint } from "./topography.js";

export const CAMERA_TARGETS = {
  olympus: { label: "Olympus", lat: 18.65, lon: 226.2, distance: 2.05 },
  valles: { label: "Valles", lat: -14.0, lon: 300.0, distance: 2.25 },
  hellas: { label: "Hellas", lat: -42.4, lon: 70.5, distance: 2.2 },
  tharsis: { label: "Tharsis", lat: 0.0, lon: 248.0, distance: 2.35 },
  poles: { label: "Polos", lat: 72.0, lon: 0.0, distance: 2.45 },
};

let activeAnim = null;

export function focusCamera({ THREE, camera, controls, meta, target, smooth = true, durationMs = 1100 }) {
  const point = sphericalPoint(THREE, meta, target.lat, target.lon, 0, 1).normalize();
  const destination = point.clone().multiplyScalar(target.distance);
  if (!smooth) {
    camera.position.copy(destination);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    return;
  }
  animateTo({ camera, controls, destination, durationMs });
}

export function resetCamera(camera, controls) {
  animateTo({
    camera,
    controls,
    destination: new (camera.position.constructor)(0.35, 0.28, 3.25),
    durationMs: 900,
  });
}

function animateTo({ camera, controls, destination, durationMs }) {
  if (activeAnim) cancelAnimationFrame(activeAnim);
  const start = camera.position.clone();
  const startTime = performance.now();
  function step(now) {
    const t = Math.min(1, (now - startTime) / durationMs);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    camera.position.lerpVectors(start, destination, eased).normalize().multiplyScalar(
      start.length() * (1 - eased) + destination.length() * eased,
    );
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    if (t < 1) activeAnim = requestAnimationFrame(step);
    else activeAnim = null;
  }
  activeAnim = requestAnimationFrame(step);
}
