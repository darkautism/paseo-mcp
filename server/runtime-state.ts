import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

interface RuntimeState {
  secret: string;
  port: number;
}

function statePath(): string {
  return (
    process.env.PASEO_MCP_RUNTIME_STATE_PATH ??
    join(homedir(), ".paseo", "plugin-data", "paseo-mcp", "runtime.json")
  );
}

function writeState(state: RuntimeState): void {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + ".tmp";
  writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

export function loadRuntimeState(): RuntimeState {
  const path = statePath();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RuntimeState>;
    if (
      typeof parsed.secret === "string" &&
      parsed.secret.length >= 24 &&
      Number.isInteger(parsed.port) &&
      (parsed.port ?? 0) > 0 &&
      (parsed.port ?? 0) <= 65535
    ) {
      return { secret: parsed.secret, port: parsed.port! };
    }
  } catch {
    // First run or corrupt state: replace it below.
  }

  const state = {
    secret: randomBytes(24).toString("base64url"),
    port: 37642,
  };
  writeState(state);
  return state;
}

export function saveRuntimePort(secret: string, port: number): void {
  writeState({ secret, port });
}
