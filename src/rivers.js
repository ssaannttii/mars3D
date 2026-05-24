import { clamp, sampleFloodMask, sampleHeight, sphericalPoint, smoothstep } from "./topography.js";

const GRID_WIDTH = 1080;
const GRID_HEIGHT = 540;
const MAIN_THRESHOLD = 22;
const TRIBUTARY_THRESHOLD = 8;
const MIN_RIVER_KM = 220;
const MAX_RIVERS = 240;
const LAKE_MIN_CELLS = 28;
const LAKE_MAX = 60;

let cachedGrid = null;

export function simulateRivers({ meta, heightData, flood, state }) {
  if (!state.riversVisible) return emptyResult();

  const grid = ensureGrid(meta, heightData);
  const ocean = new Uint8Array(grid.total);
  const wet = new Uint8Array(grid.total);
  buildWetMask(meta, flood, grid, wet);
  markLargestWaterBody(wet, ocean);

  const { filled, oceanDistance } = priorityFloodToOcean(grid.heights, ocean);
  const flowTo = routeFlowsToOcean(grid.heights, filled, ocean);
  const slopes = grid.slopes;
  const source = makeMeltSources(grid.heights, slopes, ocean, wet, state, grid);
  const discharge = accumulateDischarge(source, filled, flowTo);
  const lakes = state.tributariesVisible ? extractLakes(grid.heights, filled, ocean, discharge) : [];
  const rivers = extractRivers({
    heights: grid.heights,
    filled,
    discharge,
    flowTo,
    ocean,
    wet,
    oceanDistance,
    state,
    grid,
  });
  const deltas = buildDeltas(rivers, grid, ocean, filled);

  return {
    rivers,
    lakes,
    deltas,
    stats: summarize(rivers, lakes),
  };
}

export function buildRiverGeometry({ THREE, meta, rivers, lakes, deltas, state, colorTools, heightSampler }) {
  const lakePositions = [];
  const lakeColors = [];
  const lakeIndices = [];

  for (const lake of lakes || []) {
    if (heightSampler) {
      const centerH = heightSampler(lake.centerLat, lake.centerLon);
      if (centerH > lake.surface + 80) continue;
    }
    appendLake({ THREE, meta, lake, state, positions: lakePositions, colors: lakeColors, indices: lakeIndices, colorTools });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lakePositions), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(lakeColors), 3));
  geometry.setIndex(lakeIndices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildRiverLines({ THREE, meta, rivers, state, colorTools, heightSampler }) {
  const positions = [];
  const colors = [];
  const baseColor = colorTools.waterColor({ depth: 1600, visualMode: state.visualMode }).clone();

  for (const river of rivers || []) {
    if (river.points.length < 2) continue;
    for (let i = 0; i < river.points.length - 1; i += 1) {
      const a = river.points[i];
      const b = river.points[i + 1];
      const ha = pointGroundHeight(a, state, heightSampler);
      const hb = pointGroundHeight(b, state, heightSampler);
      const pa = sphericalPoint(THREE, meta, a.lat, a.lon, ha, state.verticalScale);
      const pb = sphericalPoint(THREE, meta, b.lat, b.lon, hb, state.verticalScale);
      positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
      const t = clamp(a.discharge / Math.max(river.maxDischarge, 1), 0, 1);
      const depth = 320 + Math.sqrt(a.discharge) * 280;
      const colA = baseColor.clone().lerp(colorTools.waterColor({ depth, visualMode: state.visualMode }), 0.7 + t * 0.25);
      colA.toArray(colors, colors.length);
      colA.toArray(colors, colors.length);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
  return geometry;
}

function pointGroundHeight(point, state, heightSampler) {
  const sea = state.seaLevel || 0;
  const sampled = heightSampler ? heightSampler(point.lat, point.lon) : point.height;
  const groundHeight = Math.max(sampled, point.height);
  if (groundHeight < sea - 50) return sea + 25;
  return groundHeight + 8;
}

function ensureGrid(meta, heightData) {
  if (cachedGrid && cachedGrid.meta === meta) return cachedGrid;
  const total = GRID_WIDTH * GRID_HEIGHT;
  const heights = new Float32Array(total);
  const slopes = new Float32Array(total);

  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    const latitude = rowLatitude(y);
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      heights[index(x, y)] = sampleHeight(meta, heightData, latitude, colLongitude(x));
    }
  }
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const left = heights[index((x + GRID_WIDTH - 1) % GRID_WIDTH, y)];
      const right = heights[index((x + 1) % GRID_WIDTH, y)];
      const up = heights[index(x, Math.max(0, y - 1))];
      const down = heights[index(x, Math.min(GRID_HEIGHT - 1, y + 1))];
      slopes[index(x, y)] = clamp(Math.max(Math.abs(right - left), Math.abs(down - up)) / 6200, 0, 1);
    }
  }
  cachedGrid = { meta, heights, slopes, total };
  return cachedGrid;
}

