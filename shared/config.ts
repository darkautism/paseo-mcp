import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const MCP_NAMESPACE_MAX_LENGTH = 64;

export function normalizeMcpNamespace(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MCP_NAMESPACE_MAX_LENGTH);
}

export function legacyMcpNamespace(id: string): string {
  const clean = normalizeMcpNamespace(id);
  return `paseo-${clean || "mcp"}`;
}

export const mcpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  namespace: z.string().default(""),
  url: z.string().url(),
  enabled: z.boolean().default(true),
  providers: z.array(z.string()).default([]),
  oauth: z.enum(["auto", "none"]).default("auto"),
  clientId: z.string().default(""),
  scope: z.string().default(""),
});

export type McpServerConfig = z.infer<typeof mcpServerSchema>;

export function effectiveMcpNamespace(
  config: Pick<McpServerConfig, "id" | "namespace">,
): string {
  const configured = normalizeMcpNamespace(config.namespace);
  return configured || legacyMcpNamespace(config.id);
}

export const mcpSettings = defineSettings({
  id: "servers",
  scope: "host",
  version: 1,
  schema: z.object({
    servers: z.array(mcpServerSchema).default([]),
  }),
});
