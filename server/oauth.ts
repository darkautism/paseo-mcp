import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServerConfig } from "../shared/config";
import { CredentialStore, type OAuthCredential } from "./credential-store";

type JsonObject = Record<string, unknown>;

interface ProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
}

interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  authorization_response_iss_parameter_supported?: boolean;
  client_id_metadata_document_supported?: boolean;
}

interface Discovery {
  resource: string;
  issuer: string;
  metadata: AuthorizationServerMetadata;
  challengeScope?: string;
}

interface PendingAuthorization {
  serverId: string;
  serverUrl: string;
  state: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
  discovery: Discovery;
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: string;
}

export type OAuthState = "none" | "pending" | "connected" | "error";

function base64Url(input: Buffer): string {
  return input.toString("base64url");
}

function normalizeUrl(value: string): string {
  return new URL(value).toString();
}

function oauthEndpointAllowed(value: string): boolean {
  const url = new URL(value);
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function assertOAuthEndpoint(value: string, label: string): string {
  const normalized = normalizeUrl(value);
  if (!oauthEndpointAllowed(normalized)) {
    throw new Error(`${label} must use HTTPS (loopback HTTP is allowed): ${normalized}`);
  }
  return normalized;
}

function headerParam(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  const match = header.match(new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*(?:"([^"]+)"|([^,\\s]+))`, "i"));
  return match?.[1] ?? match?.[2];
}

async function fetchWithTimeout(input: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 7000): Promise<JsonObject> {
  const response = await fetchWithTimeout(url, init ?? {}, timeoutMs);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  const value = await response.json() as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected JSON object from ${url}`);
  }
  return value as JsonObject;
}

function resourceMetadataCandidates(resourceUrl: URL): string[] {
  const suffix = resourceUrl.pathname === "/" ? "" : resourceUrl.pathname;
  const candidates = [
    new URL(`/.well-known/oauth-protected-resource${suffix}`, resourceUrl.origin).toString(),
    new URL("/.well-known/oauth-protected-resource", resourceUrl.origin).toString(),
  ];
  return [...new Set(candidates)];
}

function authorizationMetadataCandidates(issuer: URL): string[] {
  const path = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  const rfc8414 = new URL(`/.well-known/oauth-authorization-server${path}`, issuer.origin).toString();
  const appended = new URL(".well-known/oauth-authorization-server", issuer.toString().replace(/\/?$/, "/")).toString();
  const oidc = new URL(`/.well-known/openid-configuration${path}`, issuer.origin).toString();
  return [...new Set([rfc8414, appended, oidc])];
}

async function discoverAuthorizationMetadata(issuerValue: string): Promise<AuthorizationServerMetadata | null> {
  const issuer = new URL(issuerValue);
  for (const candidate of authorizationMetadataCandidates(issuer)) {
    try {
      const json = await fetchJson(candidate);
      if (
        typeof json.issuer === "string" &&
        typeof json.authorization_endpoint === "string" &&
        typeof json.token_endpoint === "string"
      ) {
        const expected = normalizeUrl(issuerValue);
        const actual = normalizeUrl(json.issuer);
        if (actual !== expected) {
          throw new Error(`Authorization metadata issuer mismatch: expected ${expected}, got ${actual}`);
        }
        return {
          issuer: actual,
          authorization_endpoint: assertOAuthEndpoint(json.authorization_endpoint, "authorization_endpoint"),
          token_endpoint: assertOAuthEndpoint(json.token_endpoint, "token_endpoint"),
          registration_endpoint:
            typeof json.registration_endpoint === "string"
              ? assertOAuthEndpoint(json.registration_endpoint, "registration_endpoint")
              : undefined,
          scopes_supported: Array.isArray(json.scopes_supported)
            ? json.scopes_supported.filter((value): value is string => typeof value === "string")
            : undefined,
          token_endpoint_auth_methods_supported: Array.isArray(json.token_endpoint_auth_methods_supported)
            ? json.token_endpoint_auth_methods_supported.filter((value): value is string => typeof value === "string")
            : undefined,
          authorization_response_iss_parameter_supported:
            json.authorization_response_iss_parameter_supported === true,
          client_id_metadata_document_supported: json.client_id_metadata_document_supported === true,
        };
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("issuer mismatch")) throw error;
    }
  }
  return null;
}

async function probeChallenge(resource: string): Promise<{ metadataUrl?: string; scope?: string }> {
  try {
    const response = await fetchWithTimeout(resource, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "paseo-mcp-oauth-probe",
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "paseo-mcp", version: "0.1.0" },
        },
      }),
      redirect: "manual",
    }, 5000);
    const challenge = response.headers.get("www-authenticate");
    return {
      metadataUrl: headerParam(challenge, "resource_metadata"),
      scope: headerParam(challenge, "scope"),
    };
  } catch {
    return {};
  }
}

async function discover(config: McpServerConfig): Promise<Discovery> {
  const resourceUrl = new URL(config.url);
  const challenge = await probeChallenge(resourceUrl.toString());
  let resourceMetadata: ProtectedResourceMetadata | undefined;

  const candidates = challenge.metadataUrl
    ? [challenge.metadataUrl]
    : resourceMetadataCandidates(resourceUrl);

  for (const candidate of candidates) {
    try {
      const candidateUrl = new URL(candidate);
      if (candidateUrl.origin !== resourceUrl.origin) {
        throw new Error("Protected Resource Metadata URL must be on the MCP server origin");
      }
      const json = await fetchJson(candidateUrl.toString());
      const authServers = Array.isArray(json.authorization_servers)
        ? json.authorization_servers.filter((value): value is string => typeof value === "string")
        : [];
      if (authServers.length === 0) continue;
      resourceMetadata = {
        resource: typeof json.resource === "string" ? json.resource : undefined,
        authorization_servers: authServers,
        scopes_supported: Array.isArray(json.scopes_supported)
          ? json.scopes_supported.filter((value): value is string => typeof value === "string")
          : undefined,
      };
      break;
    } catch (error) {
      if (challenge.metadataUrl) throw error;
    }
  }

  const resource = resourceMetadata?.resource ? normalizeUrl(resourceMetadata.resource) : normalizeUrl(config.url);
  const issuer = resourceMetadata?.authorization_servers?.[0] ?? resourceUrl.origin;
  let metadata = await discoverAuthorizationMetadata(issuer);

  if (!metadata && !resourceMetadata) {
    const legacyIssuer = normalizeUrl(resourceUrl.origin);
    metadata = {
      issuer: legacyIssuer,
      authorization_endpoint: assertOAuthEndpoint(new URL("/authorize", legacyIssuer).toString(), "authorization_endpoint"),
      token_endpoint: assertOAuthEndpoint(new URL("/token", legacyIssuer).toString(), "token_endpoint"),
      registration_endpoint: assertOAuthEndpoint(new URL("/register", legacyIssuer).toString(), "registration_endpoint"),
    };
  }

  if (!metadata) {
    throw new Error(`Unable to discover OAuth authorization metadata for ${issuer}`);
  }

  return {
    resource,
    issuer: metadata.issuer,
    metadata,
    challengeScope: challenge.scope,
  };
}

async function registerClient(
  discovery: Discovery,
  redirectUri: string,
): Promise<{ clientId: string; clientSecret?: string; tokenEndpointAuthMethod?: string }> {
  const endpoint = discovery.metadata.registration_endpoint;
  if (!endpoint) {
    throw new Error(
      "Authorization server does not provide Dynamic Client Registration. Set a clientId in the MCP entry (CIMD/static public client).",
    );
  }

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "Paseo MCP",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    }),
  }, 7000);
  if (!response.ok) {
    throw new Error(`Dynamic Client Registration failed: HTTP ${response.status} ${await response.text()}`);
  }
  const json = await response.json() as JsonObject;
  if (typeof json.client_id !== "string" || json.client_id.length === 0) {
    throw new Error("Dynamic Client Registration response is missing client_id");
  }
  return {
    clientId: json.client_id,
    clientSecret: typeof json.client_secret === "string" ? json.client_secret : undefined,
    tokenEndpointAuthMethod:
      typeof json.token_endpoint_auth_method === "string" ? json.token_endpoint_auth_method : "none",
  };
}

export class OAuthManager {
  private readonly store = new CredentialStore();
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly errors = new Map<string, string>();

  constructor(
    private readonly getConfig: (serverId: string) => Promise<McpServerConfig | undefined>,
    private readonly getCallbackUrl: () => string,
  ) {}

  status(serverId: string): { state: OAuthState; error: string | null; expiresAt: number | null } {
    const pending = [...this.pending.values()].some((value) => value.serverId === serverId);
    if (pending) return { state: "pending", error: null, expiresAt: null };
    const error = this.errors.get(serverId);
    if (error) return { state: "error", error, expiresAt: this.store.get(serverId)?.expiresAt ?? null };
    const credential = this.store.get(serverId);
    if (credential?.accessToken || credential?.refreshToken) {
      return { state: "connected", error: null, expiresAt: credential.expiresAt ?? null };
    }
    return { state: "none", error: null, expiresAt: null };
  }

  async begin(serverId: string): Promise<string> {
    this.prunePending();
    const config = await this.getConfig(serverId);
    if (!config) throw new Error("MCP server not found");
    if (config.oauth === "none") throw new Error("OAuth is disabled for this MCP server");

    const discovery = await discover(config);
    const redirectUri = this.getCallbackUrl();
    const existing = this.store.get(serverId);

    let clientId = config.clientId.trim();
    let clientSecret: string | undefined;
    let tokenEndpointAuthMethod: string | undefined;

    if (clientId) {
      clientSecret = existing?.clientId === clientId ? existing.clientSecret : undefined;
      tokenEndpointAuthMethod = existing?.clientId === clientId ? existing.tokenEndpointAuthMethod : "none";
    } else if (
      existing?.clientId &&
      existing.serverUrl === normalizeUrl(config.url) &&
      existing.redirectUri === redirectUri &&
      existing.issuer === discovery.issuer
    ) {
      clientId = existing.clientId;
      clientSecret = existing.clientSecret;
      tokenEndpointAuthMethod = existing.tokenEndpointAuthMethod;
    } else {
      const registration = await registerClient(discovery, redirectUri);
      clientId = registration.clientId;
      clientSecret = registration.clientSecret;
      tokenEndpointAuthMethod = registration.tokenEndpointAuthMethod;
    }

    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const state = base64Url(randomBytes(24));
    const authorizationUrl = new URL(discovery.metadata.authorization_endpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("resource", discovery.resource);

    const scope =
      config.scope.trim() ||
      discovery.challengeScope ||
      "";
    if (scope) authorizationUrl.searchParams.set("scope", scope);

    this.pending.set(state, {
      serverId,
      serverUrl: normalizeUrl(config.url),
      state,
      verifier,
      redirectUri,
      createdAt: Date.now(),
      discovery,
      clientId,
      clientSecret,
      tokenEndpointAuthMethod,
    });
    this.errors.delete(serverId);
    return authorizationUrl.toString();
  }

  disconnect(serverId: string): void {
    this.store.delete(serverId);
    this.errors.delete(serverId);
    for (const [state, pending] of this.pending) {
      if (pending.serverId === serverId) this.pending.delete(state);
    }
  }

  async getAccessToken(serverId: string): Promise<string | undefined> {
    const credential = this.store.get(serverId);
    if (!credential) return undefined;
    const config = await this.getConfig(serverId);
    if (!config || credential.serverUrl !== normalizeUrl(config.url)) {
      this.errors.set(serverId, "OAuth credential belongs to a different MCP URL. Reconnect OAuth.");
      return undefined;
    }
    if (
      credential.accessToken &&
      (!credential.expiresAt || credential.expiresAt > Date.now() + 60_000)
    ) {
      return credential.accessToken;
    }
    if (credential.refreshToken) {
      return this.refresh(serverId, credential);
    }
    return credential.accessToken;
  }

  async forceRefresh(serverId: string): Promise<string | undefined> {
    const credential = this.store.get(serverId);
    if (!credential) return undefined;
    const config = await this.getConfig(serverId);
    if (!config || credential.serverUrl !== normalizeUrl(config.url)) {
      this.errors.set(serverId, "OAuth credential belongs to a different MCP URL. Reconnect OAuth.");
      return undefined;
    }
    if (!credential.refreshToken) return credential.accessToken;
    return this.refresh(serverId, credential);
  }

  async handleCallback(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!req.url) return false;
    const requestUrl = new URL(req.url, this.getCallbackUrl());
    if (requestUrl.pathname !== "/oauth/callback") return false;

    const state = requestUrl.searchParams.get("state");
    const error = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");
    const responseIssuer = requestUrl.searchParams.get("iss");

    if (!state || !this.pending.has(state)) {
      this.finishBrowser(res, 400, "OAuth state is missing or expired.");
      return true;
    }
    const pending = this.pending.get(state)!;
    this.pending.delete(state);

    try {
      if (Date.now() - pending.createdAt > 10 * 60_000) {
        throw new Error("OAuth authorization expired");
      }
      if (error) {
        throw new Error(`Authorization failed: ${error}`);
      }
      if (!code) {
        throw new Error("Authorization response is missing code");
      }

      const issuerRequired = pending.discovery.metadata.authorization_response_iss_parameter_supported === true;
      if (responseIssuer) {
        if (normalizeUrl(responseIssuer) !== normalizeUrl(pending.discovery.issuer)) {
          throw new Error("Authorization response issuer mismatch");
        }
      } else if (issuerRequired) {
        throw new Error("Authorization response is missing required iss");
      }

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: pending.redirectUri,
        client_id: pending.clientId,
        code_verifier: pending.verifier,
        resource: pending.discovery.resource,
      });
      if (pending.clientSecret && pending.tokenEndpointAuthMethod !== "none") {
        body.set("client_secret", pending.clientSecret);
      }

      const tokenResponse = await fetchWithTimeout(pending.discovery.metadata.token_endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: body.toString(),
      }, 10_000);
      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: HTTP ${tokenResponse.status} ${await tokenResponse.text()}`);
      }
      const token = await tokenResponse.json() as JsonObject;
      if (typeof token.access_token !== "string") {
        throw new Error("Token response is missing access_token");
      }

      const credential: OAuthCredential = {
        serverUrl: pending.serverUrl,
        clientId: pending.clientId,
        clientSecret: pending.clientSecret,
        redirectUri: pending.redirectUri,
        issuer: pending.discovery.issuer,
        authorizationEndpoint: pending.discovery.metadata.authorization_endpoint,
        tokenEndpoint: pending.discovery.metadata.token_endpoint,
        registrationEndpoint: pending.discovery.metadata.registration_endpoint,
        tokenEndpointAuthMethod: pending.tokenEndpointAuthMethod,
        resource: pending.discovery.resource,
        accessToken: token.access_token,
        refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : undefined,
        tokenType: typeof token.token_type === "string" ? token.token_type : "Bearer",
        expiresAt: typeof token.expires_in === "number" ? Date.now() + token.expires_in * 1000 : undefined,
        scope: typeof token.scope === "string" ? token.scope : undefined,
      };
      this.store.set(pending.serverId, credential);
      this.errors.delete(pending.serverId);
      this.finishBrowser(res, 200, "MCP connected. You can close this tab and return to Paseo.");
    } catch (callbackError) {
      const message = callbackError instanceof Error ? callbackError.message : String(callbackError);
      this.errors.set(pending.serverId, message);
      this.finishBrowser(res, 400, message);
    }
    return true;
  }

  private async refresh(serverId: string, credential: OAuthCredential): Promise<string | undefined> {
    if (!credential.refreshToken) return credential.accessToken;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credential.refreshToken,
      client_id: credential.clientId,
      resource: credential.resource,
    });
    if (credential.clientSecret && credential.tokenEndpointAuthMethod !== "none") {
      body.set("client_secret", credential.clientSecret);
    }

    const response = await fetchWithTimeout(credential.tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    }, 10_000);
    if (!response.ok) {
      const message = `Token refresh failed: HTTP ${response.status} ${await response.text()}`;
      this.errors.set(serverId, message);
      throw new Error(message);
    }

    const token = await response.json() as JsonObject;
    if (typeof token.access_token !== "string") {
      throw new Error("Token refresh response is missing access_token");
    }

    const next: OAuthCredential = {
      ...credential,
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : credential.refreshToken,
      tokenType: typeof token.token_type === "string" ? token.token_type : credential.tokenType,
      expiresAt: typeof token.expires_in === "number" ? Date.now() + token.expires_in * 1000 : undefined,
      scope: typeof token.scope === "string" ? token.scope : credential.scope,
    };
    this.store.set(serverId, next);
    this.errors.delete(serverId);
    return next.accessToken;
  }

  private prunePending(): void {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [state, pending] of this.pending) {
      if (pending.createdAt < cutoff) this.pending.delete(state);
    }
  }

  private finishBrowser(res: ServerResponse, status: number, message: string): void {
    const escaped = message.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char] ?? char);
    res.statusCode = status;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(`<!doctype html><meta charset="utf-8"><title>Paseo MCP</title><body style="font-family:sans-serif;padding:2rem"><h2>Paseo MCP</h2><p>${escaped}</p></body>`);
  }
}
