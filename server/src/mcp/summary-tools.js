import { result } from "./shared.js";
import { listMissingSummaries, setMemorySummary, summaryListSchema, summarySetSchema } from "../memory-summaries.js";

export function registerSummaryTools(server, { db }) {
  server.registerTool("moss_summary_pending", {
    inputSchema: summaryListSchema.shape,
    description: "List context-visible active memories needing a summary (>1200 characters or style/ambient/standing agreement). Read an exact original before summarizing; this body-free list is not the summary. Never infer missing contents.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input) => result(listMissingSummaries(db, input)));
  server.registerTool("moss_summary_set", {
    inputSchema: summarySetSchema.shape,
    description: "Under enabled delegation, save or clear an accurate recall_summary after reading the exact original. Preserve concrete facts and conditions in about 200–400 characters, without redaction. Hash/time prevent stale summaries. Does not rewrite the original, create a new episode/version, grant access, or change lifecycle. Never use it to save new facts.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input) => result(setMemorySummary(db, input, { delegated: true })));
}
