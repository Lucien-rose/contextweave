export const MCP_SURFACES = Object.freeze(["runtime", "admin", "compat"]);

export const RUNTIME_TOOL_NAMES = Object.freeze([
  "moss_sync_pull",
  "moss_sync_push",
  "moss_bootstrap",
  "moss_recall",
  "moss_expand",
  "moss_source_context",
  "moss_today",
  "moss_read",
  "moss_timeline",
  "moss_draft",
  "moss_commit",
  "moss_profile_lookup",
  "moss_profile_update",
  "moss_profile_observe",
  "moss_window_capsules",
  "moss_window_capsule_read",
  "moss_memory_intent",
  "moss_arc_list",
  "moss_arc_read",
  "moss_arc_materials",
  "moss_entity_list",
  "moss_entity_read",
  "moss_relation_discover",
  "moss_relation_read",
  "moss_relation_list",
  "moss_relation_paths",
  "moss_relation_bundle",
  "moss_recall_delivered",
]);

export const ADMIN_TOOL_NAMES = Object.freeze([
  "moss_status",
  "moss_recall_trace",
  "moss_source_context_curate",
  "moss_profile_runtime",
  "moss_profile_candidates",
  "moss_profile_candidate_read",
  "moss_profile_candidate_close",
  "moss_state",
  "moss_lifecycle_audit",
  "moss_lifecycle_observe",
  "moss_lifecycle_plan",
  "moss_lifecycle_apply",
  "moss_family_history",
  "moss_family_read",
  "moss_family_plan",
  "moss_family_group",
  "moss_family_judge",
  "moss_delegation",
  "moss_changes",
  "moss_defer_review",
  "moss_undo_change",
  "moss_delete_memory",
  "moss_restore_memory",
  "moss_arc_create",
  "moss_arc_list",
  "moss_arc_read",
  "moss_arc_rename",
  "moss_arc_archive",
  "moss_arc_attach",
  "moss_arc_detach",
  "moss_arc_materials",
  "moss_entity_save",
  "moss_entity_list",
  "moss_entity_read",
  "moss_entity_link",
  "moss_relation_discover",
  "moss_relation_propose",
  "moss_relation_review",
  "moss_relation_read",
  "moss_relation_list",
  "moss_relation_paths",
  "moss_relation_bundle",
  "moss_summary_pending",
  "moss_summary_set",
]);

const runtimeTools = new Set(RUNTIME_TOOL_NAMES);
const adminTools = new Set(ADMIN_TOOL_NAMES);

export function assertMcpSurface(surface) {
  if (!MCP_SURFACES.includes(surface)) throw new TypeError(`Unknown MCP surface: ${surface}`);
  return surface;
}

export function toolVisibleOnSurface(name, surface) {
  assertMcpSurface(surface);
  if (surface === "compat") return true;
  return (surface === "runtime" ? runtimeTools : adminTools).has(name);
}

export function createSurfaceRegistrar(server, surface) {
  assertMcpSurface(surface);
  return {
    registerTool(name, definition, handler) {
      if (toolVisibleOnSurface(name, surface)) server.registerTool(name, definition, handler);
    },
  };
}
