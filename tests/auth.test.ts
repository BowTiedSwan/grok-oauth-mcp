import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AuthClient, PendingOAuthStore, TokenStore, configDir, createPkcePair } from "../src/auth.js";
import { OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI, OAUTH_SCOPE } from "../src/constants.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fetchCall(fetchMock: unknown, index: number): [unknown, RequestInit] {
  return (fetchMock as { mock: { calls: Array<[unknown, RequestInit]> } }).mock.calls[index] as [unknown, RequestInit];
}

describe("AuthClient", () => {
  it("uses the universal grok-oauth-mcp config directory", () => {
    const previous = process.env.GROK_OAUTH_MCP_CONFIG_DIR;
    process.env.GROK_OAUTH_MCP_CONFIG_DIR = "/tmp/grok-oauth-config";
    try {
      expect(configDir()).toBe("/tmp/grok-oauth-config");
      delete process.env.GROK_OAUTH_MCP_CONFIG_DIR;
      expect(configDir()).toMatch(/\.config\/grok-oauth-mcp$/);
    } finally {
      if (previous === undefined) delete process.env.GROK_OAUTH_MCP_CONFIG_DIR;
      else process.env.GROK_OAUTH_MCP_CONFIG_DIR = previous;
    }
  });

  it("builds the Hermes xAI OAuth authorize URL", () => {
    const auth = new AuthClient(new TokenStore("/tmp/unused"));
    const url = new URL(auth.buildAuthorizeUrl({ authorization_endpoint: "https://accounts.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" }, "state-1", "challenge-1", "nonce-1"));

    expect(url.origin).toBe("https://accounts.x.ai");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(OAUTH_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe(OAUTH_SCOPE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBe("nonce-1");
    expect(url.searchParams.get("plan")).toBe("generic");
    expect(url.searchParams.get("referrer")).toBe("hermes-agent");
  });

  it("exchanges authorization codes with PKCE fields", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }));
    const auth = new AuthClient(new TokenStore("/tmp/unused"), fetchMock as typeof fetch);

    const tokens = await auth.exchangeCode({ authorization_endpoint: "https://accounts.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" }, "code-1", "verifier-1", "challenge-1");
    const body = fetchCall(fetchMock, 0)[1].body as URLSearchParams;

    expect(tokens.access_token).toBe("access");
    expect(fetchCall(fetchMock, 0)[0]).toBe("https://auth.x.ai/token");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("client_id")).toBe(OAUTH_CLIENT_ID);
    expect(body.get("redirect_uri")).toBe(OAUTH_REDIRECT_URI);
    expect(body.get("code_verifier")).toBe("verifier-1");
    expect(body.get("code_challenge")).toBe("challenge-1");
    expect(body.get("code_challenge_method")).toBe("S256");
  });

  it("starts login by returning an auth URL with callback capture enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grok-oauth-mcp-"));
    const store = new TokenStore(join(dir, "tokens.json"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ authorization_endpoint: "https://accounts.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "captured", refresh_token: "refresh", expires_in: 3600 }));
    const auth = new AuthClient(store, fetchMock as typeof fetch);

    const result = await auth.startLogin({ timeoutMs: 1000 });
    const state = new URL(String(result.auth_url)).searchParams.get("state");
    await fetch(`http://127.0.0.1:56121/callback?code=callback-code&state=${state}`);

    expect(result.auth_url).toEqual(expect.stringContaining("https://accounts.x.ai/authorize"));
    expect(result.callback_server).toBe("listening");
    await vi.waitFor(async () => expect((await store.read())?.access_token).toBe("captured"));
  });

  it("persists pending OAuth state for manual code exchange", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grok-oauth-mcp-"));
    const store = new TokenStore(join(dir, "tokens.json"));
    const pendingStore = new PendingOAuthStore(join(dir, "pending_oauth.json"));
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ authorization_endpoint: "https://accounts.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" }));
    const auth = new AuthClient(store, fetchMock as typeof fetch, pendingStore);

    const result = await auth.startLogin({ timeoutMs: 60_000 });
    const pending = await pendingStore.read();

    expect(result.callback_server).toBe("listening");
    expect(pending).toMatchObject({
      state: new URL(String(result.auth_url)).searchParams.get("state"),
      token_endpoint: "https://auth.x.ai/token",
      redirect_uri: OAUTH_REDIRECT_URI
    });
    expect(pending?.code_verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pending?.code_challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("exchanges a bare Grok Build code using pending OAuth PKCE", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grok-oauth-mcp-"));
    const store = new TokenStore(join(dir, "tokens.json"));
    const pendingStore = new PendingOAuthStore(join(dir, "pending_oauth.json"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ authorization_endpoint: "https://accounts.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "manual", refresh_token: "refresh", expires_in: 3600 }));
    const auth = new AuthClient(store, fetchMock as typeof fetch, pendingStore);

    await auth.startLogin({ timeoutMs: 60_000 });
    const result = await auth.exchangePendingCode({ code: "manual-code" });
    const body = fetchCall(fetchMock, 1)[1].body as URLSearchParams;

    expect(result).toMatchObject({ authenticated: true, pending_cleared: true });
    expect(body.get("code")).toBe("manual-code");
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]+$/);
    await expect(store.read()).resolves.toMatchObject({ access_token: "manual" });
    await expect(pendingStore.read()).resolves.toBeNull();
  });

  it("validates state when exchanging a pasted callback URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grok-oauth-mcp-"));
    const store = new TokenStore(join(dir, "tokens.json"));
    const pendingStore = new PendingOAuthStore(join(dir, "pending_oauth.json"));
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ authorization_endpoint: "https://accounts.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" }));
    const auth = new AuthClient(store, fetchMock as typeof fetch, pendingStore);

    const login = await auth.startLogin({ timeoutMs: 60_000 });
    const state = new URL(String(login.auth_url)).searchParams.get("state");

    await expect(auth.exchangePendingCode({ callback_url: `http://127.0.0.1:56121/callback?code=manual-code&state=wrong` })).rejects.toThrow("state mismatch");
    expect((await pendingStore.read())?.state).toBe(state);
  });

  it("refreshes expired access tokens before use", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grok-oauth-mcp-"));
    const store = new TokenStore(join(dir, "tokens.json"));
    await store.write({ access_token: "old", refresh_token: "refresh", expires_at: Date.now() - 1000 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ authorization_endpoint: "https://accounts.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "new", expires_in: 3600 }));
    const auth = new AuthClient(store, fetchMock as typeof fetch);

    await expect(auth.accessToken()).resolves.toBe("new");
    const body = fetchCall(fetchMock, 1)[1].body as URLSearchParams;

    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh");
    expect(body.get("client_id")).toBe(OAUTH_CLIENT_ID);
    await expect(store.read()).resolves.toMatchObject({ access_token: "new", refresh_token: "refresh" });
  });

  it("stores tokens with owner-only permissions where supported", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grok-oauth-mcp-"));
    const path = join(dir, "tokens.json");
    const store = new TokenStore(path);

    await store.write({ access_token: "secret" });

    expect((await store.read())?.access_token).toBe("secret");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("creates base64url PKCE verifier and challenge values", () => {
    const pkce = createPkcePair();

    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.verifier).not.toBe(pkce.challenge);
  });
});
