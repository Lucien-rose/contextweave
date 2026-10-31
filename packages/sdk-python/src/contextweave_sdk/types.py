from typing import Generic, Literal, NotRequired, TypeVar, TypedDict

T = TypeVar("T")


class ResponseMeta(TypedDict):
    request_id: str
    recall_status: NotRequired[object]


class ApiResponse(TypedDict, Generic[T]):
    api_version: Literal["1"]
    data: T
    meta: ResponseMeta


class MemoryFields(TypedDict):
    id: str
    title: str
    content_hash: str
    family_key: str
    version: int


class MemoryCard(MemoryFields):
    content: NotRequired[str]
    excerpt: NotRequired[str]
    recall_tier: NotRequired[str]


class DeliveryReceipt(TypedDict):
    receipt_id: str
    status: Literal["prepared"]


class RecallReceiptRef(TypedDict):
    receipt_id: str
    status: Literal["prepared", "delivered", "empty"]


class RecallReceiptItem(TypedDict):
    memory_id: str
    content_hash: str
    title: str | None
    tier: str | None
    result: Literal["prepared", "delivered", "not_delivered", "filtered", "privacy_blocked"]
    detail_level: NotRequired[str]
    reason: NotRequired[str]


class RecallReceipt(RecallReceiptRef):
    schema_version: Literal[1]
    created_at: str
    items: list[RecallReceiptItem]
    query: NotRequired[str]
    latency_ms: NotRequired[float]
    package_characters: NotRequired[int]
    memory_package_tokens: NotRequired[int | None]
    routes: NotRequired[dict[str, bool]]
    counts: NotRequired[dict[str, int]]


class RecallResult(TypedDict):
    query: str
    route: str
    memories: list[MemoryCard]
    background_memories: list[MemoryCard]
    background_mode: Literal["separate", "combined"]
    guidance: str
    verification: NotRequired[dict[str, object] | None]
    delivery: NotRequired[DeliveryReceipt]
    receipt: NotRequired[RecallReceiptRef]


class ChangeReceipt(TypedDict):
    change_id: str
    family_key: str
    memory_id: str
    target_id: str | None
    operation: str
    authority: Literal["delegated", "user_correction"]
    status: Literal["applied", "undone", "recorded", "deleted"]
    created_at: str
    notification: Literal["silent", "brief"]
    replay: NotRequired[bool]


class PendingReview(TypedDict):
    status: Literal["review_required"]
    reason: str
    review_id: str
    family_key: str
    canonical_memories_changed: Literal[False]


WriteResult = ChangeReceipt | PendingReview


class AvailableMemory(MemoryFields):
    content: str
    memory_id: str
    available: Literal[True]
    updated_at: str
    canonical_content_available: bool
    truncated: bool
    detail_level: str


class GatedMemory(TypedDict):
    memory_id: str
    available: Literal[False]
    reason: str


ReadResult = AvailableMemory | GatedMemory


class BootstrapCue(TypedDict):
    id: str
    title: str
    content_hash: str
    family_key: str
    summary: str
    expandable: bool


class BootstrapResult(TypedDict):
    schema_version: Literal[3]
    purpose: str
    context: str
    intimacy_mode: str
    portrait_seed: dict[str, object]
    available_profile_domains: list[str]
    profile_manifest: dict[str, object]
    current_chapter_index: list[dict[str, object]]
    active_living_snapshot: list[dict[str, object]]
    continuity_seed: list[BootstrapCue]
    observances: list[BootstrapCue]
    budgets: dict[str, int]
    guidance: str
    delivery: NotRequired[DeliveryReceipt]


class DeliveryResult(TypedDict):
    status: Literal["delivered"]
    duplicate: bool
    recorded_count: int


class ReviewsResult(TypedDict):
    reviews: list[dict[str, object]]


class SchemaResult(TypedDict):
    api_version: Literal["1"]
    operations: list[dict[str, object]]
