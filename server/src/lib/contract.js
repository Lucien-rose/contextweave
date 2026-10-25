import { publicError } from "./error.js";

export function parseContract(schema, input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw publicError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  return parsed.data;
}
