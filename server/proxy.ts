import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { McpServerConfig } from "../shared/config";
import { OAuthManager } from "./oauth";
import { loadRuntimeState, saveRuntimePort } from "./runtime-state";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "authorization",
]);

async function readBody(req: IncomingMessage, limit = 32 * 1024 * 1024): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) throw new Error("MCP proxy request body exceeds 32 MiB");
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function copyRequestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase()) || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
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

function copyResponseHeaders(upstream: Response, res: ServerResponse): void {
  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (
      HOP_BY_HOP.has(lower) ||
      lower === "content-encoding" ||
      lower === "www-authenticate"
    ) {
      return;
    }
    res.setHeader(name, value);
  });
}

export class McpProxy {
  private readonly runtime = loadRuntimeState();
  private readonly secret = this.runtime.secret;
  private readonly server: Server;
  private startPromise: Promise<void> | null = null;
  private port: number | null = null;

  constructor(
    private readonly getConfig: (serverId: string) => Promise<McpServerConfig | undefined>,
    private readonly oauth: OAuthManager,
  ) {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
  }

  async start(): Promise<void> {
    if (this.port !== null) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      try {
        this.port = await this.listenOnce(this.runtime.port);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
        this.port = await this.listenOnce(0);
        saveRuntimePort(this.secret, this.port);
      }
    })();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private listenOnce(port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        const address = this.server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Unable to determine MCP proxy port"));
          return;
        }
        if (address.port !== this.runtime.port) {
          saveRuntimePort(this.secret, address.port);
        }
        resolve(address.port);
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(port, "127.0.0.1");
    });
  }

  get origin(): string | null {
    return this.port === null ? null : `http://127.0.0.1:${this.port}`;
  }

  get callbackUrl(): string {
    if (!this.origin) throw new Error("MCP proxy is not listening");
    return `${this.origin}/oauth/callback`;
  }

  urlFor(serverId: string): string {
    if (!this.origin) throw new Error("MCP proxy is not listening");
    return `${this.origin}/mcp/${this.secret}/${encodeURIComponent(serverId)}`;
  }

  async stop(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.port = null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (await this.oauth.handleCallback(req, res)) return;
      if (!req.url) {
        this.fail(res, 404, "Not found");
        return;
      }

      const parsed = new URL(req.url, this.origin ?? "http://127.0.0.1");
      const prefix = `/mcp/${this.secret}/`;
      if (!parsed.pathname.startsWith(prefix)) {
        this.fail(res, 404, "Not found");
        return;
      }
      const serverId = decodeURIComponent(parsed.pathname.slice(prefix.length));
      if (!serverId || serverId.includes("/")) {
        this.fail(res, 404, "Unknown MCP server");
        return;
      }
      const config = await this.getConfig(serverId);
      if (!config || !config.enabled) {
        this.fail(res, 404, "MCP server is disabled or missing");
        return;
      }

      const body = await readBody(req);
      let token = config.oauth === "none" ? undefined : await this.oauth.getAccessToken(serverId);
      let upstream = await this.forward(req, config, parsed, body, token);

      if (upstream.status === 401 && config.oauth !== "none" && token) {
        try {
          token = await this.oauth.forceRefresh(serverId);
          upstream = await this.forward(req, config, parsed, body, token);
        } catch {
          // The sanitized 401 below tells the local MCP client to stop rather than start its own OAuth flow.
        }
      }

      if (upstream.status === 401 && config.oauth !== "none") {
        this.fail(res, 401, "OAuth connection required. Open Paseo MCP and connect this server.");
        return;
      }

      res.statusCode = upstream.status;
      copyResponseHeaders(upstream, res);
      if (!upstream.body) {
        res.end();
        return;
      }
      const reader = upstream.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.fail(res, 502, `MCP proxy error: ${message}`);
    }
  }

  private async forward(
    req: IncomingMessage,
    config: McpServerConfig,
    localUrl: URL,
    body: Buffer | undefined,
    token: string | undefined,
  ): Promise<Response> {
    const target = new URL(config.url);
    for (const [key, value] of localUrl.searchParams) target.searchParams.append(key, value);

    const headers = copyRequestHeaders(req);
    if (token) headers.set("authorization", `Bearer ${token}`);

    return fetchWithTimeout(target, {
      method: req.method ?? "POST",
      headers,
      body: body && body.length > 0 ? body : undefined,
      redirect: "manual",
    }, 5 * 60_000);
  }

  private fail(res: ServerResponse, status: number, message: string): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.statusCode = status;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(message);
  }
}
