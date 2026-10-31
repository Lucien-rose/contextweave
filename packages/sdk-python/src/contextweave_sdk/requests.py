# Generated from HTTP API v1. Run npm run python:generate.
from typing import Literal, NotRequired, TypedDict


class ReceiptInput(TypedDict):
    receipt_id: str


class IngestInputAttributes(TypedDict):
    layer: NotRequired[Literal["core", "context", "archive"]]
    event_date: NotRequired[str | None]
    tags: NotRequired[list[str]]
    triggers: NotRequired[list[str]]
    sensitivity: NotRequired[Literal["personal", "private", "sensitive", "intimate"]]
    mentionability: NotRequired[Literal["natural", "contextual", "explicit-only"]]
    importance: NotRequired[int]
    load_policy: NotRequired[Literal["contextual", "deep-rotate", "manifest-always", "explicit-only"]]
    standing_opt_in: NotRequired[bool]
    scope: NotRequired[Literal["private_general", "private_relationship"]]
    activation_policy: NotRequired[Literal["explicit_trigger", "relationship_contextual", "scene_only"]]
    egress_policy: NotRequired[Literal["local_only"]]
    safe_projection: NotRequired[str | None]
    recall_summary: NotRequired[str | None]
    public_projection: NotRequired[str | None]


class IngestInputSourceRefsItemSourceContext(TypedDict):
    content: str
    speaker: NotRequired[str]
    conversation_id: NotRequired[str]
    window_id: NotRequired[str]
    message_id: NotRequired[str]
    occurred_at: NotRequired[str]
    written_at: NotRequired[str]
    sensitivity: NotRequired[Literal["personal", "private", "sensitive", "intimate"]]


class IngestInputSourceRefsItem(TypedDict):
    source_type: str
    source_id: str
    excerpt: NotRequired[str]
    occurred_at: NotRequired[str]
    written_at: NotRequired[str]
    source_hash: NotRequired[str]
    material_id: NotRequired[str]
    source_context: NotRequired[IngestInputSourceRefsItemSourceContext]
    metadata: NotRequired[dict[str, object]]


class IngestInputChangeExplanation(TypedDict):
    changed: str
    reason: str | None
    reason_kind: Literal["explicit", "inferred", "unknown"]


class IngestInput(TypedDict):
    change_id: str
    operation: NotRequired[Literal["create", "append_episode"]]
    authority: NotRequired[Literal["delegated", "user_correction"]]
    user_instruction: NotRequired[str]
    family_key: str
    target_memory_id: NotRequired[str]
    expected_content_hash: NotRequired[str]
    expected_updated_at: NotRequired[str]
    lifecycle_class: NotRequired[Literal["belief", "episode", "protected"]]
    memory_kind: NotRequired[Literal["memory", "shared-memory", "context-memory", "quote", "handoff", "ambient", "preference", "profile", "style", "episode", "event", "agreement", "anchor", "intimate-agreement", "promise"]]
    attributes: NotRequired[IngestInputAttributes]
    risk: NotRequired[Literal["low", "sensitive", "ambiguous"]]
    title: str
    content: str
    source_refs: list[IngestInputSourceRefsItem]
    change_explanation: NotRequired[IngestInputChangeExplanation]


class RecallInputQueryRepresentationTemporal(TypedDict):
    state_scope: NotRequired[Literal["current", "historical", "current-and-history"]]
    version_scope: NotRequired[Literal["active", "superseded", "all"]]
    as_of: NotRequired[str]


class RecallInputQueryRepresentation(TypedDict):
    speech_act: NotRequired[str]
    action_phase: NotRequired[str]
    task_intent: NotRequired[str]
    domain_intent: NotRequired[str]
    entity_namespace: NotRequired[str]
    entities: NotRequired[list[str]]
    aliases: NotRequired[list[str]]
    topics: NotRequired[list[str]]
    preferences: NotRequired[list[str]]
    emotional_facets: NotRequired[list[str]]
    state_cues: NotRequired[list[str]]
    temporal: NotRequired[RecallInputQueryRepresentationTemporal]
    recall_hypotheses: NotRequired[list[str]]


class RecallInputContextEnvelope(TypedDict):
    entity_namespace: NotRequired[str]
    speech_act: NotRequired[str]
    action_phase: NotRequired[str]
    entities: NotRequired[list[str]]
    topics: NotRequired[list[str]]
    state_cues: NotRequired[list[str]]
    recall_hypotheses: NotRequired[list[str]]


class RecallInputRecallControl(TypedDict):
    mode: NotRequired[Literal["normal", "suppress_situation", "no_recall"]]
    source: NotRequired[Literal["conversation", "client"]]


class RecallInputRecallScope(TypedDict):
    client: str
    surface: str
    session: NotRequired[str]
    cooldown_hours: NotRequired[float]


class RecallInput(TypedDict):
    query: str
    context: NotRequired[Literal["general", "private", "intimate"]]
    intimacy_mode: NotRequired[Literal["on", "off", "model", "responsive", "proactive", "scene"]]
    limit: NotRequired[int]
    context_budget_chars: NotRequired[int]
    total_budget_chars: NotRequired[int]
    include_archived: NotRequired[bool]
    delivery_mode: NotRequired[Literal["immediate", "confirmed"]]
    recently_read_ids: NotRequired[list[str]]
    recently_read_hashes: NotRequired[list[str]]
    recently_read_families: NotRequired[list[str]]
    query_representation: NotRequired[RecallInputQueryRepresentation]
    background_limit: NotRequired[int]
    background_budget_chars: NotRequired[int]
    cue_neighborhood_mode: NotRequired[Literal["off", "observe"]]
    context_envelope: NotRequired[RecallInputContextEnvelope]
    recall_control: NotRequired[RecallInputRecallControl]
    family_policy: NotRequired[Literal["representative", "allow-distinct"]]
    allow_repeat: NotRequired[bool]
    allow_repeat_if_stale: NotRequired[bool]
    recall_scope: NotRequired[RecallInputRecallScope]
    jev_mode: NotRequired[Literal["off", "observe", "on"]]
    vector_mode: NotRequired[Literal["off", "observe", "on"]]


