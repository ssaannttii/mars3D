import { sphericalPoint } from "./topography.js";

const MARS_RADIUS_KM = 3396;
const EARTH_RADIUS_KM = 6371;

export const COMPARISONS = {
  everest: {
    target: "olympus",
    label: "Olympus Mons vs Everest",
    centerLat: 18.65,
    centerLon: 226.2,
    summary: {
      mars: { name: "Olympus Mons", height: 21900, baseDiameter: 600 },
      earth: { name: "Mt Everest", height: 8849, baseDiameter: 28 },
    },
    profile: cone(8849, 28),
  },
  grandCanyon: {
    target: "valles",
    label: "Valles Marineris vs Grand Canyon",
    centerLat: -14.0,
    centerLon: 300.0,
    summary: {
      mars: { name: "Valles Marineris", length: 4000, depth: 7000 },
      earth: { name: "Grand Canyon", length: 446, depth: 1857 },
    },
    profile: trench(446, 18, 1857),
  },
};

function cone(heightMeters, baseDiameterKm) {
  const segments = 32;
  const baseRadiusDeg = (baseDiameterKm / 2 / MARS_RADIUS_KM) * (180 / Math.PI);
  return {
    type: "cone",
    rings: [
      { offset: 0, radius: baseRadiusDeg, height: 0 },
      { offset: 0, radius: baseRadiusDeg * 0.55, height: heightMeters * 0.5 },
      { offset: 0, radius: 0, height: heightMeters },
    ],
    segments,
  };
}

function trench(lengthKm, widthKm, depthMeters) {
  const halfLenDeg = (lengthKm / 2 / MARS_RADIUS_KM) * (180 / Math.PI);
  const halfWidthDeg = (widthKm / 2 / MARS_RADIUS_KM) * (180 / Math.PI);
  return {
    type: "trench",
    halfLength: halfLenDeg,
    halfWidth: halfWidthDeg,
    depth: depthMeters,
  };
}

export function buildComparisonOverlay({ THREE, meta, state, comparison, baseHeight }) {
  const group = new THREE.Group();
  if (!comparison) return group;

  const verticalScale = state.verticalScale;
  const color = new THREE.Color("#5fe2b8");
  const lineMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: false,
  });

  if (comparison.profile.type === "cone") {
    const segments = comparison.profile.segments;
    const rings = comparison.profile.rings;
    for (const ring of rings) {
      if (ring.radius <= 0) continue;
      const pts = [];
      for (let i = 0; i <= segments; i += 1) {
        const a = (i / segments) * Math.PI * 2;
        const dLat = Math.sin(a) * ring.radius;
        const dLon = Math.cos(a) * ring.radius / Math.max(0.18, Math.cos((comparison.centerLat * Math.PI) / 180));
        const lat = comparison.centerLat + dLat;
        const lon = (comparison.centerLon + dLon + 360) % 360;
        pts.push(sphericalPoint(THREE, meta, lat, lon, baseHeight + ring.height, verticalScale));
      }
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(geom, lineMat));
    }
    // Vertical apex line
    const apex = sphericalPoint(THREE, meta, comparison.centerLat, comparison.centerLon, baseHeight + comparison.summary.earth.height, verticalScale);
    const base = sphericalPoint(THREE, meta, comparison.centerLat, comparison.centerLon, baseHeight, verticalScale);
    const apexGeom = new THREE.BufferGeometry().setFromPoints([base, apex]);
    group.add(new THREE.Line(apexGeom, lineMat));
  } else if (comparison.profile.type === "trench") {
    const halfLen = comparison.profile.halfLength;
    const halfWidth = comparison.profile.halfWidth;
    const cos = Math.max(0.18, Math.cos((comparison.centerLat * Math.PI) / 180));
    const pts = [
      [-halfLen, -halfWidth],
      [halfLen, -halfWidth],
      [halfLen, halfWidth],
      [-halfLen, halfWidth],
      [-halfLen, -halfWidth],
    ];
    const corners = pts.map(([dLon, dLat]) => {
      const lat = comparison.centerLat + dLat;
      const lon = (comparison.centerLon + dLon / cos + 360) % 360;
      return sphericalPoint(THREE, meta, lat, lon, baseHeight + 80, verticalScale);
    });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(corners), lineMat));
  }

  return group;
}

export function buildComparisonStats(comparison, lang) {
  if (!comparison) return "";
  const s = comparison.summary;
  if ("baseDiameter" in s.mars) {
    const factor = (s.mars.height / s.earth.height).toFixed(1);
    return lang === "es"
      ? `${s.mars.name}: ${(s.mars.height / 1000).toFixed(1)} km de altura (${factor}× Everest, base ${s.mars.baseDiameter} km vs ${s.earth.baseDiameter} km)`
      : `${s.mars.name}: ${(s.mars.height / 1000).toFixed(1)} km tall (${factor}× Everest, base ${s.mars.baseDiameter} km vs ${s.earth.baseDiameter} km)`;
  }
  const lenFactor = (s.mars.length / s.earth.length).toFixed(1);
  const depthFactor = (s.mars.depth / s.earth.depth).toFixed(1);
  return lang === "es"
    ? `${s.mars.name}: ${s.mars.length.toLocaleString()} km de largo, ${(s.mars.depth / 1000).toFixed(1)} km de profundidad (${lenFactor}× / ${depthFactor}× Gran Cañón)`
    : `${s.mars.name}: ${s.mars.length.toLocaleString()} km long, ${(s.mars.depth / 1000).toFixed(1)} km deep (${lenFactor}× / ${depthFactor}× Grand Canyon)`;
}
