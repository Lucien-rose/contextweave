import { z, result, errorResult } from "./shared.js";

export function registerDeliveryTools(server, { core }) {
  server.registerTool("moss_recall_delivered", {
    description: "Host receipt for confirmed-mode recall. Call only after successful model-context injection, with exactly the IDs actually injected. Failed/interrupted attempts need no receipt. Retrying the same receipt and IDs is idempotent.",
    inputSchema: {
      receipt_id: z.string().startsWith("delivery:").max(80),
      memory_ids: z.array(z.string().min(1).max(240)).min(1).max(64),
      memory_package_tokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ receipt_id, memory_ids, memory_package_tokens }) => {
    try {
      return result(core.acknowledgeDelivery({ receiptId: receipt_id, memoryIds: memory_ids, memoryPackageTokens: memory_package_tokens }));
    } catch (error) {
      if (error instanceof TypeError) return errorResult(error.message);
      throw error;
    }
  });
}
