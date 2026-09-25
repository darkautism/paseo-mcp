import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const oauthStateSchema = z.enum(["none", "pending", "connected", "error"]);

export const statusRpc = defineRpc({
  name: "mcp.status",
  input: z.object({}),
  output: z.object({
    proxyOrigin: z.string().nullable(),
    effectiveCallbackUrl: z.string().nullable(),
    servers: z.array(
      z.object({
        id: z.string(),
        oauthState: oauthStateSchema,
        error: z.string().nullable(),
        expiresAt: z.number().nullable(),
      }),
    ),
  }),
});

export const oauthStartRpc = defineRpc({
  name: "mcp.oauth.start",
  input: z.object({ serverId: z.string().min(1) }),
  output: z.object({
    authorizationUrl: z.string().url(),
    opened: z.boolean(),
    openError: z.string().nullable(),
  }),
});

export const oauthDisconnectRpc = defineRpc({
  name: "mcp.oauth.disconnect",
  input: z.object({ serverId: z.string().min(1) }),
  output: z.object({ ok: z.literal(true) }),
});
