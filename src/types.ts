import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface TokenSet {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  expires_in?: number;
  expires_at?: number;
}

export interface OAuthDiscovery {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
}

export type JsonObject = Record<string, unknown>;

export type TextToolResult = CallToolResult;
