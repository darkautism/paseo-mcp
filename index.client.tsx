import type { PluginClientContext } from "@getpaseo/plugin/client";
import { McpSurface } from "./client/main";

export default function contribute(client: PluginClientContext) {
  client.addSurface("mcp-servers", McpSurface);
  client.addSidebarItem({
    id: "mcp-servers",
    title: "MCP Servers",
    icon: "Plug",
    surface: "mcp-servers",
  });
  return () => {};
}
