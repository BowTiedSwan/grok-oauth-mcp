import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "auth_login",
    description: "Start xAI web OAuth PKCE login using the Hermes Agent client. Use wait=true to capture the localhost callback and store tokens.",
    inputSchema: {
      type: "object",
      properties: {
        wait: { type: "boolean", description: "Wait for http://127.0.0.1:56121/callback and exchange the authorization code." },
        timeout_ms: { type: "number", description: "Callback wait timeout in milliseconds. Defaults to 120000." }
      }
    }
  },
  {
    name: "auth_exchange_code",
    description: "Exchange a pasted xAI/Grok Build OAuth code or callback URL using pending PKCE state from auth_login.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Bare code shown by the xAI page that says to copy it into Grok Build." },
        callback_url: { type: "string", description: "Full localhost callback URL containing code and state." }
      }
    }
  },
  { name: "auth_status", description: "Show local xAI OAuth token status without revealing token values.", inputSchema: { type: "object", properties: {} } },
  { name: "auth_logout", description: "Delete the local OAuth token store.", inputSchema: { type: "object", properties: {} } },
  {
    name: "grok_chat",
    description: "Send a Grok chat or responses request to /responses with store=false. Defaults to model grok-build-0.1.",
    inputSchema: { type: "object", properties: { input: {}, messages: {}, prompt: { type: "string" }, model: { type: "string" } } }
  },
  {
    name: "x_search",
    description: "Ask Grok with the x_search tool enabled through /responses and optional x_search filters.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, input: {}, filters: { type: "object" }, model: { type: "string" }, allowed_x_handles: { type: "array", items: { type: "string" } }, excluded_x_handles: { type: "array", items: { type: "string" } }, from_date: { type: "string" }, to_date: { type: "string" }, enable_image_understanding: { type: "boolean" }, enable_video_understanding: { type: "boolean" } } }
  },
  {
    name: "grok_tts",
    description: "Generate speech through /tts.",
    inputSchema: { type: "object", properties: { input: { type: "string" }, text: { type: "string" }, voice_id: { type: "string" }, voice: { type: "string" }, language: { type: "string" }, output_format: { type: "object" }, response_format: { type: "string" }, speed: { type: "number" }, optimize_streaming_latency: { type: "number" } } }
  },
  {
    name: "grok_image",
    description: "Generate or edit images through /images/generations or /images/edits. Defaults to grok-imagine-image and grok-imagine-image-quality.",
    inputSchema: { type: "object", properties: { prompt: { type: "string" }, image_path: { type: "string" }, mask_path: { type: "string" }, model: { type: "string" }, aspect_ratio: { type: "string" }, resolution: { type: "string" }, size: { type: "string" }, n: { type: "number" }, response_format: { type: "string" } } }
  },
  {
    name: "grok_video",
    description: "Generate text-to-video or image-to-video through /videos/generations, optionally polling /videos/{request_id}.",
    inputSchema: { type: "object", properties: { prompt: { type: "string" }, image_path: { type: "string" }, model: { type: "string" }, aspect_ratio: { type: "string" }, duration: { type: "number" }, fps: { type: "number" }, poll: { type: "boolean" }, poll_interval_ms: { type: "number" }, poll_timeout_ms: { type: "number" } } }
  },
  {
    name: "grok_transcribe",
    description: "Transcribe a local audio file through /audio/transcriptions using multipart form upload.",
    inputSchema: { type: "object", required: ["file_path"], properties: { file_path: { type: "string" }, model: { type: "string" }, language: { type: "string" }, prompt: { type: "string" }, response_format: { type: "string" }, temperature: { type: "number" } } }
  }
];