function buildWetMask(meta, flood, grid, wet) {
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    const latitude = rowLatitude(y);
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      wet[index(x, y)] = sampleFloodMask(meta, flood.mask, latitude, colLongitude(x)) ? 1 : 0;
    }
  }
}

function priorityFloodToOcean(heights, ocean) {
  const total = heights.length;
  const filled = new Float32Array(total);
  const visited = new Uint8Array(total);
  const oceanDistance = new Uint16Array(total);
  const heap = new MinHeap();

  for (let i = 0; i < total; i += 1) {
    filled[i] = Infinity;
    if (ocean[i]) {
      filled[i] = heights[i];
      visited[i] = 1;
      heap.push(i, filled[i]);
    }
  }

  while (heap.size > 0) {
    const current = heap.pop();
    const { x, y } = xy(current);
    forEachNeighbor(x, y, (next) => {
      if (visited[next]) return;
      visited[next] = 1;
      filled[next] = Math.max(heights[next], filled[current] + 0.02);
      oceanDistance[next] = Math.min(65535, oceanDistance[current] + 1);
      heap.push(next, filled[next]);
    });
  }

  return { filled, oceanDistance };
}

function routeFlowsToOcean(heights, filled, ocean) {
  const flowTo = new Int32Array(heights.length);
  flowTo.fill(-1);

  for (let i = 0; i < heights.length; i += 1) {
    if (ocean[i] || !Number.isFinite(filled[i])) continue;
    const { x, y } = xy(i);
    let best = -1;
    let bestScore = Infinity;
    forEachNeighbor(x, y, (next) => {
      if (!Number.isFinite(filled[next])) return;
      const spillDrop = filled[i] - filled[next];
      if (spillDrop < -0.001) return;
      const reliefDrop = heights[i] - heights[next];
      const diagonalPenalty = isDiagonal(i, next) ? 0.014 : 0;
      const waterBonus = ocean[next] ? -0.55 : 0;
      const score = filled[next] - Math.max(0, reliefDrop) * 0.0011 + diagonalPenalty + waterBonus + hashCell(next) * 0.004;
      if (score < bestScore) {
        bestScore = score;
        best = next;
      }
    });
    flowTo[i] = best;
  }

  return flowTo;
}

function accumulateDischarge(source, filled, flowTo) {
  const order = Array.from({ length: source.length }, (_, i) => i).sort((a, b) => filled[b] - filled[a]);
  const discharge = new Float32Array(source);
  for (const i of order) {
    const next = flowTo[i];
    if (next >= 0) discharge[next] += discharge[i] * 0.995;
  }
  return discharge;
}

function makeMeltSources(heights, slopes, ocean, wet, state, grid) {
  const source = new Float32Array(heights.length);
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    const latitude = rowLatitude(y);
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const i = index(x, y);
      if (ocean[i] || wet[i]) continue;
      const height = heights[i];
      const slope = slopes[i];
      const snowLine = state.snowCaps ? 5400 : 8200;
      const snow = smoothstep(snowLine, 13500, height);
      const polar = state.polarIce ? smoothstep(66, 88, Math.abs(latitude)) * smoothstep(-1800, 6200, height) * 0.32 : 0;
      const orographic = smoothstep(1500, 9500, height) * (0.12 + slope * 0.38);
      const temperate = 1 - smoothstep(42, 84, Math.abs(latitude));
      source[i] = (snow * (2.0 + slope * 1.5) + polar + orographic * temperate) * 1.7;
    }
  }
  return source;
}

