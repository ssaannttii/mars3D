import { sampleFloodMask, sampleHeight, sampleSlope, sphericalPoint, clamp, lerp, smoothstep } from "./topography.js";

export const RESOLUTIONS = {
  low: { lon: 300, lat: 150 },
  medium: { lon: 480, lat: 240 },
  high: { lon: 720, lat: 360 },
  ultra: { lon: 1440, lat: 720 },
};

const AUXILIARY_RESOLUTION = { lon: 720, lat: 360 };

export function buildTerrainGeometry({ THREE, meta, heightData, flood, state, colorTools, poleHeights }) {
  const { lon, lat } = RESOLUTIONS[state.resolution];
  const vertexCount = (lon + 1) * (lat + 1);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const heights = new Float32Array(vertexCount);
  const latitudes = new Float32Array(vertexCount);
  const longitudes = new Float32Array(vertexCount);
  const slopes = new Float32Array(vertexCount);
  const indices = new Uint32Array(lon * lat * 6);

  let vertex = 0;
  for (let y = 0; y <= lat; y += 1) {
    const latitude = 90 - (y / lat) * 180;
    for (let x = 0; x <= lon; x += 1) {
      const longitude = (x / lon) * 360;
      const height =
        y === 0
          ? poleHeights.north
          : y === lat
            ? poleHeights.south
            : sampleHeight(meta, heightData, latitude, longitude);
      const slope =
        state.resolution === "ultra"
          ? fastSlope(meta, heightData, latitude, longitude)
          : sampleSlope(meta, heightData, latitude, longitude);
      const procedural = ultraDisplacement(height, latitude, longitude, slope, state);
      const displayHeight = height + procedural;
      const position = sphericalPoint(THREE, meta, latitude, longitude, displayHeight, state.verticalScale);

      positions[vertex * 3] = position.x;
      positions[vertex * 3 + 1] = position.y;
      positions[vertex * 3 + 2] = position.z;
      heights[vertex] = height;
      latitudes[vertex] = latitude;
      longitudes[vertex] = longitude;
      slopes[vertex] = slope;
      vertex += 1;
    }
  }

  let index = 0;
  for (let y = 0; y < lat; y += 1) {
    for (let x = 0; x < lon; x += 1) {
      const a = y * (lon + 1) + x;
      const b = a + lon + 1;
      const c = b + 1;
      const d = a + 1;
      indices[index++] = a;
      indices[index++] = d;
      indices[index++] = b;
      indices[index++] = b;
      indices[index++] = d;
      indices[index++] = c;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.userData = { heights, latitudes, longitudes, slopes, lonSegments: lon, latSegments: lat };
  updateTerrainColors({ geometry, meta, flood, state, colorTools });
  geometry.computeVertexNormals();
  return geometry;
}

export function updateTerrainColors({ geometry, meta, flood, state, colorTools }) {
  const colors = geometry.getAttribute("color");
  const { heights, latitudes, longitudes, slopes } = geometry.userData;

  for (let i = 0; i < heights.length; i += 1) {
    const flooded = sampleFloodMask(meta, flood.mask, latitudes[i], longitudes[i]);
    colorTools
      .terrainColor({
        height: heights[i],
        latitude: latitudes[i],
        slope: slopes[i],
        flooded,
        seaLevel: state.seaLevel,
        minimumMeters: meta.minimumMeters,
        maximumMeters: meta.maximumMeters,
        visualMode: state.visualMode,
        softShore: state.softShore,
        snowCaps: state.snowCaps,
        polarIce: state.polarIce,
        biomes: state.biomes,
        ultraCreative: state.ultraCreative,
        ultraIntensity: state.ultraIntensity,
        procedural: ultraColorVariation(heights[i], latitudes[i], longitudes[i], slopes[i], state),
        iceExtent: state.iceExtent,
      })
      .toArray(colors.array, i * 3);
  }

  colors.needsUpdate = true;
}

function ultraDisplacement(height, latitude, longitude, slope, state) {
  if (!state.ultraCreative) return 0;

  const strength = ultraStrength(state.ultraIntensity);
  const highland = smoothstep(-2500, 9000, height);
  const rocky = 0.35 + slope * 0.55 + highland * 0.45;
  const canyonBias = smoothstep(0.35, 0.9, slope) * smoothstep(-7000, 1500, height);
  const noise =
    fbm(latitude * 0.042, longitude * 0.042, 4) * 2 -
    1 +
    (fbm(latitude * 0.16 + 11.7, longitude * 0.16 - 8.2, 4) * 2 - 1) * 0.42 +
    (fbm(latitude * 0.51 - 2.4, longitude * 0.51 + 31.6, 2) * 2 - 1) * 0.16;
  return noise * strength * rocky + canyonBias * strength * 0.58;
}

function ultraColorVariation(height, latitude, longitude, slope, state) {
  if (!state.ultraCreative) return 0;
  const strength = ultraStrength(state.ultraIntensity) / 1250;
  const grain = fbm(latitude * 0.09 - 4.1, longitude * 0.09 + 12.3, 4) * 2 - 1;
  const highland = smoothstep(-3500, 10000, height);
  return clamp(grain * strength * (0.35 + slope + highland * 0.45), -0.45, 0.45);
}

function ultraStrength(intensity) {
  if (intensity === "subtle") return 360;
  if (intensity === "extreme") return 1700;
  return 920;
}

function fastSlope(meta, heightData, latitude, longitude) {
  const lon = ((longitude % 360) + 360) % 360;
  const x = Math.min(meta.width - 1, Math.max(0, Math.floor((lon / 360) * meta.width)));
  const y = Math.min(meta.height - 1, Math.max(0, Math.floor(((90 - latitude) / 180) * meta.height)));
  const left = heightData[y * meta.width + ((x + meta.width - 1) % meta.width)];
  const right = heightData[y * meta.width + ((x + 1) % meta.width)];
  const up = heightData[Math.max(0, y - 1) * meta.width + x];
  const down = heightData[Math.min(meta.height - 1, y + 1) * meta.width + x];
  const relief = Math.max(Math.abs(right - left), Math.abs(down - up));
  return clamp(relief / 5200, 0, 1);
}

function fbm(x, y, octaves) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i += 1) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    frequency *= 2.03;
    amplitude *= 0.52;
  }
  return value;
}

