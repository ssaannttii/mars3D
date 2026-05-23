import { sphericalPoint } from "./topography.js";

export const CAMERA_TARGETS = {
  olympus: { label: "Olympus", lat: 18.65, lon: 226.2, distance: 2.05 },
  valles: { label: "Valles", lat: -14.0, lon: 300.0, distance: 2.25 },
  hellas: { label: "Hellas", lat: -42.4, lon: 70.5, distance: 2.2 },
  tharsis: { label: "Tharsis", lat: 0.0, lon: 248.0, distance: 2.35 },
  poles: { label: "Polos", lat: 72.0, lon: 0.0, distance: 2.45 },
};

export function focusCamera({ THREE, camera, controls, meta, target }) {
  const point = sphericalPoint(THREE, meta, target.lat, target.lon, 0, 1).normalize();
  const position = point.clone().multiplyScalar(target.distance);
  camera.position.copy(position);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();
}

export function resetCamera(camera, controls) {
  camera.position.set(0.35, 0.28, 3.25);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();
}