function extractLakes(heights, filled, ocean, discharge) {
  const lakes = [];
  const visited = new Uint8Array(heights.length);
  for (let i = 0; i < heights.length; i += 1) {
    if (visited[i] || ocean[i]) continue;
    const depth = filled[i] - heights[i];
    if (depth < 25) continue;
    if (discharge[i] < 6) continue;
    const lake = floodLake(i, heights, filled, ocean, visited);
    if (lake.cells.length >= LAKE_MIN_CELLS) {
      lakes.push(lake);
      if (lakes.length >= LAKE_MAX) break;
    }
  }
  lakes.sort((a, b) => b.cells.length - a.cells.length);
  return lakes.slice(0, LAKE_MAX);
}

function floodLake(start, heights, filled, ocean, visited) {
  const cells = [];
  const queue = [start];
  visited[start] = 1;
  const surface = filled[start];
  while (queue.length > 0) {
    const current = queue.pop();
    cells.push(current);
    const { x, y } = xy(current);
    forEachNeighbor4(x, y, (next) => {
      if (visited[next] || ocean[next]) return;
      const depth = filled[next] - heights[next];
      if (depth < 8) return;
      if (Math.abs(filled[next] - surface) > 35) return;
      visited[next] = 1;
      queue.push(next);
    });
  }
  let sumLat = 0;
  let sumLon = 0;
  let lonRef = null;
  for (const cell of cells) {
    const { x, y } = xy(cell);
    sumLat += rowLatitude(y);
    const lon = colLongitude(x);
    if (lonRef === null) lonRef = lon;
    let delta = lon - lonRef;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    sumLon += lonRef + delta;
  }
  return {
    cells,
    centerLat: sumLat / cells.length,
    centerLon: wrapLongitude(sumLon / cells.length),
    surface,
  };
}

function extractRivers({ heights, filled, discharge, flowTo, ocean, wet, oceanDistance, state, grid }) {
  const used = new Uint8Array(heights.length);
  const threshold = state.tributariesVisible ? TRIBUTARY_THRESHOLD : MAIN_THRESHOLD;
  const starts = [];
  for (let i = 0; i < heights.length; i += 1) {
    if (ocean[i] || wet[i]) continue;
    if (discharge[i] < threshold) continue;
    if (oceanDistance[i] <= 3) continue;
    if (!isChannelHead(i, discharge, flowTo, threshold)) continue;
    starts.push(i);
  }
  starts.sort((a, b) => discharge[b] - discharge[a]);

  const rivers = [];
  for (const start of starts) {
    if (used[start]) continue;
    const river = traceRiver(start, {
      heights,
      filled,
      discharge,
      flowTo,
      ocean,
      used,
      includeTributaries: state.tributariesVisible,
    });
    if (river && river.lengthKm >= MIN_RIVER_KM) rivers.push(river);
    if (rivers.length >= MAX_RIVERS) break;
  }

  rivers.sort((a, b) => b.maxDischarge - a.maxDischarge);
  return rivers.slice(0, state.tributariesVisible ? 140 : 48);
}

function traceRiver(start, context) {
  const { heights, filled, discharge, flowTo, ocean, used, includeTributaries } = context;
  const points = [];
  const seen = new Set();
  let current = start;
  let lengthKm = 0;
  let maxDischarge = discharge[start];
  let outlet = false;
  let outletCell = -1;

  for (let step = 0; step < 2200; step += 1) {
    if (current < 0 || seen.has(current)) break;
    seen.add(current);
    const { x, y } = xy(current);
    points.push({
      lat: rowLatitude(y),
      lon: colLongitude(x),
      height: heights[current],
      filled: filled[current],
      discharge: discharge[current],
    });
    maxDischarge = Math.max(maxDischarge, discharge[current]);
    if (includeTributaries || discharge[current] >= MAIN_THRESHOLD) used[current] = 1;

    const next = flowTo[current];
    if (next < 0) break;
    lengthKm += cellDistanceKm(current, next);
    if (ocean[next]) {
      const end = xy(next);
      points.push({
        lat: rowLatitude(end.y),
        lon: colLongitude(end.x),
        height: heights[next],
        filled: filled[next],
        discharge: discharge[current],
      });
      outlet = true;
      outletCell = next;
      break;
    }
    current = next;
  }

  if (!outlet || points.length < 7) return null;
  const natural = naturalizeRiverPath(points, maxDischarge, hash2(xy(start).x, xy(start).y));
  const smooth = chaikin(natural, 3);
  const estimatedWidthKm = hackWidthKm(maxDischarge);
  const avgDischarge = points.reduce((sum, point) => sum + point.discharge, 0) / points.length;
  return {
    points: smooth,
    lengthKm,
    maxDischarge,
    avgDischarge,
    estimatedWidthKm,
    outlet,
    outletCell,
    seed: hash2(xy(start).x, xy(start).y) * Math.PI * 2,
  };
}

