import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { publicError } from "../lib/error.js";

export function privateAddress(address) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip.includes(":")) {
    if (ip.startsWith("::ffff:")) {
      const tail = ip.slice(7);
      if (tail.includes(".")) return privateAddress(tail);
      const parts = tail.split(":");
      return parts.length !== 2 || privateAddress(`${parseInt(parts[0], 16) >> 8}.${parseInt(parts[0], 16) & 255}.${parseInt(parts[1], 16) >> 8}.${parseInt(parts[1], 16) & 255}`);
    }
    return !/^2[0-9a-f]{3}:/.test(ip) || /^2001:(?:db8|0|10|20):/.test(ip) || /^2002:/.test(ip);
  }
  const [a, b] = ip.split(".").map(Number);
  return !isIP(ip) || [0, 10, 127].includes(a) || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b))
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b));
}

// Resolve and validate the exact address used by the socket, not a preflight DNS
// result. Redirects are never followed, so keys stay on the configured endpoint.
export function modelFetch(url, options = {}, { lookupImpl = lookup } = {}) {
  const target = new URL(url);
  const networkFamily = options.networkFamily ?? process.env.MOSS_MODELS_NETWORK_FAMILY ?? "auto";
  if (!["auto", "ipv4", "ipv6"].includes(networkFamily)) throw publicError("Invalid model network family");
  const family = networkFamily === "ipv4" ? 4 : networkFamily === "ipv6" ? 6 : 0;
  const allowPrivate = process.env.MOSS_MODELS_ALLOW_PRIVATE === "1";
  if (target.protocol !== "https:" && !(allowPrivate && target.protocol === "http:")) {
    throw publicError("Model endpoint requires HTTPS");
  }
  const literal = target.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && isIP(literal) && privateAddress(literal)) throw publicError("Private model endpoint is disabled");
  return new Promise((resolve, reject) => {
    const request = (target.protocol === "https:" ? https : http).request(target, {
      method: options.method || "POST", headers: options.headers, signal: options.signal,
      agent: false, family, autoSelectFamily: family === 0, autoSelectFamilyAttemptTimeout: 250,
      lookup(hostname, dnsOptions, callback) {
        lookupImpl(hostname, { all: true, family: dnsOptions.family || 0 }, (error, rows) => {
          if (error) callback(error);
          else if (!rows.length) callback(Object.assign(new Error("model-dns-empty"), { code: "ENOTFOUND" }));
          else if (!allowPrivate && rows.some((row) => privateAddress(row.address))) {
            callback(publicError("Model endpoint resolved to a private address", 502));
          } else if (dnsOptions.all) callback(null, rows);
          else callback(null, rows[0].address, rows[0].family);
        });
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) response.destroy(new Error("model-response-too-large"));
        else chunks.push(chunk);
      });
      response.on("error", () => reject(publicError("Model response failed", 502)));
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode })));
    });
    request.on("error", (error) => reject(modelConnectionError(error, networkFamily)));
    request.end(options.body);
  });
}

export function modelConnectionError(error, networkFamily = "auto") {
  if (error.publicMessage) return error;
  const codes = new Set([error.code, ...(error.errors || []).map((item) => item.code)]);
  let reason = "connection failed";
  if (codes.has("ABORT_ERR") || codes.has("ETIMEDOUT") || error.name === "TimeoutError") reason = "request timed out";
  else if (codes.has("ENOTFOUND") || codes.has("EAI_AGAIN")) reason = "DNS lookup failed";
  else if (codes.has("ENETUNREACH") || codes.has("EHOSTUNREACH")) reason = "network route unavailable";
  else if (codes.has("ECONNREFUSED")) reason = "connection refused";
  else if ([...codes].some((code) => /CERT|TLS|SSL/.test(code || ""))) reason = "TLS certificate or handshake failed";
  return publicError(`Model ${reason} (network: ${networkFamily})`, 502);
}
