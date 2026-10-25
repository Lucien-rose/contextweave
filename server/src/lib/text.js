export function cleanOptional(value, maxLength) {
  const result = String(value || "").trim();
  return result ? result.slice(0, maxLength) : null;
}

export function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

export function boundedText(value, maxLength) {
  const content = String(value || "");
  if (content.length <= maxLength) return { content, truncated: false };
  return { content: `${content.slice(0, Math.max(0, maxLength - 1))}…`, truncated: true };
}
