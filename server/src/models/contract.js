import { z } from "zod/v4";

export const TASKS = ["portrait", "summary", "jev", "embedding"];
export const PROTOCOLS = ["openai", "google", "anthropic", "decisions"];
export const connectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  protocol: z.enum(PROTOCOLS),
  base_url: z.string().url().max(1000),
  model: z.string().trim().min(1).max(200),
  api_key: z.string().trim().min(1).max(4096).optional(),
  capabilities: z.array(z.enum(["generate", "embedding", "decisions"])).min(1).max(2),
  dimensions: z.number().int().min(64).max(8192).nullable().default(null),
  include_dimensions: z.boolean().default(true),
  output_mode: z.enum(["json_schema", "json_object"]).default("json_schema"),
  google_generation_api: z.enum(["generate_content", "interactions"]).default("generate_content"),
  network_family: z.enum(["auto", "ipv4", "ipv6"]).optional(),
  timeout_ms: z.number().int().min(1000).max(120000).default(30000),
  max_output_tokens: z.number().int().min(256).max(16000).default(6000),
}).strict();

export function supportsTask(connection, task) {
  const capability = task === "embedding" ? "embedding" : task === "jev" && connection.protocol === "decisions"
    ? "decisions" : "generate";
  return connection.capabilities.includes(capability);
}
