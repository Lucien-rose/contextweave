import { applyIntentWithMaintenance } from "../../memory-write.js";
import { readChange } from "../../evolution/changes.js";
import { listReviews } from "../../evolution/reviews.js";
import { publicError } from "../../lib/error.js";
import { performBootstrap, performRecall } from "../../recall/request.js";
import { readRecallReceipt } from "../../recall/receipt.js";

export function createApiService({ db, core }) {
  const write = async input => ({ data: await applyIntentWithMaintenance(db, input) });
  return {
    receipt({ receipt_id }) {
      const receipt = readRecallReceipt(db, receipt_id);
      if (!receipt) throw publicError("Recall receipt is no longer available", 410);
      return { data: receipt };
    },
    ingest: write,
    evolve: write,
    recall: input => performRecall(core, input),
    bootstrap: input => ({ data: performBootstrap(core, input) }),
    read(input) {
      const memory = core.expand({
        memoryId: input.memory_id, query: input.query, context: input.context,
        intimacyMode: input.intimacy_mode, contextEnvelope: input.context_envelope,
        detail: input.detail, maxChars: input.max_chars,
      });
      if (!memory) throw publicError("Memory not found", 404);
      return { data: memory };
    },
    delivered(input) {
      try {
        return { data: core.acknowledgeDelivery({ receiptId: input.receipt_id, memoryIds: input.memory_ids,
          memoryPackageTokens: input.memory_package_tokens }) };
      } catch (error) {
        if (error instanceof TypeError) throw publicError(error.message, error.status || 400);
        throw error;
      }
    },
    change({ change_id }) {
      const change = readChange(db, change_id);
      if (!change) throw publicError("Change not found", 404);
      return { data: change };
    },
    reviews: () => ({ data: { reviews: listReviews(db) } }),
  };
}