function hackWidthKm(maxDischarge) {
  return clamp(0.08 + Math.pow(Math.max(maxDischarge, 1), 0.55) * 0.18, 0.08, 9);
}

function buildDeltas(rivers, grid, ocean, filled) {
  const deltas = [];
  for (const river of rivers) {
    if (river.maxDischarge < 80 || river.outletCell < 0) continue;
    const { x, y } = xy(river.outletCell);
    const last = river.points[river.points.length - 1];
    const prev = river.points[Math.max(0, river.points.length - 6)];
    const dLat = last.lat - prev.lat;
    const dLon = normalizeDeltaLongitude(last.lon - prev.lon);
    const length = Math.hypot(dLat, dLon);
    if (length < 0.0001) continue;
    const baseDir = { lat: dLat / length, lon: dLon / length };

    const radius = clamp(0.5 + Math.sqrt(river.maxDischarge) * 0.085, 0.4, 3.5);
    const fingerCount = 3 + Math.min(5, Math.floor(Math.sqrt(river.maxDischarge) * 0.22));
    const fingers = [];
    for (let f = 0; f < fingerCount; f += 1) {
      const spread = (f - (fingerCount - 1) / 2) / Math.max(1, fingerCount - 1);
      const angle = spread * 0.95;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const fingerDir = {
        lat: baseDir.lat * cos - baseDir.lon * sin,
        lon: baseDir.lat * sin + baseDir.lon * cos,
      };
      const fingerLength = radius * (0.55 + Math.random() * 0.55);
      fingers.push({
        baseLat: last.lat,
        baseLon: last.lon,
        tipLat: clamp(last.lat + fingerDir.lat * fingerLength, -89, 89),
        tipLon: wrapLongitude(last.lon + fingerDir.lon * fingerLength),
        widthKm: river.estimatedWidthKm * (0.4 + 0.3 * (1 - Math.abs(spread))),
      });
    }
    deltas.push({ fingers, color: river.maxDischarge });
  }
  return deltas;
}

function appendRiverRibbon({ THREE, meta, river, state, positions, colors, indices, baseColor, colorTools }) {
  if (river.points.length < 2) return;

  for (let i = 0; i < river.points.length; i += 1) {
    const point = river.points[i];
    const prev = river.points[Math.max(0, i - 1)];
    const next = river.points[Math.min(river.points.length - 1, i + 1)];
    const prevPos = sphericalPoint(THREE, meta, prev.lat, prev.lon, displayRiverHeight(prev, state), state.verticalScale);
    const nextPos = sphericalPoint(THREE, meta, next.lat, next.lon, displayRiverHeight(next, state), state.verticalScale);
    const tangent = nextPos.sub(prevPos).normalize();
    const center = sphericalPoint(THREE, meta, point.lat, point.lon, displayRiverHeight(point, state), state.verticalScale);
    const normal = center.clone().normalize();
    const side = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const progress = i / Math.max(1, river.points.length - 1);
    const sourceFade = smoothstep(0, 0.05, progress);
    const mouthFade = 1 - smoothstep(0.92, 1, progress);
    const widthGrowth = 0.4 + 0.6 * progress;
    const width = riverWidthWorld(point.discharge) * sourceFade * mouthFade * widthGrowth;
    const meander = Math.sin(progress * Math.PI * 7.0 + river.seed) * width * 0.18 + Math.sin(progress * Math.PI * 16.0 + river.seed * 0.37) * width * 0.07;
    center.addScaledVector(side, meander);

    const left = center.clone().addScaledVector(side, width);
    const right = center.clone().addScaledVector(side, -width);
    const base = positions.length / 3;
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);

    const t = clamp(point.discharge / Math.max(river.maxDischarge, 1), 0, 1);
    const depth = 360 + Math.sqrt(point.discharge) * 280;
    const merge = smoothstep(0.85, 1, progress);
    const waterColor = colorTools.waterColor({ depth, visualMode: state.visualMode }).clone();
    const outletColor = colorTools.waterColor({ depth: Math.max(state.seaLevel - point.height, 0), visualMode: state.visualMode }).clone();
    const color = baseColor.clone().lerp(waterColor, 0.82 + t * 0.12).lerp(outletColor, merge);
    color.toArray(colors, colors.length);
    color.toArray(colors, colors.length);

    if (i > 0) {
      indices.push(base - 2, base - 1, base, base, base - 1, base + 1);
    }
  }
}

