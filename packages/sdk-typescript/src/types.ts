import type { EvolveInput, IngestInput } from "./requests.js";

export interface ApiResponse<T> {
  api_version: "1";
  data: T;
  meta: { request_id: string; recall_status?: unknown };
}

export interface MemoryCard {
  id: string;
  title: string;
  content?: string;
  content_hash: string;
  family_key: string;
  version: number;
  [field: string]: unknown;
}

export interface DeliveryReceipt { receipt_id: string; status: "prepared" }
export interface RecallResult {
  query: string;
  route: string;
  memories: MemoryCard[];
  background_memories: MemoryCard[];
  background_mode: "separate" | "combined";
  guidance: string;
  verification?: Record<string, unknown> | null;
  delivery?: DeliveryReceipt;
}

export type ReadResult =
  | { memory_id: string; available: false; reason: string }
  | (MemoryCard & {
      memory_id: string; available: true; content: string; updated_at: string;
      canonical_content_available: boolean; truncated: boolean; detail_level: string;
    });

export interface ChangeReceipt {
  change_id: string;
  family_key: string;
  memory_id: string;
  target_id: string | null;
  operation: NonNullable<IngestInput["operation"]> | EvolveInput["operation"] | "undo";
  authority: "delegated" | "user_correction";
  status: "applied" | "undone" | "recorded" | "deleted";
  created_at: string;
  notification: "silent" | "brief";
  replay?: boolean;
}

export type WriteResult = ChangeReceipt | {
  status: "review_required"; reason: string; review_id: string;
  family_key: string; canonical_memories_changed: false;
};

export interface BootstrapResult {
  schema_version: 3;
  purpose: "homecoming-initialization";
  context: string;
  intimacy_mode: string;
  portrait_seed: { content: string; content_hash: string; item_ids: string[]; use_policy: string; source?: string };
  available_profile_domains: string[];
  profile_manifest: { subject_id: string; revision: number; read_tool: string; host_only: boolean };
  current_chapter_index: Array<{ id: string; title: string }>;
  active_living_snapshot: Array<{ id: string; domain: string; title: string; summary: string; use_policy: string; expires_at: string | null }>;
  continuity_seed: BootstrapCue[];
  observances: BootstrapCue[];
  budgets: { total_limit: number; total_characters: number; omitted: number };
  guidance: string;
  delivery?: DeliveryReceipt;
}

export interface BootstrapCue {
  id: string; title: string; content_hash: string; family_key: string;
  summary: string; expandable: boolean; observance?: unknown;
}

export interface DeliveryResult { status: "delivered"; duplicate: boolean; recorded_count: number }
export interface ReviewsResult { reviews: Array<{
  review_id: string; family_key: string; status: string; reason: string; updated_at: string;
  resolved_at: string | null; notion_page_id: string | null; notion_url: string | null;
  deferred_at: string | null; intent: IngestInput | EvolveInput;
}> }
export interface SchemaResult {
  api_version: "1";
  operations: Array<{ name: string; method: string; path: string; role: string; input?: Record<string, unknown> }>;
}
