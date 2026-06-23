import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  OAUTH_CLIENT_ID,
  OAUTH_DISCOVERY_URL,
  OAUTH_REDIRECT_HOST,
  OAUTH_REDIRECT_PATH,
  OAUTH_REDIRECT_PORT,
  OAUTH_REDIRECT_URI,
  OAUTH_SCOPE
} from "./constants.js";
import type { OAuthDiscovery, TokenSet } from "./types.js";

export type FetchLike = typeof fetch;

export function configDir(): string {
  return process.env.GROK_OAUTH_MCP_CONFIG_DIR ?? join(homedir(), ".config", "grok-oauth-mcp");
}

export function tokenPath(): string {
  return join(configDir(), "tokens.json");
}

export function pendingOAuthPath(): string {
  return join(configDir(), "pending_oauth.json");
}

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export interface PendingOAuthState {
  state: string;
  nonce: string;
  code_verifier: string;
  code_challenge: string;
  authorization_endpoint: string;
  token_endpoint: string;
  redirect_uri: string;
  created_at: number;
  expires_at: number;
}

export class TokenStore {
  constructor(private readonly path = tokenPath()) {}

  get filePath(): string {
    return this.path;
  }

  async read(): Promise<TokenSet | null> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as TokenSet;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async write(tokens: TokenSet): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    try {
      await chmod(this.path, 0o600);
    } catch {
    }
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

export class PendingOAuthStore {
  constructor(private readonly path = pendingOAuthPath()) {}

  get filePath(): string {
    return this.path;
  }

  async read(): Promise<PendingOAuthState | null> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as PendingOAuthState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async write(state: PendingOAuthState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(state, null, 2), { mode: 0o600 });
    try {
      await chmod(this.path, 0o600);
    } catch {
    }
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

export class OAuthError extends Error {
  constructor(message: string, readonly causeBody?: unknown) {
    super(message);
    this.name = "OAuthError";
  }
}

export class AuthClient {
  private pendingLogin: Promise<void> | null = null;
  private readonly pendingStore: PendingOAuthStore;

  constructor(
    private readonly store = new TokenStore(),
    private readonly fetchImpl: FetchLike = fetch,
    pendingStore?: PendingOAuthStore
  ) {
    this.pendingStore = pendingStore ?? new PendingOAuthStore(join(dirname(store.filePath), "pending_oauth.json"));
  }

  async discovery(): Promise<OAuthDiscovery> {
    const response = await this.fetchImpl(OAUTH_DISCOVERY_URL);
    if (!response.ok) throw new OAuthError(`OAuth discovery failed with HTTP ${response.status}`);
    const body = (await response.json()) as Partial<OAuthDiscovery>;
    if (!body.authorization_endpoint || !body.token_endpoint) {
      throw new OAuthError("OAuth discovery response is missing authorization_endpoint or token_endpoint", body);
    }
    return body as OAuthDiscovery;
  }

  buildAuthorizeUrl(discovery: OAuthDiscovery, state: string, challenge: string, nonce: string): string {
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", OAUTH_CLIENT_ID);
    url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
    url.searchParams.set("scope", OAUTH_SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("plan", "generic");
    url.searchParams.set("referrer", "hermes-agent");
    return url.toString();
  }

  async startLogin(options: { wait?: boolean; timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
    const discovery = await this.discovery();
    const state = randomUUID();
    const nonce = randomUUID();
    const pkce = createPkcePair();
    const authUrl = this.buildAuthorizeUrl(discovery, state, pkce.challenge, nonce);
    await this.pendingStore.write({
      state,
      nonce,
      code_verifier: pkce.verifier,
      code_challenge: pkce.challenge,
      authorization_endpoint: discovery.authorization_endpoint,
      token_endpoint: discovery.token_endpoint,
      redirect_uri: OAUTH_REDIRECT_URI,
      created_at: Date.now(),
      expires_at: Date.now() + (options.timeoutMs ?? 300_000)
    });
    if (!options.wait) {
      this.pendingLogin = waitForCallback(state, options.timeoutMs ?? 300_000)
        .then(async (code) => {
          const tokens = await this.exchangeCode(discovery, code, pkce.verifier, pkce.challenge);
          await this.store.write(tokens);
          await this.pendingStore.clear();
        })
        .finally(() => {
          this.pendingLogin = null;
        });
      this.pendingLogin.catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      });
      return { auth_url: authUrl, state, redirect_uri: OAUTH_REDIRECT_URI, callback_server: "listening", token_path: this.store.filePath };
    }
    process.stderr.write(`Open this xAI authorization URL: ${authUrl}\n`);
    const code = await waitForCallback(state, options.timeoutMs ?? 120_000);
    const tokens = await this.exchangeCode(discovery, code, pkce.verifier, pkce.challenge);
    await this.store.write(tokens);
    await this.pendingStore.clear();
    return { authenticated: true, token_path: this.store.filePath, expires_at: tokens.expires_at };
  }

