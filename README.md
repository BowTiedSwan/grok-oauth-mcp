# grok-oauth-mcp

Standalone TypeScript stdio MCP server for xAI Grok using web OAuth PKCE. It is intended for local MCP clients such as Claude Desktop, ChatGPT-compatible MCP hosts, and other stdio MCP launchers.

This server does not require `XAI_API_KEY` for normal usage. The primary auth path is xAI web OAuth with a local token store.

## Features

- xAI web OAuth PKCE login with the Hermes client ID.
- Token storage at `~/.config/grok-oauth-mcp/tokens.json` by default.
- Configurable token directory with `GROK_OAUTH_MCP_CONFIG_DIR`.
- Refresh-token flow before access token expiry.
- Configurable xAI API base with `XAI_BASE_URL`, defaulting to `https://api.x.ai/v1`.
- MCP stdio tools for auth, Grok chat, X search, image, video, TTS, and transcription.
- Multipart upload support for local image/audio paths.

## Install And Build

```bash
git clone https://github.com/bowtieswan/grok-oauth-mcp.git
cd grok-oauth-mcp
npm install
npm run build
```

Run locally:

```bash
npm start
```

During development:

```bash
npm run dev
```

After publishing, the intended one-shot package form is:

```bash
npx grok-oauth-mcp
```

## Claude Desktop Config

Add an MCP server entry that points at your local build:

```json
{
  "mcpServers": {
    "grok-oauth": {
      "command": "node",
      "args": ["/path/to/grok-oauth-mcp/dist/index.js"],
      "env": {
        "GROK_OAUTH_MCP_CONFIG_DIR": "/path/to/config-dir"
      }
    }
  }
}
```

If you use the default token directory, omit `env`.

## OAuth Login

Use the `auth_login` MCP tool. The tool returns an `auth_url` and starts a temporary local callback listener at:

```text
http://127.0.0.1:56121/callback
```

Open the returned `auth_url` in a browser, sign in to xAI, and allow the browser redirect to the local callback URL. Tokens are written to:

```text
~/.config/grok-oauth-mcp/tokens.json
```

The token file is written with mode `0600` where the local filesystem supports POSIX permissions.

OAuth details:

- Discovery: `https://auth.x.ai/.well-known/openid-configuration`
- Displayed authorization server: `accounts.x.ai`
- Client ID: `b1a00492-073a-47ea-816f-4c329264a828`
- Scope: `openid profile email offline_access grok-cli:access api:access`
- Redirect URI: `http://127.0.0.1:56121/callback`
- Authorize URL includes `plan=generic` and `referrer=hermes-agent`.

## Tools

### `auth_login`

Starts OAuth login and returns an authorization URL.

Input:

```json
{
  "wait": false,
  "timeout_ms": 300000
}
```

Set `wait=true` only for clients that can show stderr or otherwise surface the URL while the tool is still running.

### `auth_status`

Reports whether a token is stored, whether a refresh token exists, and approximate expiry. Token values are never returned.

### `auth_logout`

Deletes the local token file.

### `grok_chat`

Posts to `/responses` with `store=false`. Default model: `grok-build-0.1`.

Example:

```json
{
  "input": "Explain what this MCP server can do."
}
```

### `x_search`

Posts to `/responses` with `tools: [{ "type": "x_search" }]` and optional filters.

Example:

```json
{
  "query": "latest xAI Grok updates",
  "filters": {
    "max_results": 5
  }
}
```

### `grok_tts`

Posts to `/tts`.

Example:

```json
{
  "text": "Hello from Grok.",
  "voice_id": "eve",
  "language": "en"
}
```

### `grok_image`

Posts to `/images/generations` for text-to-image and `/images/edits` when `image_path` is present.

Defaults:

- Generation model: `grok-imagine-image`
- Edit model: `grok-imagine-image-quality`

Common image options include `aspect_ratio`, `resolution`, `size`, `n`, and `response_format`. Pass values supported by the current xAI/Hermes image surface, such as common aspect ratios like `1:1`, `16:9`, `9:16`, `4:3`, and `3:4` when available on your account.

### `grok_video`

Posts to `/videos/generations`. Supports text-to-video and image-to-video when `image_path` is present.

Defaults:

- Text-to-video model: `grok-imagine-video`
- Image-to-video model: `grok-imagine-video-1.5-preview`

Set `poll=true` to poll `/videos/{request_id}` until the request leaves a queued or processing state.

### `grok_transcribe`

Posts a local audio file to `/stt` with multipart form data, matching xAI Grok STT.

Example:

```json
{
  "file_path": "/path/to/audio.wav",
  "language": "en"
}
```

## Troubleshooting

- `Not authenticated. Run auth_login first.`: Run `auth_login`, open the returned URL, and complete the local callback.
- Browser cannot reach callback: Make sure nothing else is using port `56121`, then run `auth_login` again.
- `403` from xAI: Your xAI account may not have the required SuperGrok or X Premium+ entitlement for the requested Grok API surface.
- Token refresh fails: Run `auth_logout`, then `auth_login` again.
- Custom API gateway or mock server: Set `XAI_BASE_URL` to the replacement base URL.
- Custom token location: Set `GROK_OAUTH_MCP_CONFIG_DIR` to a directory path. The server writes `tokens.json` inside it.

## Development

```bash
npm test
npm run build
```

Tests mock all OAuth and xAI network calls. They must not call real xAI OAuth or xAI APIs.

## License

MIT
