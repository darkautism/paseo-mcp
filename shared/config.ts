import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const mcpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  enabled: z.boolean().default(true),
  providers: z.array(z.string()).default([]),
  oauth: z.enum(["auto", "none"]).default("auto"),
  clientId: z.string().default(""),
  scope: z.string().default(""),
});

export type McpServerConfig = z.infer<typeof mcpServerSchema>;

export const mcpSettings = defineSettings({
  id: "servers",
  scope: "host",
  version: 1,
  schema: z.object({
    servers: z.array(mcpServerSchema).default([]),
  }),
});
