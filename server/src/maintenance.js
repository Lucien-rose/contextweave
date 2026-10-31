import { housekeeping } from "./continuity-retention.js";
import { evolutionHousekeeping } from "./evolution/retention.js";
import { flushVectorDeletions } from "./evolution/vector-deletion.js";
import { portraitHousekeeping } from "./portrait/lifecycle.js";
import { prunePortraitRuntime } from "./portrait/status.js";
import { startPortraitWorker } from "./portrait/worker.js";
import { pruneRecallDeliveries } from "./recall/delivery.js";

export function startMaintenance(db, { intervalMs = 3600000 } = {}) {
  let pending;
  const run = () => {
    if (pending) return pending;
    pending = (async () => {
      const now = new Date();
      housekeeping(db, now);
      portraitHousekeeping(db, { at: now });
      prunePortraitRuntime(db);
      evolutionHousekeeping(db, now);
      pruneRecallDeliveries(db, { at: now, apply: true });
      await flushVectorDeletions(db);
    })().catch(error => console.error("ContextWeave maintenance failed", error))
      .finally(() => { pending = null; });
    return pending;
  };
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  const stopWorker = startPortraitWorker(db);
  return async () => {
    clearInterval(timer);
    await Promise.all([pending, stopWorker()]);
  };
}
