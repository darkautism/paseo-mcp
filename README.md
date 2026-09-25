# paseo-mcp

Independent Paseo plugin for managing remote MCP servers from one host and injecting them into Paseo agents through a shared localhost proxy.

## Requirements

- Paseo 0.9.2 or newer
- Node.js available on the Paseo daemon host

## What it does

- Adds an **MCP Servers** page to the Paseo sidebar.
- Stores the MCP server list as host-scoped Paseo plugin settings.
- Injects enabled servers through `agent.create.mcpServers`.
- Supports Paseo's built-in MCP-capable providers (`claude`, `codex`, `opencode`, `pi`, `omp`) by default.
- Allows an explicit comma-separated provider allow-list per MCP server.
- Runs one daemon-side loopback proxy, so agents never receive the upstream OAuth token.
- Supports MCP OAuth discovery through Protected Resource Metadata and RFC 8414 authorization-server metadata.
- Supports Authorization Code + PKCE, Dynamic Client Registration, RFC 9207 `iss` validation, refresh tokens, and the legacy MCP discovery fallback.
- Supports a manually supplied public `client_id` / CIMD URL for authorization servers that do not offer DCR.
- Keeps the proxy port and unprivileged proxy path secret stable across plugin reloads.

## Install

```bash
npm ci
npm run typecheck
paseo plugin install /absolute/path/to/paseo-mcp
```

Enable plugins in Paseo under **Settings -> Plugins** if the host has not enabled them yet. A newly installed plugin may require a Paseo daemon restart before its source path becomes active.

## Use

1. Open **MCP Servers** in Paseo.
2. Enter a name and the remote Streamable HTTP MCP URL.
3. Leave **Providers** blank to inject into the built-in MCP-capable providers, or enter provider IDs separated by commas.
4. If the server requires OAuth, select **Connect OAuth** and finish the browser authorization.
5. New/resumed Paseo agents receive the localhost proxy URL in their MCP configuration.

OAuth tokens are stored only on the daemon host at:

```text
~/.paseo/plugin-data/paseo-mcp/credentials.json
```

The file is created with mode `0600` where the OS supports POSIX modes. On Windows, protection relies on the user-profile ACL. Tokens are not written into Paseo agent MCP configs.

## OAuth notes

The OAuth redirect URI is loopback-only. The browser completing OAuth therefore needs network access to the same daemon host's loopback interface; the normal case is Paseo Desktop and the daemon running on the same machine.

For current MCP servers using CIMD instead of Dynamic Client Registration, provide their accepted public client metadata URL in **OAuth client_id / CIMD URL**. DCR remains supported for compatible servers.

## Development

```bash
npm run typecheck
npm test
```

The self-test starts a local protected MCP resource and authorization server, then verifies discovery, DCR, PKCE, issuer validation, token exchange, refresh, and proxy forwarding.

## License

MIT
