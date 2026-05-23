import { clamp, smoothstep } from "./topography.js";

const palette = {
  earth: {
    water: [
      [0.0, "#7ce7df"],
      [0.34, "#1a9db4"],
      [1.0, "#05284f"],
    ],
    land: [
      [0.0, "#2c536f"],
      [0.22, "#4a8170"],
      [0.42, "#8c9060"],
      [0.62, "#b78153"],
      [0.82, "#d2b06b"],
      [1.0, "#ead7ad"],
    ],
  },
  mars: {
    water: [
      [0.0, "#58cfd8"],
      [0.45, "#1684a2"],
      [1.0, "#071e3c"],
    ],
    land: [
      [0.0, "#243a55"],
      [0.24, "#4c625d"],
      [0.46, "#8a6c52"],
      [0.66, "#b4623f"],
      [0.84, "#c99055"],
      [1.0, "#e8d199"],
    ],
  },
  atlas: {
    water: [
      [0.0, "#91dce0"],
      [0.38, "#3b8fb0"],
      [1.0, "#223f70"],
    ],
    land: [
      [0.0, "#455e72"],
      [0.22, "#6c8e74"],
      [0.42, "#a4a36c"],
      [0.62, "#c58f55"],
      [0.82, "#d8bd75"],
      [1.0, "#f0dfbd"],
    ],
  },
};

const scratch = {};

export function createColorTools(THREE) {
  scratch.temp = new THREE.Color();
  scratch.mix = new THREE.Color();
  scratch.shore = new THREE.Color("#d7c9a2");
  scratch.dryBasin = new THREE.Color("#473632");
  scratch.snow = new THREE.Color("#f2f7f2");
  scratch.snowShadow = new THREE.Color("#c7d7d4");
  scratch.polarIce = new THREE.Color("#e6f2ef");
  scratch.green = new THREE.Color("#5f986d");
  scratch.desert = new THREE.Color("#c79a5a");
  scratch.rock = new THREE.Color("#78665a");
  scratch.shadow = new THREE.Color("#28313a");
  scratch.light = new THREE.Color("#fff0bc");

  return {
    terrainColor: (input) => terrainColor(input),
    waterColor: (input) => waterColor(input),
  };
}

function terrainColor({
  height,
  latitude,
  slope,
  flooded,
  seaLevel,
  minimumMeters,
  maximumMeters,
  visualMode,
  softShore,
  snowCaps,
  polarIce,
  biomes,
  procedural,
}) {
  const mode = palette[visualMode] ? visualMode : "earth";
  if (flooded) {
    const depth = clamp((seaLevel - height) / 14000, 0, 1);
    const water = ramp(palette[mode].water, depth);
    if (!softShore) return water;
    const shallow = 1 - smoothstep(0, 300, seaLevel - height);
    return scratch.mix.copy(water).lerp(scratch.shore, shallow * 0.44);
  }

  const t = clamp((height - minimumMeters) / (maximumMeters - minimumMeters), 0, 1);
  let color = ramp(palette[mode].land, t);
  color = applyBiomes(color, { height, latitude, seaLevel, slope, biomes, visualMode: mode });
  color = applyProceduralColor(color, procedural);
  color = applySnowAndIce(color, { height, latitude, slope, snowCaps, polarIce, visualMode: mode });

  if (!softShore) return color;

  const aboveSea = height - seaLevel;
  if (aboveSea >= 0 && aboveSea < 1200) {
    const beach = 1 - smoothstep(300, 1200, aboveSea);
    return scratch.mix.copy(color).lerp(scratch.shore, beach * 0.5);
  }
  if (height < seaLevel) {
    return scratch.mix.copy(color).lerp(scratch.dryBasin, 0.42);
  }
  return color;
}

function applyBiomes(color, { height, latitude, seaLevel, slope, biomes, visualMode }) {
  if (!biomes || visualMode === "mars") return color;

  const absLat = Math.abs(latitude);
  const aboveSea = height - seaLevel;
  const coastalWet = 1 - smoothstep(300, 4200, Math.max(aboveSea, 0));
  const temperate = 1 - smoothstep(34, 74, absLat);
  const tropicDry = smoothstep(4, 27, absLat) * (1 - smoothstep(33, 48, absLat));
  const interiorDry = smoothstep(1800, 7600, aboveSea) * (1 - coastalWet * 0.7);
  const highRock = smoothstep(4500, 9500, height) * (0.4 + slope * 0.6);

  let result = scratch.mix.copy(color);
  result.lerp(scratch.green, coastalWet * temperate * 0.28);
  result.lerp(scratch.desert, clamp(tropicDry * 0.2 + interiorDry * 0.28, 0, 0.42));
  result.lerp(scratch.rock, highRock * 0.24);
  return result;
}

function applyProceduralColor(color, procedural) {
  if (!procedural) return color;
  if (procedural > 0) return scratch.mix.copy(color).lerp(scratch.light, clamp(procedural, 0, 0.24));
  return scratch.mix.copy(color).lerp(scratch.shadow, clamp(-procedural, 0, 0.24));
}

function applySnowAndIce(color, { height, latitude, slope, snowCaps, polarIce, visualMode }) {
  let result = color;

  if (snowCaps) {
    const flatness = 1 - clamp(slope, 0, 1);
    const snowAmount = smoothstep(6200, 12500, height) * (0.48 + flatness * 0.52);
    if (snowAmount > 0) {
      const shadowAmount = smoothstep(6200, 15000, height) * 0.18;
      result = scratch.mix.copy(result).lerp(scratch.snowShadow, shadowAmount).lerp(scratch.snow, snowAmount * 0.86);
    }
  }

  if (polarIce && snowCaps) {
    const latitudeAmount = smoothstep(70, 88, Math.abs(latitude));
    const altitudeBias = visualMode === "earth" ? 0.85 : 0.5;
    if (latitudeAmount > 0) {
      result = scratch.mix.copy(result).lerp(scratch.polarIce, latitudeAmount * altitudeBias);
    }
  }

  return result;
}

function waterColor({ depth, visualMode }) {
  const mode = palette[visualMode] ? visualMode : "earth";
  return ramp(palette[mode].water, clamp(depth / 14000, 0, 1));
}

function ramp(stops, t) {
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [leftT, leftColor] = stops[i];
    const [rightT, rightColor] = stops[i + 1];
    if (t >= leftT && t <= rightT) {
      const localT = (t - leftT) / (rightT - leftT);
      return scratch.temp.set(leftColor).lerp(new scratch.temp.constructor(rightColor), localT);
    }
  }
  return scratch.temp.set(stops[stops.length - 1][1]);
}
