import { defaults } from "../defaults.js";
import { z } from "zod/v4";
import { sourceSchema } from "../evolution/contract.js";

export const PORTRAIT_DOMAINS = ["identity", "preference", "cognitive", "rhythm", "relationship", "work", "values", "body", "emotion"];
export const portraitDataSchema = z.object({
  domain: z.enum(PORTRAIT_DOMAINS),
  time_scale: z.enum(["stable", "chapter", "living"]),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(3000),
  sensitivity: z.enum(["personal", "private", "sensitive", "intimate"]).default("private"),
  use_policy: z.enum(["silent", "natural", "explicit_only"]).default("silent"),
  seed_eligible: z.boolean().default(false),
  priority: z.number().int().min(0).max(100).default(50),
  confidence: z.number().min(0).max(1).default(1),
  status: z.enum(["active", "paused", "stale", "completed", "abandoned"]).default("active"),
  expires_at: z.string().datetime({ offset: true }).nullable().default(null),
  chapter: z.object({
    goals: z.array(z.string().max(300)).max(8).default([]),
    current_phase: z.string().max(500).default(""),
    recent_progress: z.array(z.string().max(300)).max(8).default([]),
    unresolved: z.array(z.string().max(300)).max(8).default([]),
    expected_until: z.string().date().nullable().default(null),
  }).strict().nullable().default(null),
}).strict().superRefine((data, ctx) => {
  if (data.time_scale === "living" && !data.expires_at) {
    ctx.addIssue({ code: "custom", path: ["expires_at"], message: "Living state requires an expiry" });
  }
  if (data.seed_eligible && data.time_scale !== "stable") {
    ctx.addIssue({ code: "custom", path: ["seed_eligible"], message: "Only stable portraits belong in Seed" });
  }
  if (data.chapter && data.time_scale !== "chapter") {
    ctx.addIssue({ code: "custom", path: ["chapter"], message: "Chapter details require chapter time scale" });
  }
});

export const portraitChangeSchema = z.object({
  change_id: z.string().min(1).max(240),
  subject_id: z.string().min(1).max(160).default("user"),
  item_id: z.string().min(1).max(160),
  expected_revision: z.number().int().min(0),
  operation: z.enum(["upsert", "reinforce"]),
  risk: z.enum(["clear", "ambiguous"]).default("clear"),
  data: portraitDataSchema.optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
  source_refs: z.array(sourceSchema).min(1).max(20),
}).strict().refine((change) => change.operation !== "upsert" || change.data, {
  message: "upsert requires data", path: ["data"],
});

export const portraitReadSchema = z.object({
  subject_id: z.string().min(1).max(160).default("user"),
  context: z.enum(["general", "private", "intimate"]).default("private"),
  intimacy_mode: z.enum(["off", "model", "responsive", "proactive", "scene", "on"]).default("off"),
  domains: z.array(z.enum(PORTRAIT_DOMAINS)).max(PORTRAIT_DOMAINS.length).default([]),
  item_ids: z.array(z.string().min(1).max(160)).max(32).default([]),
  time_scales: z.array(z.enum(["stable", "chapter", "living"])).max(3).default([]),
  query: z.string().max(4000).default(""),
  max_chars: z.number().int().min(512).max(20000).default(defaults.portraitChars),
  include_evidence: z.boolean().default(false),
  include_inactive: z.boolean().default(false),
}).strict();
