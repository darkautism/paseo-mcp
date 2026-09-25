import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpServerConfig } from "../shared/config";
import { OAuthManager } from "../server/oauth";
import { McpProxy } from "../server/proxy";

function b64url(value: Buffer): string {
  return value.toString("base64url");
}

async function main(): Promise<void> {
  let expectedChallenge = "";
  let refreshCount = 0;
  const upstream = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const url = new URL(req.url ?? "/", origin);

    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ["mcp:use"],
      }));
      return;
    }

    if (url.pathname === "/.well-known/oauth-authorization-server") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        authorization_response_iss_parameter_supported: true,
      }));
      return;
    }

    if (url.pathname === "/register" && req.method === "POST") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        client_id: "paseo-test-client",
        token_endpoint_auth_method: "none",
      }));
      return;
    }

    if (url.pathname === "/authorize") {
      expectedChallenge = url.searchParams.get("code_challenge") ?? "";
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
      redirect.searchParams.set("code", "test-code");
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
      redirect.searchParams.set("iss", origin);
      res.statusCode = 302;
      res.setHeader("location", redirect.toString());
      res.end();
      return;
    }

    if (url.pathname === "/token" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      if (form.get("grant_type") === "authorization_code") {
        const verifier = form.get("code_verifier") ?? "";
        const actual = b64url(createHash("sha256").update(verifier).digest());
        assert.equal(actual, expectedChallenge, "PKCE challenge should match");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          access_token: "access-one",
          refresh_token: "refresh-one",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "mcp:use",
        }));
        return;
      }
      if (form.get("grant_type") === "refresh_token") {
        refreshCount += 1;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          access_token: "access-two",
          refresh_token: "refresh-one",
          token_type: "Bearer",
          expires_in: 3600,
        }));
        return;
      }
      res.statusCode = 400;
      res.end("bad grant");
      return;
    }

    if (url.pathname === "/mcp") {
      const auth = req.headers.authorization;
      if (auth !== "Bearer access-one" && auth !== "Bearer access-two") {
        res.statusCode = 401;
        res.setHeader(
          "www-authenticate",
          `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp:use"`,
        );
        res.end("auth required");
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      res.setHeader("content-type", "application/json");
      res.end(Buffer.concat(chunks));
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamOrigin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const config: McpServerConfig = {
    id: "selftest",
    name: "Self-test",
    url: `${upstreamOrigin}/mcp`,
    enabled: true,
    providers: [],
    oauth: "auto",
    clientId: "",
    scope: "",
  };

  let proxy!: McpProxy;
  const oauth = new OAuthManager(async (id) => id === config.id ? config : undefined, () => proxy.callbackUrl);
  proxy = new McpProxy(async (id) => id === config.id ? config : undefined, oauth);

  try {
    await proxy.start();
    const authUrl = await oauth.begin(config.id);
    const authorize = await fetch(authUrl, { redirect: "manual" });
    assert.equal(authorize.status, 302);
    const callback = authorize.headers.get("location");
    assert.ok(callback);
    const callbackResponse = await fetch(callback);
    assert.equal(callbackResponse.status, 200);
    assert.equal(oauth.status(config.id).state, "connected");

    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const proxied = await fetch(proxy.urlFor(config.id), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: payload,
    });
    assert.equal(proxied.status, 200);
    assert.deepEqual(await proxied.json(), JSON.parse(payload));

    // Force the proxy's 401 retry path: make the upstream reject access-one once.
    // The OAuth manager should refresh and retry with access-two.
    const original = await oauth.forceRefresh(config.id);
    assert.equal(original, "access-two");
    assert.equal(refreshCount, 1);

    console.log("oauth-proxy self-test: PASS");
  } finally {
    oauth.disconnect(config.id);
    await proxy.stop();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