function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return lerp(
    lerp(hash2(xi, yi), hash2(xi + 1, yi), u),
    lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u),
    v,
  );
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function buildWaterGeometry({ THREE, meta, heightData, flood, state, colorTools }) {
  const { lon, lat } = state.resolution === "ultra" ? AUXILIARY_RESOLUTION : RESOLUTIONS[state.resolution];
  const positions = [];
  const colors = [];
  const indices = [];
  const waterHeight = state.seaLevel + 70;

  for (let y = 0; y < lat; y += 1) {
    const top = 90 - (y / lat) * 180;
    const bottom = 90 - ((y + 1) / lat) * 180;

    for (let x = 0; x < lon; x += 1) {
      const left = (x / lon) * 360;
      const right = ((x + 1) / lon) * 360;
      const polygon = clipWaterPolygon(
        [
          makeWaterCorner(meta, heightData, flood, state, top, left),
          makeWaterCorner(meta, heightData, flood, state, top, right),
          makeWaterCorner(meta, heightData, flood, state, bottom, right),
          makeWaterCorner(meta, heightData, flood, state, bottom, left),
        ],
        state.seaLevel,
      );

      if (polygon.length < 3) continue;

      const base = positions.length / 3;
      for (const point of polygon) {
        const position = sphericalPoint(THREE, meta, point.latitude, point.longitude, waterHeight, state.verticalScale);
        positions.push(position.x, position.y, position.z);
        colorTools.waterColor({ depth: Math.max(state.seaLevel - point.height, 0), visualMode: state.visualMode }).toArray(colors, colors.length);
      }
      for (let i = 1; i < polygon.length - 1; i += 1) {
        indices.push(base, base + i, base + i + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeWaterCorner(meta, heightData, flood, state, latitude, longitude) {
  const height = sampleHeight(meta, heightData, latitude, longitude);
  return {
    latitude,
    longitude,
    height,
    wet: sampleFloodMask(meta, flood.mask, latitude, longitude) && height <= state.seaLevel,
  };
}

function clipWaterPolygon(corners, seaLevel) {
  const output = [];
  for (let i = 0; i < corners.length; i += 1) {
    const current = corners[i];
    const previous = corners[(i + corners.length - 1) % corners.length];

    if (current.wet) {
      if (!previous.wet) output.push(interpolateCoast(previous, current, seaLevel));
      output.push(current);
    } else if (previous.wet) {
      output.push(interpolateCoast(previous, current, seaLevel));
    }
  }
  return output;
}

function interpolateCoast(a, b, seaLevel) {
  const denominator = b.height - a.height;
  const t = Math.abs(denominator) < 0.001 ? 0.5 : clamp((seaLevel - a.height) / denominator, 0, 1);
  return {
    latitude: lerp(a.latitude, b.latitude, t),
    longitude: lerpLongitude(a.longitude, b.longitude, t),
    height: lerp(a.height, b.height, t),
    wet: true,
  };
}

function lerpLongitude(a, b, t) {
  let delta = b - a;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return (a + delta * t + 360) % 360;
}
