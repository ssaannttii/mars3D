import { calculateFlood } from "./flood-core.js";

let meta;
let heights;
const cache = new Map();

self.addEventListener("message", (event) => {
  const { type, id, payload } = event.data;

  if (type === "init") {
    meta = payload.meta;
    heights = new Int16Array(payload.buffer);
    cache.clear();
    self.postMessage({ type: "ready", id });
    return;
  }

  if (type !== "calculate") return;

  try {
    const key = `${payload.seaLevel}|${payload.connected ? 1 : 0}|${payload.lakeThresholdKm2}`;
    let result = cache.get(key);
    if (!result) {
      result = calculateFlood({
        meta,
        heights,
        seaLevel: payload.seaLevel,
        connected: payload.connected,
        lakeThresholdKm2: payload.lakeThresholdKm2,
      });
      cache.set(key, result);
    }

    const mask = result.mask.slice();
    self.postMessage({ type: "result", id, stats: result.stats, buffer: mask.buffer }, [mask.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", id, message: error.message });
  }
});
