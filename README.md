# grok-oauth-mcp

Standalone TypeScript stdio MCP server for xAI Grok using web OAuth PKCE. It is intended for local MCP clients such as Claude Desktop, ChatGPT-compatible MCP hosts, and other stdio MCP launchers.

This server does not require `XAI_API_KEY` for normal usage. The primary auth path is xAI web OAuth with a local token store.

## Requirements

- Node.js 20+
- A local MCP client that can launch stdio servers, such as Claude Desktop or another MCP-compatible host.
- An xAI account with an active **SuperGrok** subscription or an **X Premium+** subscription linked to the X account you sign in with. This matches the Hermes xAI Grok OAuth connector: the browser login works through `accounts.x.ai`, and xAI links X Premium+ entitlement to the xAI session automatically.

No `XAI_API_KEY` is used for the normal OAuth path. xAI may still gate OAuth API access by subscription tier; if OAuth succeeds but xAI API calls return `403`, your account may not be entitled for that OAuth API surface yet.

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

Open the returned `auth_url` in a browser, sign in to xAI, and allow the browser redirect to the local callback URL. The pending PKCE verifier is also stored temporarily so the login can be completed manually if xAI shows a Grok Build code instead of redirecting. Tokens are written to:

```text
~/.config/grok-oauth-mcp/tokens.json
```

The token file and temporary pending OAuth file are written with mode `0600` where the local filesystem supports POSIX permissions.

If xAI shows a page that says "Enter this code to finish signing in" / "Copy the code below into Grok Build", copy that code and call `auth_exchange_code`:

```json
{
  "code": "paste-the-grok-build-code-here"
}
```

If you have a full callback URL instead, pass it as `callback_url`:

```json
{
  "callback_url": "http://127.0.0.1:56121/callback?code=...&state=..."
}
```

Run `auth_login` again if the pending OAuth state is missing or expired.

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

### `auth_exchange_code`

Exchanges a pasted xAI/Grok Build OAuth code, or a full callback URL, using pending PKCE state from the last `auth_login` call.

Input with a bare Grok Build code:

```json
{
  "code": "paste-the-grok-build-code-here"
}
```

Input with a callback URL:

```json
{
  "callback_url": "http://127.0.0.1:56121/callback?code=...&state=..."
}
```

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
