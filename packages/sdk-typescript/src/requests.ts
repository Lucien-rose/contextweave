// Generated from HTTP API v1. Run npm run sdk:generate.
export type ReceiptInput = {
    "receipt_id": string;
};
export type IngestInput = {
    "change_id": string;
    "operation"?: "create" | "append_episode";
    "authority"?: "delegated" | "user_correction";
    "user_instruction"?: string;
    "family_key": string;
    "target_memory_id"?: string;
    "expected_content_hash"?: string;
    "expected_updated_at"?: string;
    "lifecycle_class"?: "belief" | "episode" | "protected";
    "memory_kind"?: "memory" | "shared-memory" | "context-memory" | "quote" | "handoff" | "ambient" | "preference" | "profile" | "style" | "episode" | "event" | "agreement" | "anchor" | "intimate-agreement" | "promise";
    "attributes"?: {
        "layer"?: "core" | "context" | "archive";
        "event_date"?: string | null;
        "tags"?: Array<string>;
        "triggers"?: Array<string>;
        "sensitivity"?: "personal" | "private" | "sensitive" | "intimate";
        "mentionability"?: "natural" | "contextual" | "explicit-only";
        "importance"?: number;
        "load_policy"?: "contextual" | "deep-rotate" | "manifest-always" | "explicit-only";
        "standing_opt_in"?: boolean;
        "scope"?: "private_general" | "private_relationship";
        "activation_policy"?: "explicit_trigger" | "relationship_contextual" | "scene_only";
        "egress_policy"?: "local_only";
        "safe_projection"?: string | null;
        "recall_summary"?: string | null;
        "public_projection"?: string | null;
    };
    "risk"?: "low" | "sensitive" | "ambiguous";
    "title": string;
    "content": string;
    "source_refs": Array<{
        "source_type": string;
        "source_id": string;
        "excerpt"?: string;
        "occurred_at"?: string;
        "written_at"?: string;
        "source_hash"?: string;
        "material_id"?: string;
        "source_context"?: {
            "content": string;
            "speaker"?: string;
            "conversation_id"?: string;
            "window_id"?: string;
            "message_id"?: string;
            "occurred_at"?: string;
            "written_at"?: string;
            "sensitivity"?: "personal" | "private" | "sensitive" | "intimate";
        };
        "metadata"?: {
            [key: string]: unknown;
        };
    }>;
    "change_explanation"?: {
        "changed": string;
        "reason": string | null;
        "reason_kind": "explicit" | "inferred" | "unknown";
    };
};
export type RecallInput = {
    "query": string;
    "context"?: "general" | "private" | "intimate";
    "intimacy_mode"?: "on" | "off" | "model" | "responsive" | "proactive" | "scene";
    "limit"?: number;
    "context_budget_chars"?: number;
    "total_budget_chars"?: number;
    "include_archived"?: boolean;
    "delivery_mode"?: "immediate" | "confirmed";
    "recently_read_ids"?: Array<string>;
    "recently_read_hashes"?: Array<string>;
    "recently_read_families"?: Array<string>;
    "query_representation"?: {
        "speech_act"?: string;
        "action_phase"?: string;
        "task_intent"?: string;
        "domain_intent"?: string;
        "entity_namespace"?: string;
        "entities"?: Array<string>;
        "aliases"?: Array<string>;
        "topics"?: Array<string>;
        "preferences"?: Array<string>;
        "emotional_facets"?: Array<string>;
        "state_cues"?: Array<string>;
        "temporal"?: {
            "state_scope"?: "current" | "historical" | "current-and-history";
            "version_scope"?: "active" | "superseded" | "all";
            "as_of"?: string;
        };
        "recall_hypotheses"?: Array<string>;
    };
    "background_limit"?: number;
    "background_budget_chars"?: number;
    "cue_neighborhood_mode"?: "off" | "observe";
    "context_envelope"?: {
        "entity_namespace"?: string;
        "speech_act"?: string;
        "action_phase"?: string;
        "entities"?: Array<string>;
        "topics"?: Array<string>;
        "state_cues"?: Array<string>;
        "recall_hypotheses"?: Array<string>;
        [key: string]: unknown;
    };
    "recall_control"?: {
        "mode"?: "normal" | "suppress_situation" | "no_recall";
        "source"?: "conversation" | "client";
    };
    "family_policy"?: "representative" | "allow-distinct";
    "allow_repeat"?: boolean;
    "allow_repeat_if_stale"?: boolean;
    "recall_scope"?: {
        "client": string;
        "surface": string;
        "session"?: string;
        "cooldown_hours"?: number;
    };
    "jev_mode"?: "off" | "observe" | "on";
    "vector_mode"?: "off" | "observe" | "on";
};
export type EvolveInput = {
    "change_id": string;
    "operation": "reinforce" | "supersede" | "coexist" | "correct";
    "authority": "delegated" | "user_correction";
    "user_instruction"?: string;
    "family_key": string;
    "target_memory_id": string;
    "expected_content_hash": string;
    "expected_updated_at": string;
    "lifecycle_class": "belief" | "episode" | "protected";
    "memory_kind"?: "memory" | "shared-memory" | "context-memory" | "quote" | "handoff" | "ambient" | "preference" | "profile" | "style" | "episode" | "event" | "agreement" | "anchor" | "intimate-agreement" | "promise";
    "attributes"?: {
        "layer"?: "core" | "context" | "archive";
        "event_date"?: string | null;
        "tags"?: Array<string>;
        "triggers"?: Array<string>;
        "sensitivity"?: "personal" | "private" | "sensitive" | "intimate";
        "mentionability"?: "natural" | "contextual" | "explicit-only";
        "importance"?: number;
        "load_policy"?: "contextual" | "deep-rotate" | "manifest-always" | "explicit-only";
        "standing_opt_in"?: boolean;
        "scope"?: "private_general" | "private_relationship";
        "activation_policy"?: "explicit_trigger" | "relationship_contextual" | "scene_only";
        "egress_policy"?: "local_only";
        "safe_projection"?: string | null;
        "recall_summary"?: string | null;
        "public_projection"?: string | null;
    };
    "risk": "low" | "sensitive" | "ambiguous";
    "title": string;
    "content": string;
    "source_refs": Array<{
        "source_type": string;
        "source_id": string;
        "excerpt"?: string;
        "occurred_at"?: string;
        "written_at"?: string;
        "source_hash"?: string;
        "material_id"?: string;
        "source_context"?: {
            "content": string;
            "speaker"?: string;
            "conversation_id"?: string;
            "window_id"?: string;
            "message_id"?: string;
            "occurred_at"?: string;
            "written_at"?: string;
            "sensitivity"?: "personal" | "private" | "sensitive" | "intimate";
        };
        "metadata"?: {
            [key: string]: unknown;
        };
    }>;
    "change_explanation"?: {
        "changed": string;
        "reason": string | null;
        "reason_kind": "explicit" | "inferred" | "unknown";
    };
};
export type ReadInput = {
    "memory_id": string;
    "query": string;
    "context"?: "general" | "private" | "intimate";
    "intimacy_mode"?: "on" | "off" | "model" | "responsive" | "proactive" | "scene";
    "context_envelope"?: {
        "entity_namespace"?: string;
        "speech_act"?: string;
        "action_phase"?: string;
        "entities"?: Array<string>;
        "topics"?: Array<string>;
        "state_cues"?: Array<string>;
        "recall_hypotheses"?: Array<string>;
        [key: string]: unknown;
    };
    "detail"?: "relevant_chunk" | "summary" | "full";
    "max_chars"?: number;
};
export type BootstrapInput = {
    "current_message"?: string;
    "delivery_mode"?: "immediate" | "confirmed";
    "context"?: "general" | "private" | "intimate";
    "intimacy_mode"?: "on" | "off" | "model" | "responsive" | "proactive" | "scene";
    "recently_read_ids"?: Array<string>;
    "recently_read_hashes"?: Array<string>;
    "recently_read_families"?: Array<string>;
    "context_envelope"?: {
        "entity_namespace"?: string;
        "speech_act"?: string;
        "action_phase"?: string;
        "entities"?: Array<string>;
        "topics"?: Array<string>;
        "state_cues"?: Array<string>;
        "recall_hypotheses"?: Array<string>;
        [key: string]: unknown;
    };
    "limit"?: number;
    "total_budget_chars"?: number;
};
export type DeliveredInput = {
    "receipt_id": string;
    "memory_ids": Array<string>;
    "memory_package_tokens"?: number;
};
export type ChangeInput = {
    "change_id": string;
};