function appendDelta({ THREE, meta, delta, state, positions, colors, indices, colorTools, heightSampler }) {
  for (const finger of delta.fingers) {
    const segments = 6;
    let prevLeft = null;
    let prevRight = null;
    let prevValid = false;
    for (let s = 0; s <= segments; s += 1) {
      const t = s / segments;
      const lat = finger.baseLat + (finger.tipLat - finger.baseLat) * t;
      let lonDelta = finger.tipLon - finger.baseLon;
      if (lonDelta > 180) lonDelta -= 360;
      if (lonDelta < -180) lonDelta += 360;
      const lon = wrapLongitude(finger.baseLon + lonDelta * t);
      const localHeight = heightSampler ? heightSampler(lat, lon) : -Infinity;
      const overWater = localHeight < state.seaLevel + 5;
      if (!overWater) {
        prevValid = false;
        continue;
      }
      const elev = state.seaLevel + 40;
      const center = sphericalPoint(THREE, meta, lat, lon, elev, state.verticalScale);
      const next = sphericalPoint(THREE, meta, lat + 0.02, lon, elev, state.verticalScale);
      const tangent = next.sub(center).normalize();
      const normal = center.clone().normalize();
      const side = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      const width = (finger.widthKm / 3396) * (1 + t * 1.4) * 0.012;
      const left = center.clone().addScaledVector(side, width);
      const right = center.clone().addScaledVector(side, -width);
      const base = positions.length / 3;
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      const color = colorTools.waterColor({ depth: 600 * (1 - t), visualMode: state.visualMode });
      color.toArray(colors, colors.length);
      color.toArray(colors, colors.length);
      if (prevValid) {
        indices.push(base - 2, base - 1, base, base, base - 1, base + 1);
      }
      prevLeft = left;
      prevRight = right;
      prevValid = true;
    }
  }
}

function appendLake({ THREE, meta, lake, state, positions, colors, indices, colorTools }) {
  const cells = lake.cells;
  if (cells.length < 6) return;
  const radiusKm = Math.sqrt(cells.length) * 11.5;
  const radius = radiusKm / 3396;
  const centerColor = colorTools.waterColor({ depth: 800, visualMode: state.visualMode });

  const elev = lake.surface + 55;
  const center = sphericalPoint(THREE, meta, lake.centerLat, lake.centerLon, elev, state.verticalScale);
  const normal = center.clone().normalize();
  const tmp = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(normal, tmp).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

  const baseIndex = positions.length / 3;
  positions.push(center.x, center.y, center.z);
  centerColor.toArray(colors, colors.length);

  const segments = 22;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const wobble = 0.78 + 0.22 * Math.sin(angle * 3 + lake.centerLon);
    const px = Math.cos(angle) * radius * wobble;
    const py = Math.sin(angle) * radius * wobble;
    const point = center.clone()
      .addScaledVector(tangent, px)
      .addScaledVector(bitangent, py);
    positions.push(point.x, point.y, point.z);
    centerColor.toArray(colors, colors.length);
  }
  for (let i = 0; i < segments; i += 1) {
    const a = baseIndex + 1 + i;
    const b = baseIndex + 1 + ((i + 1) % segments);
    indices.push(baseIndex, a, b);
  }
}