  async exchangePendingCode(args: { code?: unknown; callback_url?: unknown; callbackUrl?: unknown }): Promise<Record<string, unknown>> {
    const pending = await this.pendingStore.read();
    if (!pending) throw new OAuthError("No pending OAuth login found. Run auth_login first.");
    if (pending.expires_at <= Date.now()) {
      throw new OAuthError("Pending OAuth login is expired. Run auth_login again.");
    }

    const code = parseManualCode(args, pending.state);
    const tokens = await this.exchangeCode(
      { authorization_endpoint: pending.authorization_endpoint, token_endpoint: pending.token_endpoint },
      code,
      pending.code_verifier,
      pending.code_challenge
    );
    await this.store.write(tokens);
    await this.pendingStore.clear();
    return { authenticated: true, token_path: this.store.filePath, expires_at: tokens.expires_at, pending_cleared: true };
  }

  async exchangeCode(discovery: OAuthDiscovery, code: string, verifier: string, challenge: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: OAUTH_REDIRECT_URI,
      client_id: OAUTH_CLIENT_ID,
      code_verifier: verifier,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    return this.tokenRequest(discovery.token_endpoint, body);
  }

  async refresh(tokens: TokenSet, discovery?: OAuthDiscovery): Promise<TokenSet> {
    if (!tokens.refresh_token) throw new OAuthError("No refresh_token is available. Run auth_login again.");
    const resolvedDiscovery = discovery ?? (await this.discovery());
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: OAUTH_CLIENT_ID
    });
    const refreshed = await this.tokenRequest(resolvedDiscovery.token_endpoint, body);
    const merged = { ...tokens, ...refreshed, refresh_token: refreshed.refresh_token ?? tokens.refresh_token };
    await this.store.write(merged);
    return merged;
  }

  async status(): Promise<Record<string, unknown>> {
    const tokens = await this.store.read();
    if (!tokens) return { authenticated: false, token_path: this.store.filePath };
    return {
      authenticated: true,
      token_path: this.store.filePath,
      has_refresh_token: Boolean(tokens.refresh_token),
      expires_at: tokens.expires_at,
      expires_in_seconds: tokens.expires_at ? Math.max(0, Math.floor((tokens.expires_at - Date.now()) / 1000)) : null,
      scope: tokens.scope
    };
  }

  async logout(): Promise<Record<string, unknown>> {
    await this.store.clear();
    await this.pendingStore.clear();
    return { authenticated: false, token_path: this.store.filePath };
  }

  async accessToken(): Promise<string> {
    const tokens = await this.store.read();
    if (!tokens?.access_token) throw new OAuthError("Not authenticated. Run auth_login first.");
    const expiresAt = tokens.expires_at ?? 0;
    if (tokens.refresh_token && expiresAt <= Date.now() + 60_000) {
      return (await this.refresh(tokens)).access_token;
    }
    if (expiresAt && expiresAt <= Date.now()) throw new OAuthError("Access token is expired and no refresh_token is available. Run auth_login again.");
    return tokens.access_token;
  }

  private async tokenRequest(endpoint: string, body: URLSearchParams): Promise<TokenSet> {
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const payload = await readResponse(response);
    if (!response.ok) throw new OAuthError(`OAuth token request failed with HTTP ${response.status}`, payload);
    const tokenSet = payload as TokenSet;
    if (!tokenSet.access_token) throw new OAuthError("OAuth token response did not include access_token", payload);
    return { ...tokenSet, expires_at: tokenSet.expires_in ? Date.now() + tokenSet.expires_in * 1000 : tokenSet.expires_at };
  }
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseManualCode(args: { code?: unknown; callback_url?: unknown; callbackUrl?: unknown }, expectedState: string): string {
  const callbackUrl = stringArg(args.callback_url) ?? stringArg(args.callbackUrl);
  if (callbackUrl) {
    let url: URL;
    try {
      url = new URL(callbackUrl);
    } catch {
      throw new OAuthError("callback_url is not a valid URL");
    }
    const error = url.searchParams.get("error");
    if (error) throw new OAuthError(`OAuth callback returned error: ${error}`);
    const state = url.searchParams.get("state");
    if (state !== expectedState) throw new OAuthError("OAuth callback state mismatch");
    const code = url.searchParams.get("code");
    if (!code) throw new OAuthError("OAuth callback URL is missing code");
    return code;
  }

  const code = stringArg(args.code);
  if (!code) throw new OAuthError("Provide code or callback_url from the xAI OAuth page");
  return code;
}

function stringArg(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function waitForCallback(expectedState: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", OAUTH_REDIRECT_URI);
      if (url.pathname !== OAUTH_REDIRECT_PATH) {
        response.writeHead(404).end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error) {
        response.writeHead(400).end(`OAuth error: ${error}`);
        cleanup();
        reject(new OAuthError(`OAuth callback returned error: ${error}`));
        return;
      }
      if (!code || state !== expectedState) {
        response.writeHead(400).end("Invalid OAuth callback. If xAI showed a Grok Build code, use auth_exchange_code with that code.");
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" }).end("xAI login complete. You can close this tab.");
      cleanup();
      resolve(code);
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new OAuthError("Timed out waiting for OAuth callback"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      server.close();
    };
    server.once("error", reject);
    server.listen(OAUTH_REDIRECT_PORT, OAUTH_REDIRECT_HOST);
  });
}
