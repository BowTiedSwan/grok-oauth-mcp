import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AuthClient } from "./auth.js";
import { tools } from "./tools.js";
import type { JsonObject, TextToolResult } from "./types.js";
import { XaiClient } from "./xai.js";

export interface ServerDependencies {
  auth?: AuthClient;
  xai?: XaiClient;
}

export function jsonResult(value: unknown): TextToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(error: unknown): TextToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const extra = typeof error === "object" && error ? Object.fromEntries(Object.entries(error).filter(([key]) => key !== "stack")) : {};
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: message, ...extra }, null, 2) }] };
}

export function createServer(dependencies: ServerDependencies = {}): McpServer {
  const auth = dependencies.auth ?? new AuthClient();
  const xai = dependencies.xai ?? new XaiClient(auth);
  const server = new McpServer({ name: "grok-oauth-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => handleToolCall(request.params.name, (request.params.arguments ?? {}) as JsonObject, { auth, xai }));
  return server;
}

export async function handleToolCall(name: string, args: JsonObject, dependencies: Required<ServerDependencies>): Promise<TextToolResult> {
  const { auth, xai } = dependencies;
  try {
    switch (name) {
      case "auth_login":
        return jsonResult(await auth.startLogin({ wait: args.wait === true, timeoutMs: numberArg(args.timeout_ms) }));
      case "auth_status":
        return jsonResult(await auth.status());
      case "auth_logout":
        return jsonResult(await auth.logout());
      case "grok_chat":
        return jsonResult(await xai.chat(args));
      case "x_search":
        return jsonResult(await xai.search(args));
      case "grok_tts":
        return jsonResult(await xai.tts(args));
      case "grok_image":
        return jsonResult(await xai.image(args));
      case "grok_video":
        return jsonResult(await xai.video(args));
      case "grok_transcribe":
        return jsonResult(await xai.transcribe(args));
      default:
        return errorResult(new Error(`Unknown tool: ${name}`));
    }
  } catch (error) {
    return errorResult(error);
  }
}

export async function runStdio(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

function numberArg(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
