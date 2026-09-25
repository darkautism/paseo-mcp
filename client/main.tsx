import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { mcpSettings, type McpServerConfig } from "../shared/config";
import { oauthDisconnectRpc, oauthStartRpc, statusRpc } from "../shared/rpc";
import { openExternal } from "./web";

type RuntimeStatus = {
  proxyOrigin: string | null;
  servers: Array<{
    id: string;
    oauthState: "none" | "pending" | "connected" | "error";
    error: string | null;
    expiresAt: number | null;
  }>;
};

function newId(): string {
  return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function McpSurface({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(mcpSettings);
  const getStatus = useRpc(statusRpc);
  const startOauth = useRpc(oauthStartRpc);
  const disconnectOauth = useRpc(oauthDisconnectRpc);

  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [providers, setProviders] = useState("");
  const [clientId, setClientId] = useState("");
  const [scope, setScope] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = async () => {
      try {
        const next = await getStatus({});
        if (active) {
          setRuntime(next);
          setRuntimeError(null);
        }
      } catch (error) {
        if (active) setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    };
    void refresh();
    timer = setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [getStatus]);

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
      },
      content: {
        padding: layout.compact ? 14 : 22,
        gap: 14,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: 22,
        fontWeight: "700" as const,
      },
      muted: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
      },
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        padding: 12,
        gap: 10,
      },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        flexWrap: "wrap" as const,
      },
      grow: { flex: 1 },
      input: {
        color: theme.colors.foreground,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        minWidth: 180,
      },
      button: {
        backgroundColor: theme.colors.accent,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 9,
      },
      secondaryButton: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 9,
      },
      buttonText: {
        color: theme.colors.accentForeground,
        fontWeight: "600" as const,
      },
      secondaryText: {
        color: theme.colors.foreground,
        fontWeight: "600" as const,
      },
      danger: {
        color: "#d33",
        fontSize: 12,
      },
      name: {
        color: theme.colors.foreground,
        fontSize: 16,
        fontWeight: "700" as const,
      },
      url: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
      },
      status: {
        color: theme.colors.foreground,
        fontSize: 12,
      },
    }),
    [theme, layout.compact],
  );

  if (settings.status === "loading") {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.muted}>Loading MCP settings…</Text>
      </View>
    );
  }

  if (settings.status !== "ready") {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.danger}>
          MCP settings are unavailable: {"error" in settings ? String(settings.error) : "invalid settings"}
        </Text>
      </View>
    );
  }

  const values = settings.values;
  const revision = settings.revision;

  async function saveServers(next: McpServerConfig[]): Promise<boolean> {
    const ok = await settings.save({ servers: next }, revision);
    if (!ok) {
      setMessage(settings.saveError ? String(settings.saveError) : "Failed to save settings");
      return false;
    }
    setMessage(null);
    return true;
  }

  async function addServer(): Promise<void> {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !/^https?:\/\//i.test(trimmedUrl)) {
      setMessage("Name and an http(s) MCP URL are required.");
      return;
    }
    const providerList = providers
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const next: McpServerConfig = {
      id: newId(),
      name: trimmedName,
      url: trimmedUrl,
      enabled: true,
      providers: providerList,
      oauth: "auto",
      clientId: clientId.trim(),
      scope: scope.trim(),
    };
    if (await saveServers([...values.servers, next])) {
      setName("");
      setUrl("");
      setProviders("");
      setClientId("");
      setScope("");
    }
  }

  async function patchServer(id: string, patch: Partial<McpServerConfig>): Promise<void> {
    await saveServers(values.servers.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  async function removeServer(id: string): Promise<void> {
    setBusyId(id);
    try {
      await disconnectOauth({ serverId: id });
      await saveServers(values.servers.filter((entry) => entry.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  async function connect(id: string): Promise<void> {
    setBusyId(id);
    setMessage(null);
    try {
      const result = await startOauth({ serverId: id });
      await openExternal(result.authorizationUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(id: string): Promise<void> {
    setBusyId(id);
    try {
      await disconnectOauth({ serverId: id });
      setRuntime(await getStatus({}));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View>
        <Text style={styles.title}>MCP Servers</Text>
        <Text style={styles.muted}>
          One host-side connection is injected into supported Paseo agents. OAuth tokens stay in the daemon.
        </Text>
        {runtime?.proxyOrigin ? <Text style={styles.muted}>Proxy: {runtime.proxyOrigin}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.name}>Add MCP server</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={theme.colors.foregroundMuted}
        />
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://example.com/mcp"
          placeholderTextColor={theme.colors.foregroundMuted}
        />
        <TextInput
          style={styles.input}
          value={providers}
          onChangeText={setProviders}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Providers (comma-separated; blank = built-in MCP agents)"
          placeholderTextColor={theme.colors.foregroundMuted}
        />
        <TextInput
          style={styles.input}
          value={clientId}
          onChangeText={setClientId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="OAuth client_id / CIMD URL (optional)"
          placeholderTextColor={theme.colors.foregroundMuted}
        />
        <TextInput
          style={styles.input}
          value={scope}
          onChangeText={setScope}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="OAuth scope (optional)"
          placeholderTextColor={theme.colors.foregroundMuted}
        />
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() => void addServer()}
          >
            <Text style={styles.buttonText}>Add server</Text>
          </Pressable>
        </View>
      </View>

      {values.servers.map((entry) => {
        const state = runtime?.servers.find((item) => item.id === entry.id);
        const providerLabel = entry.providers.length ? entry.providers.join(", ") : "built-in MCP providers";
        return (
          <View key={entry.id} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.grow}>
                <Text style={styles.name}>{entry.name}</Text>
                <Text style={styles.url}>{entry.url}</Text>
              </View>
              <Switch
                value={entry.enabled}
                onValueChange={(enabled) => void patchServer(entry.id, { enabled })}
              />
            </View>
            <Text style={styles.muted}>Providers: {providerLabel}</Text>
            <Text style={styles.status}>OAuth: {state?.oauthState ?? "none"}</Text>
            {state?.expiresAt ? (
              <Text style={styles.muted}>Token expires: {new Date(state.expiresAt).toLocaleString()}</Text>
            ) : null}
            {state?.error ? <Text style={styles.danger}>{state.error}</Text> : null}
            <View style={styles.row}>
              {state?.oauthState === "connected" ? (
                <Pressable
                  accessibilityRole="button"
                  style={styles.secondaryButton}
                  disabled={busyId === entry.id}
                  onPress={() => void disconnect(entry.id)}
                >
                  <Text style={styles.secondaryText}>Sign out</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  style={styles.button}
                  disabled={busyId === entry.id}
                  onPress={() => void connect(entry.id)}
                >
                  <Text style={styles.buttonText}>
                    {state?.oauthState === "pending" ? "Waiting for OAuth…" : "Connect OAuth"}
                  </Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                style={styles.secondaryButton}
                disabled={busyId === entry.id}
                onPress={() => void removeServer(entry.id)}
              >
                <Text style={styles.secondaryText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {message ? <Text style={styles.danger}>{message}</Text> : null}
      {runtimeError ? <Text style={styles.danger}>Runtime: {runtimeError}</Text> : null}
    </ScrollView>
  );
}
