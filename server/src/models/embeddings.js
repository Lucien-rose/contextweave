import { modelPost } from "./client.js";
import { publicError } from "../lib/error.js";

export async function connectionEmbeddings(connection, texts, options = {}) {
  let vectors;
  if (connection.protocol === "openai") {
    const result = await modelPost(connection, "/embeddings", { model: connection.model,
      input: texts, encoding_format: "float",
      ...(connection.include_dimensions ? { dimensions: connection.dimensions } : {}) }, options);
    const rows = result.data || [];
    if (rows.length !== texts.length || rows.some((row, i) => !rows.some((item) => item.index === i))) {
      throw publicError("Embedding response has invalid indices", 502);
    }
    vectors = [...rows].sort((a, b) => a.index - b.index).map((row) => row.embedding);
  } else if (connection.protocol === "google") {
    const model = `models/${connection.model.replace(/^models\//, "")}`;
    const result = await modelPost(connection, `/${model}:batchEmbedContents`, {
      requests: texts.map((text) => ({ model, content: { parts: [{ text }] },
        embedContentConfig: { outputDimensionality: connection.dimensions } })),
    }, options);
    vectors = result.embeddings?.map((row) => row.values) || [];
  } else throw publicError("This protocol has no supported embedding API");
  if (vectors.length !== texts.length) throw publicError("Unexpected embedding count", 502);
  return vectors.map((values) => {
    if (!Array.isArray(values) || values.length !== connection.dimensions || values.some((n) => !Number.isFinite(n))) {
      throw publicError("Unexpected embedding dimensions or values", 502);
    }
    const norm = Math.hypot(...values);
    if (!(norm > 0)) throw publicError("Zero embedding", 502);
    return Float32Array.from(values, (n) => n / norm);
  });
}