function displayRiverHeight(point, state) {
  if (!state) return point.height + 10;
  const sea = state.seaLevel || 0;
  const overWater = point.height < sea - 50;
  if (overWater) return sea + 45;
  return point.height + 10;
}

function markLargestWaterBody(wet, ocean) {
  const visited = new Uint8Array(wet.length);
  const queue = new Int32Array(wet.length);
  let bestCells = [];

  for (let start = 0; start < wet.length; start += 1) {
    if (!wet[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    const cells = [];
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const current = queue[head++];
      cells.push(current);
      const { x, y } = xy(current);
      forEachNeighbor4(x, y, (next) => {
        if (visited[next] || !wet[next]) return;
        visited[next] = 1;
        queue[tail++] = next;
      });
    }
    if (cells.length > bestCells.length) bestCells = cells;
  }

  for (const i of bestCells) ocean[i] = 1;
}

function isChannelHead(i, discharge, flowTo, threshold) {
  const { x, y } = xy(i);
  let upstream = 0;
  forEachNeighbor(x, y, (next) => {
    if (flowTo[next] === i && discharge[next] >= threshold * 0.8) upstream += 1;
  });
  return upstream === 0;
}

function chaikin(points, iterations) {
  let output = points;
  for (let iter = 0; iter < iterations; iter += 1) {
    const next = [output[0]];
    for (let i = 0; i < output.length - 1; i += 1) {
      const a = output[i];
      const b = output[i + 1];
      next.push(interpolatePoint(a, b, 0.25), interpolatePoint(a, b, 0.75));
    }
    next.push(output[output.length - 1]);
    output = next;
  }
  return output;
}

function naturalizeRiverPath(points, maxDischarge, seed01) {
  if (points.length < 5) return points;
  const seed = seed01 * Math.PI * 2;
  return points.map((point, i) => {
    if (i === 0 || i === points.length - 1) return point;
    const prev = points[Math.max(0, i - 2)];
    const next = points[Math.min(points.length - 1, i + 2)];
    const latitude = clamp(point.lat, -88, 88);
    const cosLat = Math.max(0.24, Math.cos((latitude * Math.PI) / 180));
    const dLat = next.lat - prev.lat;
    const dLon = normalizeDeltaLongitude(next.lon - prev.lon) * cosLat;
    const length = Math.hypot(dLat, dLon);
    if (length < 0.0001) return point;

    const normalLat = -dLon / length;
    const normalLon = dLat / length / cosLat;
    const progress = i / (points.length - 1);
    const endpointFade = Math.sin(progress * Math.PI);
    const localDrop = Math.abs(next.filled - prev.filled);
    const lowSlope = 1 - smoothstep(180, 1800, localDrop);
    const dischargeShape = clamp(Math.sqrt(point.discharge) / Math.sqrt(Math.max(maxDischarge, 1)), 0.25, 1);
    const amplitude = clamp((0.028 + Math.sqrt(maxDischarge) * 0.0028) * (0.4 + lowSlope * 0.95) * dischargeShape, 0.018, 0.24);
    const wave =
      Math.sin(progress * Math.PI * (4.5 + seed01 * 4.5) + seed) * 0.72 +
      Math.sin(progress * Math.PI * (11.0 + seed01 * 3.0) + seed * 0.31) * 0.28;
    const offset = amplitude * wave * Math.pow(endpointFade, 0.7);

    return {
      ...point,
      lat: clamp(point.lat + normalLat * offset, -89.6, 89.6),
      lon: wrapLongitude(point.lon + normalLon * offset),
    };
  });
}

function interpolatePoint(a, b, t) {
  let lonDelta = b.lon - a.lon;
  if (lonDelta > 180) lonDelta -= 360;
  if (lonDelta < -180) lonDelta += 360;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: (a.lon + lonDelta * t + 360) % 360,
    height: a.height + (b.height - a.height) * t,
    filled: a.filled + (b.filled - a.filled) * t,
    discharge: a.discharge + (b.discharge - a.discharge) * t,
  };
}

