import { publicError } from "../lib/error.js";
import { modelFetch, modelConnectionError } from "./transport.js";
import { providerOutputSchema } from "./output-schema.js";

export async function modelPost(connection, path, body, { fetchImpl = modelFetch } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (connection.protocol === "google") headers["x-goog-api-key"] = connection.api_key;
  else if (connection.protocol === "anthropic") {
    headers["x-api-key"] = connection.api_key;
    headers["anthropic-version"] = "2023-06-01";
  } else headers.Authorization = `Bearer ${connection.api_key}`;
  let response;
  try { response = await fetchImpl(`${connection.base_url}${path}`, { method: "POST", headers,
    body: JSON.stringify(body), signal: AbortSignal.timeout(connection.timeout_ms), networkFamily: connection.network_family }); }
  catch (error) { throw modelConnectionError(error, connection.network_family ?? process.env.MOSS_MODELS_NETWORK_FAMILY ?? "auto"); }
  if (!response.ok) throw publicError(response.status === 503
    ? "Model provider unavailable or busy (HTTP 503)"
    : response.status === 429 ? "Model provider quota or rate limit reached (HTTP 429)"
      : `Model provider returned HTTP ${response.status}`, 502);
  try { return await response.json(); }
  catch { throw publicError("Invalid model response JSON", 502); }
}

export async function generateStructured(connection, { instruction, input, schema, name = "moss_result" }, options = {}) {
  const wireSchema = providerOutputSchema(schema, connection.protocol);
  const text = JSON.stringify(input);
  const prompt = `${instruction}\nReturn JSON only, following this schema: ${JSON.stringify(schema)}`;
  let result, output;
  if (connection.protocol === "openai") {
    result = await modelPost(connection, "/chat/completions", { model: connection.model,
      messages: [{ role: "system", content: prompt }, { role: "user", content: text }],
      max_completion_tokens: connection.max_output_tokens,
      response_format: connection.output_mode === "json_object" ? { type: "json_object" }
        : { type: "json_schema", json_schema: { name, strict: true, schema: wireSchema } } }, options);
    if (result.choices?.[0]?.finish_reason !== "stop") throw publicError("Model output did not finish normally", 502);
    output = result.choices[0].message?.content;
  } else if (connection.protocol === "google" && connection.google_generation_api === "interactions") {
    const responseFormat = { type: "text", mime_type: "application/json" };
    if (connection.output_mode !== "json_object") responseFormat.schema = wireSchema;
    result = await modelPost(connection, "/interactions", {
      model: connection.model.replace(/^models\//, ""), input: text, system_instruction: prompt,
      response_format: responseFormat, generation_config: { max_output_tokens: connection.max_output_tokens },
      store: false, stream: false, background: false,
    }, options);
    if (result.status !== "completed") throw publicError("Model output did not finish normally", 502);
    output = result.steps?.filter((step) => step.type === "model_output")
      .flatMap((step) => step.content || []).filter((part) => part.type === "text")
      .map((part) => part.text || "").join("");
  } else if (connection.protocol === "google") {
    result = await modelPost(connection, `/models/${encodeURIComponent(connection.model.replace(/^models\//, ""))}:generateContent`, {
      systemInstruction: { parts: [{ text: prompt }] }, contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: wireSchema,
        maxOutputTokens: connection.max_output_tokens } }, options);
    if (result.candidates?.[0]?.finishReason !== "STOP") throw publicError("Model output did not finish normally", 502);
    output = result.candidates[0].content?.parts?.filter((part) => !part.thought).map((part) => part.text || "").join("");
  } else if (connection.protocol === "anthropic") {
    result = await modelPost(connection, "/messages", { model: connection.model, max_tokens: connection.max_output_tokens,
      system: prompt, messages: [{ role: "user", content: text }],
      output_config: { format: { type: "json_schema", schema: wireSchema } } }, options);
    if (result.stop_reason !== "end_turn") throw publicError("Model output did not finish normally", 502);
    output = result.content?.filter((part) => part.type === "text").map((part) => part.text).join("");
  } else throw publicError("Connection does not support structured generation");
  try { return { value: JSON.parse(output), usage: result.usage || result.usageMetadata || {}, model: result.model || connection.model }; }
  catch { throw publicError("Model output was not valid JSON", 502); }
}
