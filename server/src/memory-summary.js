export function memorySummary(memory) {
  return String(memory.recall_summary || "").trim();
}

export function summaryRecommended(memory) {
  return String(memory.content || "").length > 1200
    || ["style", "ambient", "agreement", "intimate-agreement", "promise"].includes(memory.kind)
    || memory.load_policy === "manifest-always";
}

export function normalizeMemorySummaries(row, input, previous) {
  if (!Object.hasOwn(input, "recall_summary") && Object.hasOwn(input, "safe_projection")) {
    row.recall_summary = input.safe_projection;
  }
  if (previous && previous.content_hash !== row.content_hash) {
    for (const field of ["recall_summary", "public_projection"]) {
      if (row[field] === previous[field]) row[field] = null;
    }
  }
}

export function publicRecallProjection(memory, context) {
  if (context !== "general" || memory.sensitivity !== "intimate" || !memory.public_projection) return memory;
  return {
    ...memory, title: "公开记忆概括", content: memory.public_projection, recall_summary: memory.public_projection,
    sensitivity: "personal", tags: [], triggers: [], ambient_triggers: [],
    source_file: null, source_section: null, external_id: null,
    standing_opt_in: false, load_policy: "contextual", kind: "memory", public_projection_only: true,
  };
}
