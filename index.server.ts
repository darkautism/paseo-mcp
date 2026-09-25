import type { PluginServerContext } from "@getpaseo/plugin/server";
import { mcpSettings, type McpServerConfig } from "./shared/config";
import { oauthDisconnectRpc, oauthStartRpc, statusRpc } from "./shared/rpc";
import { OAuthManager } from "./server/oauth";
import { McpProxy } from "./server/proxy";
import { openSystemBrowser } from "./server/browser";

const DEFAULT_MCP_PROVIDERS = new Set([
  "codex",
  "claude-code",
  "claude",
  "opencode",
  "pi",
  "omp",
]);

function providerMatches(config: McpServerConfig, provider: string): boolean {
  const normalized = provider.toLowerCase();
  if (config.providers.length === 0) return DEFAULT_MCP_PROVIDERS.has(normalized);
  return config.providers.some((value) => value.toLowerCase() === normalized);
}

function keyFor(config: McpServerConfig): string {
  const clean = config.id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `paseo-${clean || "mcp"}`;
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(mcpSettings);

  async function getServers(): Promise<McpServerConfig[]> {
    const current = await settings.read();
    return current.status === "ready" ? current.values.servers : [];
  }

  async function getConfig(serverId: string): Promise<McpServerConfig | undefined> {
    return (await getServers()).find((entry) => entry.id === serverId);
  }

  let proxy!: McpProxy;
  const oauth = new OAuthManager(getConfig, () => proxy.callbackUrl);
  proxy = new McpProxy(getConfig, oauth);

  void proxy.start().catch((error) => {
    console.error("paseo-mcp proxy failed to start", error);
  });

  server.handle(statusRpc, async () => {
    await proxy.start();
    const servers = await getServers();
    return {
      proxyOrigin: proxy.origin,
      effectiveCallbackUrl: proxy.callbackUrl,
      servers: servers.map((entry) => {
        const status = oauth.status(entry.id);
        return {
          id: entry.id,
          oauthState: status.state,
          error: status.error,
          expiresAt: status.expiresAt,
        };
      }),
    };
  });

  server.handle(oauthStartRpc, async ({ serverId }) => {
    await proxy.start();
    const authorizationUrl = await oauth.begin(serverId);
    const opened = await openSystemBrowser(authorizationUrl);
    return {
      authorizationUrl,
      opened: opened.ok,
      openError: opened.error,
    };
  });

  server.handle(oauthDisconnectRpc, async ({ serverId }) => {
    oauth.disconnect(serverId);
    return { ok: true as const };
  });

  server.before("agent.create", async ({ request }) => {
    const servers = await getServers();
    const selected = servers.filter(
      (entry) => entry.enabled && providerMatches(entry, request.config.provider),
    );
    if (selected.length === 0) return request;

    await proxy.start();
    const mcpServers = { ...request.config.mcpServers };
    for (const entry of selected) {
      mcpServers[keyFor(entry)] = {
        type: "http",
        url: proxy.urlFor(entry.id),
      };
    }

    return {
      ...request,
      config: {
        ...request.config,
        mcpServers,
      },
    };
  });

  return async () => {
    await proxy.stop();
  };
}
