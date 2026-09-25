import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface OAuthCredential {
  serverUrl: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  tokenEndpointAuthMethod?: string;
  resource: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: number;
  scope?: string;
}

type CredentialFile = Record<string, OAuthCredential>;

export class CredentialStore {
  private readonly path: string;
  private values: CredentialFile = {};

  constructor(
    path =
      process.env.PASEO_MCP_CREDENTIAL_PATH ??
      join(homedir(), ".paseo", "plugin-data", "paseo-mcp", "credentials.json"),
  ) {
    this.path = path;
    this.load();
  }

  get(serverId: string): OAuthCredential | undefined {
    const value = this.values[serverId];
    return value ? { ...value } : undefined;
  }

  set(serverId: string, credential: OAuthCredential): void {
    this.values[serverId] = { ...credential };
    this.flush();
  }

  delete(serverId: string): void {
    if (!(serverId in this.values)) return;
    delete this.values[serverId];
    this.flush();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        this.values = parsed as CredentialFile;
      }
    } catch {
      this.values = {};
    }
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tempPath = this.path + ".tmp";
    writeFileSync(tempPath, JSON.stringify(this.values, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, this.path);
  }
}
