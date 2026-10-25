function integer(name, fallback, min, max) {
  const raw = process.env[`CW_${name}`];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`CW_${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export const timezone = process.env.CW_TIMEZONE || "UTC";
new Intl.DateTimeFormat("en", { timeZone: timezone });

export const defaults = Object.freeze({
  seedChars: integer("SEED_CHARS", 4096, 2048, 24000),
  mainChars: integer("MAIN_CHARS", 6000, 1200, 12000),
  totalChars: integer("TOTAL_CHARS", 12000, 2048, 24000),
  backgroundChars: integer("BACKGROUND_CHARS", 1000, 0, 4000),
  backgroundItems: integer("BACKGROUND_ITEMS", 1, 0, 3),
  recallItems: integer("RECALL_ITEMS", 5, 1, 12),
  portraitChars: integer("PORTRAIT_CHARS", 4000, 512, 20000),
  historyChars: integer("HISTORY_CHARS", 12000, 12000, 50000),
  portraitOperations: integer("PORTRAIT_OPERATIONS", 3, 1, 20),
  memoryCandidates: integer("MEMORY_CANDIDATES", 2, 1, 10),
  livingDays: integer("LIVING_DAYS", 3, 1, 30),
  expiredGraceDays: integer("EXPIRED_GRACE_DAYS", 14, 1, 365),
});