class EvolveInputAttributes(TypedDict):
    layer: NotRequired[Literal["core", "context", "archive"]]
    event_date: NotRequired[str | None]
    tags: NotRequired[list[str]]
    triggers: NotRequired[list[str]]
    sensitivity: NotRequired[Literal["personal", "private", "sensitive", "intimate"]]
    mentionability: NotRequired[Literal["natural", "contextual", "explicit-only"]]
    importance: NotRequired[int]
    load_policy: NotRequired[Literal["contextual", "deep-rotate", "manifest-always", "explicit-only"]]
    standing_opt_in: NotRequired[bool]
    scope: NotRequired[Literal["private_general", "private_relationship"]]
    activation_policy: NotRequired[Literal["explicit_trigger", "relationship_contextual", "scene_only"]]
    egress_policy: NotRequired[Literal["local_only"]]
    safe_projection: NotRequired[str | None]
    recall_summary: NotRequired[str | None]
    public_projection: NotRequired[str | None]


class EvolveInputSourceRefsItemSourceContext(TypedDict):
    content: str
    speaker: NotRequired[str]
    conversation_id: NotRequired[str]
    window_id: NotRequired[str]
    message_id: NotRequired[str]
    occurred_at: NotRequired[str]
    written_at: NotRequired[str]
    sensitivity: NotRequired[Literal["personal", "private", "sensitive", "intimate"]]


class EvolveInputSourceRefsItem(TypedDict):
    source_type: str
    source_id: str
    excerpt: NotRequired[str]
    occurred_at: NotRequired[str]
    written_at: NotRequired[str]
    source_hash: NotRequired[str]
    material_id: NotRequired[str]
    source_context: NotRequired[EvolveInputSourceRefsItemSourceContext]
    metadata: NotRequired[dict[str, object]]


class EvolveInputChangeExplanation(TypedDict):
    changed: str
    reason: str | None
    reason_kind: Literal["explicit", "inferred", "unknown"]


class EvolveInput(TypedDict):
    change_id: str
    operation: Literal["reinforce", "supersede", "coexist", "correct"]
    authority: Literal["delegated", "user_correction"]
    user_instruction: NotRequired[str]
    family_key: str
    target_memory_id: str
    expected_content_hash: str
    expected_updated_at: str
    lifecycle_class: Literal["belief", "episode", "protected"]
    memory_kind: NotRequired[Literal["memory", "shared-memory", "context-memory", "quote", "handoff", "ambient", "preference", "profile", "style", "episode", "event", "agreement", "anchor", "intimate-agreement", "promise"]]
    attributes: NotRequired[EvolveInputAttributes]
    risk: Literal["low", "sensitive", "ambiguous"]
    title: str
    content: str
    source_refs: list[EvolveInputSourceRefsItem]
    change_explanation: NotRequired[EvolveInputChangeExplanation]


class ReadInputContextEnvelope(TypedDict):
    entity_namespace: NotRequired[str]
    speech_act: NotRequired[str]
    action_phase: NotRequired[str]
    entities: NotRequired[list[str]]
    topics: NotRequired[list[str]]
    state_cues: NotRequired[list[str]]
    recall_hypotheses: NotRequired[list[str]]


class ReadInput(TypedDict):
    memory_id: str
    query: str
    context: NotRequired[Literal["general", "private", "intimate"]]
    intimacy_mode: NotRequired[Literal["on", "off", "model", "responsive", "proactive", "scene"]]
    context_envelope: NotRequired[ReadInputContextEnvelope]
    detail: NotRequired[Literal["relevant_chunk", "summary", "full"]]
    max_chars: NotRequired[int]


class BootstrapInputContextEnvelope(TypedDict):
    entity_namespace: NotRequired[str]
    speech_act: NotRequired[str]
    action_phase: NotRequired[str]
    entities: NotRequired[list[str]]
    topics: NotRequired[list[str]]
    state_cues: NotRequired[list[str]]
    recall_hypotheses: NotRequired[list[str]]


class BootstrapInput(TypedDict):
    current_message: NotRequired[str]
    delivery_mode: NotRequired[Literal["immediate", "confirmed"]]
    context: NotRequired[Literal["general", "private", "intimate"]]
    intimacy_mode: NotRequired[Literal["on", "off", "model", "responsive", "proactive", "scene"]]
    recently_read_ids: NotRequired[list[str]]
    recently_read_hashes: NotRequired[list[str]]
    recently_read_families: NotRequired[list[str]]
    context_envelope: NotRequired[BootstrapInputContextEnvelope]
    limit: NotRequired[int]
    total_budget_chars: NotRequired[int]


class DeliveredInput(TypedDict):
    receipt_id: str
    memory_ids: list[str]
    memory_package_tokens: NotRequired[int]


class ChangeInput(TypedDict):
    change_id: str
