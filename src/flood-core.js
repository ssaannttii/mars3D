const MARS_RADIUS_KM = 3396;

export function calculateFlood({ meta, heights, seaLevel, connected, lakeThresholdKm2 }) {
  const total = meta.width * meta.height;
  const below = new Uint8Array(total);
  const rowAreas = makeRowAreas(meta);
  let simpleAreaKm2 = 0;

  for (let i = 0; i < total; i += 1) {
    if (heights[i] <= seaLevel) {
      below[i] = 1;
      simpleAreaKm2 += rowAreas[Math.floor(i / meta.width)];
    }
  }

  if (!connected) {
    return {
      mask: below,
      stats: {
        floodedAreaKm2: simpleAreaKm2,
        floodedPercent: (simpleAreaKm2 / totalSurfaceArea(rowAreas, meta.width)) * 100,
        oceanAreaKm2: simpleAreaKm2,
        lakeAreaKm2: 0,
        lakeCount: 0,
        dryDepressionAreaKm2: 0,
        keptComponentCount: simpleAreaKm2 > 0 ? 1 : 0,
      },
    };
  }

  const { componentIds, components } = labelComponents(meta, below, rowAreas);
  if (components.length === 0) {
    return emptyResult(total, rowAreas, meta.width);
  }

  components.sort((a, b) => b.areaKm2 - a.areaKm2);
  const oceanId = components[0].id;
  const keep = new Uint8Array(components.length);
  let oceanAreaKm2 = 0;
  let lakeAreaKm2 = 0;
  let lakeCount = 0;
  let dryDepressionAreaKm2 = 0;
  let keptComponentCount = 0;

  for (const component of components) {
    const isOcean = component.id === oceanId;
    const isLargeLake = component.areaKm2 >= lakeThresholdKm2;
    if (isOcean || isLargeLake) {
      keep[component.id] = 1;
      keptComponentCount += 1;
      if (isOcean) oceanAreaKm2 = component.areaKm2;
      else {
        lakeAreaKm2 += component.areaKm2;
        lakeCount += 1;
      }
    } else {
      dryDepressionAreaKm2 += component.areaKm2;
    }
  }

  const mask = new Uint8Array(total);
  let floodedAreaKm2 = 0;
  for (let i = 0; i < total; i += 1) {
    const id = componentIds[i];
    if (id >= 0 && keep[id]) {
      mask[i] = 1;
      floodedAreaKm2 += rowAreas[Math.floor(i / meta.width)];
    }
  }

  return {
    mask,
    stats: {
      floodedAreaKm2,
      floodedPercent: (floodedAreaKm2 / totalSurfaceArea(rowAreas, meta.width)) * 100,
      oceanAreaKm2,
      lakeAreaKm2,
      lakeCount,
      dryDepressionAreaKm2,
      keptComponentCount,
    },
  };
}

function labelComponents(meta, below, rowAreas) {
  const total = meta.width * meta.height;
  const visited = new Uint8Array(total);
  const componentIds = new Int32Array(total);
  componentIds.fill(-1);

  const queue = new Int32Array(total);
  const components = [];
  let componentId = 0;
  let tail = 0;

  for (let start = 0; start < total; start += 1) {
    if (!below[start] || visited[start]) continue;

    let head = 0;
    let areaKm2 = 0;
    let cells = 0;
    tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    componentIds[start] = componentId;

    while (head < tail) {
      const current = queue[head++];
      const y = Math.floor(current / meta.width);
      const x = current - y * meta.width;
      areaKm2 += rowAreas[y];
      cells += 1;

      visit(y * meta.width + ((x + meta.width - 1) % meta.width));
      visit(y * meta.width + ((x + 1) % meta.width));
      if (y > 0) visit(current - meta.width);
      if (y < meta.height - 1) visit(current + meta.width);
    }

    components.push({ id: componentId, areaKm2, cells });
    componentId += 1;
  }

  return { componentIds, components };

  function visit(next) {
    if (visited[next] || !below[next]) return;
    visited[next] = 1;
    componentIds[next] = componentId;
    queue[tail++] = next;
  }
}

function makeRowAreas(meta) {
  const rowAreas = new Float64Array(meta.height);
  const dLon = (2 * Math.PI) / meta.width;
  for (let y = 0; y < meta.height; y += 1) {
    const latNorth = ((90 - (y / meta.height) * 180) * Math.PI) / 180;
    const latSouth = ((90 - ((y + 1) / meta.height) * 180) * Math.PI) / 180;
    rowAreas[y] = MARS_RADIUS_KM * MARS_RADIUS_KM * dLon * (Math.sin(latNorth) - Math.sin(latSouth));
  }
  return rowAreas;
}

function totalSurfaceArea(rowAreas, width) {
  let total = 0;
  for (let y = 0; y < rowAreas.length; y += 1) {
    total += rowAreas[y] * width;
  }
  return total;
}

function emptyResult(total, rowAreas, width) {
  return {
    mask: new Uint8Array(total),
    stats: {
      floodedAreaKm2: 0,
      floodedPercent: 0,
      oceanAreaKm2: 0,
      lakeAreaKm2: 0,
      lakeCount: 0,
      dryDepressionAreaKm2: 0,
      keptComponentCount: 0,
      totalAreaKm2: totalSurfaceArea(rowAreas, width),
    },
  };
}
