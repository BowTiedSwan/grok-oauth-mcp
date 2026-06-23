import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { XaiClient } from "../src/xai.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function client(fetchMock: ReturnType<typeof vi.fn>): XaiClient {
  return new XaiClient({ accessToken: async () => "token" }, fetchMock as typeof fetch, "https://mock.x.ai/v1");
}

function requestBody(fetchMock: unknown): Record<string, unknown> {
  const calls = (fetchMock as { mock: { calls: Array<[unknown, RequestInit]> } }).mock.calls;
  const call = calls[calls.length - 1] as [unknown, RequestInit];
  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

function fetchCall(fetchMock: unknown, index: number): [unknown, RequestInit] {
  return (fetchMock as { mock: { calls: Array<[unknown, RequestInit]> } }).mock.calls[index] as [unknown, RequestInit];
}

describe("XaiClient", () => {
  it("posts grok_chat to /responses with store=false and default model", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "response" }));

    await client(fetchMock).chat({ input: "hello" });

    expect(fetchCall(fetchMock, 0)[0]).toBe("https://mock.x.ai/v1/responses");
    expect(fetchCall(fetchMock, 0)[1].headers).toMatchObject({ authorization: "Bearer token", "content-type": "application/json" });
    expect(requestBody(fetchMock)).toMatchObject({ model: "grok-build-0.1", input: "hello", store: false });
  });

  it("posts x_search to /responses with filters in the x_search tool", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "search" }));

    await client(fetchMock).search({ query: "latest", from_date: "2026-01-01", allowed_x_handles: ["xai"], enable_image_understanding: true });

    expect(requestBody(fetchMock)).toMatchObject({
      input: "latest",
      store: false,
      tools: [{ type: "x_search", from_date: "2026-01-01", allowed_x_handles: ["xai"], enable_image_understanding: true }]
    });
    expect(requestBody(fetchMock)).not.toHaveProperty("from_date");
  });

  it("routes image generation and image editing to Hermes-compatible JSON endpoints", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    const dir = await mkdtemp(join(tmpdir(), "grok-oauth-mcp-"));
    const image = join(dir, "image.png");
    await writeFile(image, "png");
    const xai = client(fetchMock);

    await xai.image({ prompt: "cat", aspect_ratio: "16:9", resolution: "high" });
    await xai.image({ prompt: "edit", image_path: image });

    expect(fetchCall(fetchMock, 0)[0]).toBe("https://mock.x.ai/v1/images/generations");
    expect(JSON.parse(fetchCall(fetchMock, 0)[1].body as string)).toMatchObject({ model: "grok-imagine-image", prompt: "cat", aspect_ratio: "16:9", resolution: "high" });
    expect(fetchCall(fetchMock, 1)[0]).toBe("https://mock.x.ai/v1/images/edits");
    expect(fetchCall(fetchMock, 1)[1].headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(fetchCall(fetchMock, 1)[1].body as string)).toMatchObject({
      model: "grok-imagine-image-quality",
      prompt: "edit",
      image: { type: "image_url", url: expect.stringMatching(/^data:image\/png;base64,/) }
    });
  });

  it("routes image-to-video through Hermes-compatible JSON image payloads", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ request_id: "vid-1" }));
    const dir = await mkdtemp(join(tmpdir(), "grok-oauth-mcp-"));
    const image = join(dir, "image.png");
    await writeFile(image, "png");

    await client(fetchMock).video({ prompt: "animate", image_path: image });

    expect(fetchCall(fetchMock, 0)[0]).toBe("https://mock.x.ai/v1/videos/generations");
    expect(fetchCall(fetchMock, 0)[1].headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(fetchCall(fetchMock, 0)[1].body as string)).toMatchObject({
      model: "grok-imagine-video-1.5-preview",
      prompt: "animate",
      image: { url: expect.stringMatching(/^data:image\/png;base64,/) }
    });
  });

  it("supports video generation polling", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ request_id: "vid-1", status: "queued" }))
      .mockResolvedValueOnce(jsonResponse({ request_id: "vid-1", status: "completed", url: "https://video" }));

    const result = await client(fetchMock).video({ prompt: "launch", poll: true, poll_interval_ms: 0, poll_timeout_ms: 1000 });

    expect(fetchCall(fetchMock, 0)[0]).toBe("https://mock.x.ai/v1/videos/generations");
    expect(fetchCall(fetchMock, 1)[0]).toBe("https://mock.x.ai/v1/videos/vid-1");
    expect(result).toMatchObject({ status: "completed", url: "https://video" });
  });

  it("posts tts and transcribe requests to the expected endpoints", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    const dir = await mkdtemp(join(tmpdir(), "grok-oauth-mcp-"));
    const audio = join(dir, "audio.wav");
    await writeFile(audio, "wav");
    const xai = client(fetchMock);

    await xai.tts({ text: "hello", voice_id: "Ara", language: "en", output_format: { codec: "mp3" } });
    await xai.transcribe({ file_path: audio, language: "en" });

    expect(fetchCall(fetchMock, 0)[0]).toBe("https://mock.x.ai/v1/tts");
    expect(JSON.parse(fetchCall(fetchMock, 0)[1].body as string)).toMatchObject({ text: "hello", voice_id: "Ara", language: "en", output_format: { codec: "mp3" } });
    expect(fetchCall(fetchMock, 1)[0]).toBe("https://mock.x.ai/v1/stt");
    expect(fetchCall(fetchMock, 1)[1].body).toBeInstanceOf(FormData);
  });
});
