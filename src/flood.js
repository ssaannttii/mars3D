import { calculateFlood } from "./flood-core.js";

export class FloodModel {
  constructor(meta, heights) {
    this.meta = meta;
    this.heights = heights;
    this.cache = new Map();
    this.pending = new Map();
    this.nextId = 1;
    this.ready = this.initWorker();
  }

  async calculate({ seaLevel, connected, lakeThresholdKm2 }) {
    const key = `${seaLevel}|${connected ? 1 : 0}|${lakeThresholdKm2}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    await this.ready;

    if (!this.worker) {
      const result = calculateFlood({
        meta: this.meta,
        heights: this.heights,
        seaLevel,
        connected,
        lakeThresholdKm2,
      });
      this.remember(key, result);
      return result;
    }

    const result = await new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({
        type: "calculate",
        id,
        payload: { seaLevel, connected, lakeThresholdKm2 },
      });
    });
    this.remember(key, result);
    return result;
  }

  async initWorker() {
    try {
      this.worker = new Worker("./src/flood-worker.js", { type: "module" });
      this.worker.addEventListener("message", (event) => this.handleWorkerMessage(event.data));
      this.worker.addEventListener("error", () => {
        this.worker = null;
      });

      const copy = new Int16Array(this.heights);
      await new Promise((resolve, reject) => {
        const id = this.nextId++;
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ type: "init", id, payload: { meta: this.meta, buffer: copy.buffer } }, [
          copy.buffer,
        ]);
      });
    } catch {
      this.worker = null;
    }
  }

  handleWorkerMessage(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);

    if (message.type === "ready") {
      pending.resolve();
      return;
    }

    if (message.type === "error") {
      pending.reject(new Error(message.message));
      return;
    }

    pending.resolve({
      mask: new Uint8Array(message.buffer),
      stats: message.stats,
    });
  }

  remember(key, result) {
    this.cache.set(key, result);
    if (this.cache.size <= 16) return;
    const oldest = this.cache.keys().next().value;
    this.cache.delete(oldest);
  }
}
