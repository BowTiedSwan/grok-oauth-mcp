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

## Quick Start

This is the shortest path for a human or agent to get the MCP running, authenticate, and verify that Grok works.

### 1. Install

From source:

```bash
git clone https://github.com/bowtieswan/grok-oauth-mcp.git
cd grok-oauth-mcp
npm install
npm run build
```

Run directly from the built checkout:

```bash
node /absolute/path/to/grok-oauth-mcp/dist/index.js
```

Or install it globally from the checkout:

```bash
npm install -g .
grok-oauth-mcp
```

Package-runner form:

```bash
npx grok-oauth-mcp
```

### 2. Add It To Your MCP Client

Use absolute paths when possible. This avoids PATH differences between your shell and GUI apps.

#### Claude Desktop

Add an MCP server entry that points at your local build or global executable. Local build example:

```json
{
  "mcpServers": {
    "grok-oauth": {
      "command": "node",
      "args": ["/absolute/path/to/grok-oauth-mcp/dist/index.js"]
    }
  }
}
```

If you installed globally and know the executable path:

```json
{
  "mcpServers": {
    "grok-oauth": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/grok-oauth-mcp"]
    }
  }
}
```

#### OpenCode

Add a local MCP server entry under the top-level `mcp` object in your OpenCode config, usually `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "grok-oauth": {
      "command": [
        "/absolute/path/to/node",
        "/absolute/path/to/grok-oauth-mcp"
      ],
      "enabled": true,
      "type": "local"
    }
  }
}
```

Then restart the MCP client or reload MCP servers. In OpenCode, verify discovery with:

```bash
opencode mcp list
```

You should see `grok-oauth` connected.

### 3. Authenticate

Use the MCP tool `auth_login` with `wait=false` first. This is the safest mode for most MCP clients because the tool returns the URL immediately.

Input:

```json
{
  "wait": false,
  "timeout_ms": 600000
}
```

The result contains:

- `auth_url`: open this in your browser.
- `state`: the OAuth state for this attempt.
- `redirect_uri`: normally `http://127.0.0.1:56121/callback`.
- `token_path`: where tokens will be written after success.

Open `auth_url`, sign in to xAI, then complete one of these two paths.

#### Path A: Browser Redirects To Localhost

If the browser redirects to `http://127.0.0.1:56121/callback?...` and shows a success message, login is complete. Run `auth_status` to confirm.

#### Path B: xAI Shows A Grok Build Code

Sometimes xAI shows a page saying:

```text
Enter this code to finish signing in
Copy the code below into Grok Build to finish signing in
```

If that happens, copy the code and call `auth_exchange_code` immediately:

```json
{
  "code": "paste-the-grok-build-code-here"
}
```

The code is tied to the most recent `auth_login` attempt and the saved PKCE verifier. If it expires or you started another login attempt, run `auth_login` again and use the fresh code from the fresh URL.

If you have a full callback URL instead of a bare code, pass it as `callback_url`:

```json
{
  "callback_url": "http://127.0.0.1:56121/callback?code=...&state=..."
}
```

### 4. Verify Auth

Run `auth_status`. A successful login returns `authenticated: true`, `has_refresh_token: true`, and an expiry time. Token values are never returned.

Tokens are stored at:

```text
~/.config/grok-oauth-mcp/tokens.json
```

Temporary pending OAuth state is stored at:

```text
~/.config/grok-oauth-mcp/pending_oauth.json
```

Both files are written with mode `0600` where the local filesystem supports POSIX permissions.

### 5. Test Grok

After `auth_status` is authenticated, try a small call. For X search:

```json
{
  "query": "latest xAI Grok updates",
  "filters": {
    "max_results": 5
  }
}
```

If the first broad search times out, retry with a narrower query and fewer results.

## OAuth Details

- Discovery: `https://auth.x.ai/.well-known/openid-configuration`
- Displayed authorization server: `accounts.x.ai`
- Client ID: `b1a00492-073a-47ea-816f-4c329264a828`
- Scope: `openid profile email offline_access grok-cli:access api:access`
- Redirect URI: `http://127.0.0.1:56121/callback`
- Authorize URL includes `plan=generic` and `referrer=hermes-agent`.

## Authentication Notes For Agents

- Prefer `auth_login` with `wait=false`. Do not use `wait=true` unless your MCP host surfaces stderr or tool output while the call is still running.
- Always open the exact `auth_url` from the latest `auth_login` result.
- If the page shows a Grok Build code, call `auth_exchange_code` with that code. Do not try to open `/callback` manually.
- If `auth_exchange_code` returns `No pending OAuth login found` or `Pending OAuth login is expired`, run `auth_login` again and use the fresh URL/code.
- If xAI returns `invalid_grant`, the code is stale, already used, or from a different login attempt. Run `auth_login` again.

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

Deletes the local token file and any pending OAuth state.

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

- `Not authenticated. Run auth_login first.`: Run `auth_login` with `wait=false`, open the returned `auth_url`, then complete the redirect or use `auth_exchange_code` with the Grok Build code.
- Browser cannot reach callback: If xAI showed a Grok Build code, do not manually open `/callback`; call `auth_exchange_code` with the code instead. If you expected a redirect, make sure nothing else is using port `56121`, then run `auth_login` again.
- `No pending OAuth login found` or `Pending OAuth login is expired`: Run `auth_login` again and use the fresh URL/code.
- `invalid_grant`: The pasted code is stale, already used, or belongs to a different login attempt. Run `auth_login` again and paste the fresh code.
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