function normalizeDeltaLongitude(delta) {
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}

function summarize(rivers, lakes) {
  if (rivers.length === 0) return { count: 0, longestKm: 0, widestKm: 0, outletCount: 0, lakeCount: lakes.length };
  return {
    count: rivers.length,
    longestKm: Math.max(...rivers.map((river) => river.lengthKm)),
    widestKm: Math.max(...rivers.map((river) => river.estimatedWidthKm)),
    outletCount: rivers.filter((river) => river.outlet).length,
    lakeCount: lakes.length,
  };
}

function cellDistanceKm(a, b) {
  const p = xy(a);
  const q = xy(b);
  const lat = (rowLatitude(p.y) * Math.PI) / 180;
  const dLat = Math.abs(q.y - p.y) * (Math.PI / GRID_HEIGHT);
  const dx = Math.min(Math.abs(q.x - p.x), GRID_WIDTH - Math.abs(q.x - p.x));
  const dLon = dx * ((2 * Math.PI) / GRID_WIDTH) * Math.cos(lat);
  return 3396 * Math.sqrt(dLat * dLat + dLon * dLon);
}

function riverWidthWorld(discharge) {
  return clamp(0.00028 + Math.sqrt(discharge) * 0.00012, 0.00038, 0.0028);
}

function forEachNeighbor(x, y, visit) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = (x + dx + GRID_WIDTH) % GRID_WIDTH;
      const ny = y + dy;
      if (ny < 0 || ny >= GRID_HEIGHT) continue;
      visit(index(nx, ny));
    }
  }
}

function forEachNeighbor4(x, y, visit) {
  visit(index((x + GRID_WIDTH - 1) % GRID_WIDTH, y));
  visit(index((x + 1) % GRID_WIDTH, y));
  if (y > 0) visit(index(x, y - 1));
  if (y < GRID_HEIGHT - 1) visit(index(x, y + 1));
}

function isDiagonal(a, b) {
  const p = xy(a);
  const q = xy(b);
  const dx = Math.min(Math.abs(p.x - q.x), GRID_WIDTH - Math.abs(p.x - q.x));
  return dx === 1 && Math.abs(p.y - q.y) === 1;
}

function index(x, y) {
  return y * GRID_WIDTH + x;
}

function xy(i) {
  return { x: i % GRID_WIDTH, y: Math.floor(i / GRID_WIDTH) };
}

function rowLatitude(y) {
  return 90 - ((y + 0.5) / GRID_HEIGHT) * 180;
}

function colLongitude(x) {
  return ((x + 0.5) / GRID_WIDTH) * 360;
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function hashCell(i) {
  const { x, y } = xy(i);
  return hash2(x, y);
}

function wrapLongitude(longitude) {
  return (longitude + 360) % 360;
}

function emptyResult() {
  return {
    rivers: [],
    lakes: [],
    deltas: [],
    stats: { count: 0, longestKm: 0, widestKm: 0, outletCount: 0, lakeCount: 0 },
  };
}

class MinHeap {
  constructor() {
    this.items = [];
    this.size = 0;
  }

  push(indexValue, priority) {
    const item = { index: indexValue, priority };
    this.items.push(item);
    this.size = this.items.length;
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    const root = this.items[0].index;
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    this.size = this.items.length;
    return root;
  }

  bubbleUp(position) {
    let indexValue = position;
    while (indexValue > 0) {
      const parent = Math.floor((indexValue - 1) / 2);
      if (this.items[parent].priority <= this.items[indexValue].priority) break;
      [this.items[parent], this.items[indexValue]] = [this.items[indexValue], this.items[parent]];
      indexValue = parent;
    }
  }

  bubbleDown(position) {
    let indexValue = position;
    while (true) {
      const left = indexValue * 2 + 1;
      const right = left + 1;
      let smallest = indexValue;
      if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
      if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
      if (smallest === indexValue) break;
      [this.items[smallest], this.items[indexValue]] = [this.items[indexValue], this.items[smallest]];
      indexValue = smallest;
    }
  }
}
