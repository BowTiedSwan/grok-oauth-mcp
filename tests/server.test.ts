import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { handleToolCall } from "../src/server.js";
import { tools } from "../src/tools.js";

function parseResult(result: CallToolResult): unknown {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("Expected text content");
  return JSON.parse(block.text);
}

describe("MCP tool surface", () => {
  it("exposes the required Hermes Grok MCP tools", () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "auth_exchange_code",
      "auth_login",
      "auth_logout",
      "auth_status",
      "grok_chat",
      "grok_image",
      "grok_transcribe",
      "grok_tts",
      "grok_video",
      "x_search"
    ].sort());
  });

  it("dispatches auth and xAI tool calls to structured JSON text content", async () => {
    const auth = {
      startLogin: vi.fn(async () => ({ auth_url: "https://accounts.x.ai/authorize" })),
      status: vi.fn(async () => ({ authenticated: true })),
      logout: vi.fn(async () => ({ authenticated: false })),
      exchangePendingCode: vi.fn(async () => ({ authenticated: true }))
    };
    const xai = {
      chat: vi.fn(async () => ({ output_text: "hello" })),
      search: vi.fn(),
      tts: vi.fn(),
      image: vi.fn(),
      video: vi.fn(),
      transcribe: vi.fn()
    };

    const login = await handleToolCall("auth_login", { wait: false }, { auth: auth as never, xai: xai as never });
    const exchange = await handleToolCall("auth_exchange_code", { code: "manual-code" }, { auth: auth as never, xai: xai as never });
    const chat = await handleToolCall("grok_chat", { input: "hello" }, { auth: auth as never, xai: xai as never });

    expect(parseResult(login)).toMatchObject({ auth_url: "https://accounts.x.ai/authorize" });
    expect(parseResult(exchange)).toMatchObject({ authenticated: true });
    expect(parseResult(chat)).toMatchObject({ output_text: "hello" });
    expect(auth.exchangePendingCode).toHaveBeenCalledWith({ code: "manual-code" });
    expect(xai.chat).toHaveBeenCalledWith({ input: "hello" });
  });

  it("returns MCP error content for unknown tools", async () => {
    const result = await handleToolCall("missing", {}, { auth: {} as never, xai: {} as never });

    expect(result.isError).toBe(true);
    expect(parseResult(result)).toMatchObject({ error: "Unknown tool: missing" });
  });
});
