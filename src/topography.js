export const DATA_BIN = "./data/mars-mola-1440x720-int16le.bin";
export const DATA_META = "./data/mars-mola-1440x720.json";

export async function loadTopography() {
  const [meta, buffer] = await Promise.all([
    fetch(DATA_META).then((response) => response.json()),
    fetch(DATA_BIN).then((response) => response.arrayBuffer()),
  ]);
  const heightData = toInt16Array(buffer);
  return {
    meta,
    heightData,
    northPoleHeight: averageRowHeight(meta, heightData, 0),
    southPoleHeight: averageRowHeight(meta, heightData, meta.height - 1),
  };
}

export function toInt16Array(buffer) {
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (littleEndian) return new Int16Array(buffer);

  const view = new DataView(buffer);
  const out = new Int16Array(buffer.byteLength / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getInt16(i * 2, true);
  }
  return out;
}

export function sampleHeight(meta, heightData, latitude, longitude) {
  const lon = normalizeLongitude(longitude);
  const x = (lon / 360) * meta.width;
  const y = ((90 - latitude) / 180) * meta.height;

  const x0 = Math.floor(x) % meta.width;
  const x1 = (x0 + 1) % meta.width;
  const y0 = clamp(Math.floor(y), 0, meta.height - 1);
  const y1 = clamp(y0 + 1, 0, meta.height - 1);
  const tx = x - Math.floor(x);
  const ty = y - Math.floor(y);

  const a = gridValue(meta, heightData, x0, y0);
  const b = gridValue(meta, heightData, x1, y0);
  const c = gridValue(meta, heightData, x0, y1);
  const d = gridValue(meta, heightData, x1, y1);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

export function sampleSlope(meta, heightData, latitude, longitude) {
  const latStep = 180 / meta.height;
  const lonStep = 360 / meta.width;
  const hNorth = sampleHeight(meta, heightData, clamp(latitude + latStep, -90, 90), longitude);
  const hSouth = sampleHeight(meta, heightData, clamp(latitude - latStep, -90, 90), longitude);
  const hEast = sampleHeight(meta, heightData, latitude, longitude + lonStep);
  const hWest = sampleHeight(meta, heightData, latitude, longitude - lonStep);
  const relief = Math.max(Math.abs(hNorth - hSouth), Math.abs(hEast - hWest));
  return clamp(relief / 5200, 0, 1);
}

export function sampleFloodMask(meta, mask, latitude, longitude) {
  const lon = normalizeLongitude(longitude);
  const x = clamp(Math.floor((lon / 360) * meta.width), 0, meta.width - 1);
  const y = clamp(Math.floor(((90 - latitude) / 180) * meta.height), 0, meta.height - 1);
  return mask[y * meta.width + x] === 1;
}

export function sphericalPoint(THREE, meta, latitude, longitude, heightMeters, verticalScale) {
  const radius = 1 + (heightMeters / meta.marsRadiusMeters) * verticalScale;
  const phi = THREE.MathUtils.degToRad(90 - latitude);
  const theta = THREE.MathUtils.degToRad(longitude - 180);
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

export function averageRowHeight(meta, heightData, row) {
  let total = 0;
  const offset = row * meta.width;
  for (let x = 0; x < meta.width; x += 1) {
    total += heightData[offset + x];
  }
  return total / meta.width;
}

export function gridValue(meta, heightData, x, y) {
  return heightData[y * meta.width + x];
}

export function normalizeLongitude(longitude) {
  return ((longitude % 360) + 360) % 360;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
