import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_EDIT_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_TO_VIDEO_MODEL,
  DEFAULT_TRANSCRIBE_MODEL,
  DEFAULT_TTS_MODEL,
  DEFAULT_VIDEO_MODEL,
  XAI_BASE_URL
} from "./constants.js";
import type { AuthClient, FetchLike } from "./auth.js";
import type { JsonObject } from "./types.js";

export class XaiApiError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message);
    this.name = "XaiApiError";
  }
}

export class XaiClient {
  private readonly baseUrl: string;

  constructor(
    private readonly auth: Pick<AuthClient, "accessToken">,
    private readonly fetchImpl: FetchLike = fetch,
    baseUrl = process.env.XAI_BASE_URL ?? XAI_BASE_URL
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async chat(args: JsonObject): Promise<unknown> {
    const body = {
      model: args.model ?? DEFAULT_CHAT_MODEL,
      input: args.input ?? args.messages ?? args.prompt,
      store: false,
      ...without(args, ["model", "input", "messages", "prompt"])
    };
    return this.request("/responses", { method: "POST", body });
  }

  async search(args: JsonObject): Promise<unknown> {
    const toolDef = xSearchToolDefinition(args);
    const body = {
      model: args.model ?? DEFAULT_CHAT_MODEL,
      input: args.input ?? args.query,
      tools: [toolDef],
      store: false,
      ...without(args, ["model", "input", "query", "filters", ...X_SEARCH_FILTER_KEYS])
    };
    return this.request("/responses", { method: "POST", body });
  }

  async image(args: JsonObject): Promise<unknown> {
    if (typeof args.image_path === "string") {
      const body = {
        model: args.model ?? DEFAULT_IMAGE_EDIT_MODEL,
        prompt: args.prompt,
        image: await imageField(args.image_path),
        n: args.n,
        response_format: args.response_format,
        size: args.size,
        aspect_ratio: args.aspect_ratio,
        resolution: args.resolution
      };
      return this.request("/images/edits", { method: "POST", body });
    }
    const body = {
      model: args.model ?? DEFAULT_IMAGE_MODEL,
      prompt: args.prompt,
      n: args.n,
      response_format: args.response_format,
      size: args.size,
      aspect_ratio: args.aspect_ratio,
      resolution: args.resolution,
      ...without(args, ["model", "prompt", "n", "response_format", "size", "aspect_ratio", "resolution"])
    };
    return this.request("/images/generations", { method: "POST", body });
  }

  async video(args: JsonObject): Promise<unknown> {
    const poll = args.poll === true;
    const pollIntervalMs = typeof args.poll_interval_ms === "number" ? args.poll_interval_ms : 3000;
    const pollTimeoutMs = typeof args.poll_timeout_ms === "number" ? args.poll_timeout_ms : 120000;
    const hasImage = typeof args.image_path === "string";
    const model = args.model ?? (hasImage ? DEFAULT_IMAGE_TO_VIDEO_MODEL : DEFAULT_VIDEO_MODEL);
    let result: unknown;
    if (hasImage) {
      const body = {
        model,
        prompt: args.prompt,
        aspect_ratio: args.aspect_ratio,
        duration: args.duration,
        fps: args.fps,
        image: { url: await fileDataUri(args.image_path as string) }
      };
      result = await this.request("/videos/generations", { method: "POST", body });
    } else {
      result = await this.request("/videos/generations", {
        method: "POST",
        body: {
          model,
          prompt: args.prompt,
          aspect_ratio: args.aspect_ratio,
          duration: args.duration,
          fps: args.fps,
          ...without(args, ["model", "prompt", "aspect_ratio", "duration", "fps", "poll", "poll_interval_ms", "poll_timeout_ms"])
        }
      });
    }
    const requestId = extractRequestId(result);
    if (!poll || !requestId) return result;
    return this.pollVideo(requestId, pollIntervalMs, pollTimeoutMs);
  }

  async tts(args: JsonObject): Promise<unknown> {
    const body = {
      text: args.text ?? args.input,
      voice_id: args.voice_id ?? args.voice ?? DEFAULT_TTS_MODEL,
      language: args.language ?? "en",
      output_format: args.output_format,
      response_format: args.response_format,
      speed: args.speed,
      optimize_streaming_latency: args.optimize_streaming_latency,
      ...without(args, ["model", "input", "text", "voice", "voice_id", "language", "output_format", "response_format", "speed", "optimize_streaming_latency"])
    };
    return this.request("/tts", { method: "POST", body });
  }

  async transcribe(args: JsonObject): Promise<unknown> {
    if (typeof args.file_path !== "string") throw new XaiApiError("grok_transcribe requires file_path");
    const form = new FormData();
    appendJsonFields(form, {
      model: args.model ?? DEFAULT_TRANSCRIBE_MODEL,
      language: args.language,
      prompt: args.prompt,
      response_format: args.response_format,
      temperature: args.temperature
    });
    await appendFile(form, "file", args.file_path);
    return this.request("/stt", { method: "POST", form });
  }

  async pollVideo(requestId: string, intervalMs: number, timeoutMs: number): Promise<unknown> {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      const result = await this.request(`/videos/${encodeURIComponent(requestId)}`, { method: "GET" });
      const status = typeof result === "object" && result ? String((result as JsonObject).status ?? "") : "";
      if (!["queued", "running", "processing", "pending", "in_progress"].includes(status.toLowerCase())) return result;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new XaiApiError(`Timed out polling video request ${requestId}`);
  }

  private async request(path: string, options: { method: string; body?: unknown; form?: FormData }): Promise<unknown> {
    const accessToken = await this.auth.accessToken();
    const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
    const init: RequestInit = { method: options.method, headers };
    if (options.form) {
      init.body = options.form;
    } else if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    const payload = await parseResponse(response);
    if (!response.ok) throw new XaiApiError(`xAI API request failed with HTTP ${response.status}`, response.status, payload);
    return payload;
  }
}

function without(source: JsonObject, keys: string[]): JsonObject {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => !blocked.has(key) && value !== undefined));
}

const X_SEARCH_FILTER_KEYS = [
  "allowed_x_handles",
  "excluded_x_handles",
  "from_date",
  "to_date",
  "enable_image_understanding",
  "enable_video_understanding"
];

function xSearchToolDefinition(args: JsonObject): JsonObject {
  const filters = (args.filters && typeof args.filters === "object" ? args.filters : {}) as JsonObject;
  const toolDef: JsonObject = { type: "x_search", ...filters };
  for (const key of X_SEARCH_FILTER_KEYS) {
    if (args[key] !== undefined) toolDef[key] = args[key];
  }
  return toolDef;
}

function appendJsonFields(form: FormData, fields: JsonObject): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
}

async function appendFile(form: FormData, field: string, path: string): Promise<void> {
  const buffer = await readFile(path);
  form.append(field, new Blob([buffer]), basename(path));
}

async function imageField(path: string): Promise<{ url: string; type: "image_url" }> {
  return { url: await fileDataUri(path), type: "image_url" };
}

async function fileDataUri(path: string): Promise<string> {
  if (/^(https?:|data:)/i.test(path)) return path;
  const buffer = await readFile(path);
  const mime = mimeType(path);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function mimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function extractRequestId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const object = value as JsonObject;
  const id = object.request_id ?? object.id;
  return typeof id === "string" ? id : null;
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
