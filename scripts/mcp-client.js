import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function withMcp(baseUrl, surface, token, action) {
  const client = new Client({ name: "contextweave-deployment", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`/mcp/${surface}`, baseUrl), {
      requestInit: { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) },
    }));
    return await action(client);
  } finally {
    await client.close();
  }
}

export async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed`);
  return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === "text").text);
}
