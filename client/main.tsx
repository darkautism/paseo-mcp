import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import {
  effectiveMcpNamespace,
  mcpSettings,
  normalizeMcpNamespace,
  type McpServerConfig,
} from "../shared/config";
import { oauthDisconnectRpc, oauthStartRpc, statusRpc } from "../shared/rpc";

type RuntimeStatus = {
  servers: Array<{
    id: string;
    oauthState: "none" | "pending" | "connected" | "error";
    error: string | null;
  }>;
};

function newId(): string {
  return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function compactServerUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.host}${path}`;
  } catch {
    return value;
  }
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
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);

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
        paddingHorizontal: layout.compact ? 16 : 28,
        paddingVertical: layout.compact ? 18 : 26,
        gap: 24,
      },
      header: {
        gap: 5,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: layout.compact ? 24 : 28,
        lineHeight: layout.compact ? 29 : 34,
        fontWeight: "700" as const,
        letterSpacing: -0.45,
      },
      subtitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        lineHeight: 19,
        maxWidth: 620,
      },
      section: {
        gap: 10,
      },
      sectionTitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "600" as const,
        letterSpacing: 0.2,
      },
      formRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        flexWrap: "wrap" as const,
      },
      input: {
        flexGrow: 1,
        flexBasis: 210,
        color: theme.colors.foreground,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        minWidth: 170,
      },
      primaryButton: {
        backgroundColor: theme.colors.accent,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        minHeight: 40,
        justifyContent: "center" as const,
        alignItems: "center" as const,
      },
      primaryText: {
        color: theme.colors.accentForeground,
        fontSize: 14,
        fontWeight: "600" as const,
      },
      pressed: {
        opacity: 0.72,
      },
      list: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 14,
        overflow: "hidden" as const,
      },
      serverRow: {
        paddingHorizontal: 14,
        paddingVertical: 13,
        gap: 10,
      },
      serverRowDivider: {
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      serverTopRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
      },
      serverMeta: {
        flex: 1,
        gap: 2,
        minWidth: 0,
      },
      serverName: {
        color: theme.colors.foreground,
        fontSize: 15,
        lineHeight: 20,
        fontWeight: "600" as const,
        letterSpacing: -0.08,
      },
      serverUrl: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        lineHeight: 17,
      },
      trailing: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      statusChip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 5,
      },
      statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.accent,
      },
      statusText: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        lineHeight: 14,
        fontWeight: "600" as const,
      },
      menuButton: {
        width: 34,
        height: 30,
        borderRadius: 8,
        justifyContent: "center" as const,
        alignItems: "center" as const,
      },
      menuButtonOpen: {
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      menuDots: {
        color: theme.colors.foregroundMuted,
        fontSize: 18,
        lineHeight: 20,
        letterSpacing: 1.5,
        marginTop: -4,
      },
      actionsPanel: {
        flexDirection: "row" as const,
        justifyContent: "flex-end" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        flexWrap: "wrap" as const,
      },
      actionButton: {
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      actionText: {
        color: theme.colors.foreground,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "600" as const,
      },
      dangerText: {
        color: "#d33",
        fontSize: 12,
        lineHeight: 17,
      },
      notice: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 12,
        padding: 12,
        gap: 8,
      },
      noticeTitle: {
        color: theme.colors.foreground,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "600" as const,
      },
      muted: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        lineHeight: 17,
      },
      secondaryButton: {
        alignSelf: "flex-start" as const,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      secondaryText: {
        color: theme.colors.foreground,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "600" as const,
      },
      empty: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        lineHeight: 18,
        paddingHorizontal: 2,
        paddingVertical: 8,
      },
      message: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        lineHeight: 17,
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
        <Text style={styles.dangerText}>
          MCP settings are unavailable: {"error" in settings ? String(settings.error) : "invalid settings"}
        </Text>
      </View>
    );
  }

  const values = settings.values;
  const revision = settings.revision;

  function namespaceConflict(candidate: string, exceptId?: string): string | null {
    if (!candidate) return "MCP namespace cannot be empty.";
    if (candidate === "paseo") return "'paseo' is reserved by Paseo.";
    const conflicting = values.servers.find(
      (entry) => entry.id !== exceptId && effectiveMcpNamespace(entry) === candidate,
    );
    return conflicting ? `MCP namespace '${candidate}' is already used by ${conflicting.name}.` : null;
  }

  function buildLegacyNamespaceMigration(): {
    servers: McpServerConfig[];
    changed: number;
    error: string | null;
  } {
    const used = new Set(
      values.servers.filter((entry) => entry.namespace).map((entry) => effectiveMcpNamespace(entry)),
    );
    const next: McpServerConfig[] = [];
    let changed = 0;

    for (const entry of values.servers) {
      if (entry.namespace) {
        next.push(entry);
        continue;
      }

      const candidate = normalizeMcpNamespace(entry.name);
      if (!candidate) {
        return {
          servers: values.servers,
          changed: 0,
          error: `Cannot derive an MCP namespace from '${entry.name}'.`,
        };
      }
      if (candidate === "paseo") {
        return {
          servers: values.servers,
          changed: 0,
          error: `Cannot migrate '${entry.name}': 'paseo' is reserved.`,
        };
      }
      if (used.has(candidate)) {
        return {
          servers: values.servers,
          changed: 0,
          error: `Cannot migrate '${entry.name}': MCP namespace '${candidate}' would collide.`,
        };
      }

      used.add(candidate);
      next.push({ ...entry, namespace: candidate });
      changed++;
    }

    return { servers: next, changed, error: null };
  }

  async function saveServers(next: McpServerConfig[]): Promise<boolean> {
    const ok = await settings.save({ servers: next }, revision);
    if (!ok) {
      setMessage(settings.saveError ? String(settings.saveError) : "Failed to save settings");
      setMessageIsError(true);
      return false;
    }
    setMessage(null);
    setMessageIsError(false);
    return true;
  }

  async function addServer(): Promise<void> {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !/^https?:\/\//i.test(trimmedUrl)) {
      setMessage("Name and an http(s) MCP URL are required.");
      setMessageIsError(true);
      return;
    }

    const chosenNamespace = normalizeMcpNamespace(trimmedName);
    const conflict = namespaceConflict(chosenNamespace);
    if (conflict) {
      setMessage(conflict);
      setMessageIsError(true);
      return;
    }

    const next: McpServerConfig = {
      id: newId(),
      name: trimmedName,
      namespace: chosenNamespace,
      url: trimmedUrl,
      enabled: true,
      providers: [],
      oauth: "auto",
      clientId: "",
      scope: "",
    };

    if (await saveServers([...values.servers, next])) {
      setName("");
      setUrl("");
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
      setOpenActionsId((current) => (current === id ? null : current));
    } finally {
      setBusyId(null);
    }
  }

  async function connect(id: string): Promise<void> {
    setBusyId(id);
    setMessage(null);
    setMessageIsError(false);
    try {
      const result = await startOauth({ serverId: id });
      if (result.opened) {
        setMessage("OAuth sign-in opened in your system browser.");
      } else {
        setMessage(
          `Could not open the system browser automatically: ${result.openError ?? "unknown error"}\nOpen this URL manually: ${result.authorizationUrl}`,
        );
        setMessageIsError(true);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setMessageIsError(true);
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(id: string): Promise<void> {
    setBusyId(id);
    try {
      await disconnectOauth({ serverId: id });
      setRuntime(await getStatus({}));
      setOpenActionsId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setMessageIsError(true);
    } finally {
      setBusyId(null);
    }
  }

  const legacyMigration = buildLegacyNamespaceMigration();
  const legacyServerCount = values.servers.filter((entry) => !entry.namespace).length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>MCP Servers</Text>
        <Text style={styles.subtitle}>
          Connect remote MCP servers once and make them available to your Paseo agents.
        </Text>
      </View>

      {legacyServerCount > 0 ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Update legacy server names</Text>
          <Text style={styles.muted}>
            {legacyMigration.error
              ? legacyMigration.error
              : "Use each server's display name as its stable MCP namespace."}
          </Text>
          {!legacyMigration.error ? (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              onPress={() => void saveServers(legacyMigration.servers)}
            >
              <Text style={styles.secondaryText}>Update names ({legacyMigration.changed})</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ADD SERVER</Text>
        <View style={styles.formRow}>
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
            placeholder="MCP URL"
            placeholderTextColor={theme.colors.foregroundMuted}
            onSubmitEditing={() => void addServer()}
          />
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={() => void addServer()}
          >
            <Text style={styles.primaryText}>Add server</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>SERVERS</Text>

        {values.servers.length === 0 ? (
          <Text style={styles.empty}>No MCP servers yet.</Text>
        ) : (
          <View style={styles.list}>
            {values.servers.map((entry, index) => {
              const state = runtime?.servers.find((item) => item.id === entry.id);
              const oauthState = state?.oauthState ?? "none";
              const statusLabel = !entry.enabled
                ? "Disabled"
                : oauthState === "connected"
                  ? "Connected"
                  : oauthState === "pending"
                    ? "Connecting…"
                    : oauthState === "error"
                      ? "Needs attention"
                      : "Not connected";
              const actionsOpen = openActionsId === entry.id;

              return (
                <View
                  key={entry.id}
                  style={[
                    styles.serverRow,
                    index < values.servers.length - 1 && styles.serverRowDivider,
                  ]}
                >
                  <View style={styles.serverTopRow}>
                    <View style={styles.serverMeta}>
                      <Text style={styles.serverName}>{entry.name}</Text>
                      <Text style={styles.serverUrl}>{compactServerUrl(entry.url)}</Text>
                    </View>

                    <View style={styles.trailing}>
                      <View style={styles.statusChip}>
                        {entry.enabled && oauthState === "connected" ? <View style={styles.statusDot} /> : null}
                        <Text style={styles.statusText}>{statusLabel}</Text>
                      </View>

                      <Switch
                        value={entry.enabled}
                        disabled={busyId === entry.id}
                        onValueChange={(enabled) => void patchServer(entry.id, { enabled })}
                      />

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Actions for ${entry.name}`}
                        style={({ pressed }) => [
                          styles.menuButton,
                          actionsOpen && styles.menuButtonOpen,
                          pressed && styles.pressed,
                        ]}
                        onPress={() =>
                          setOpenActionsId((current) => (current === entry.id ? null : entry.id))
                        }
                      >
                        <Text style={styles.menuDots}>•••</Text>
                      </Pressable>
                    </View>
                  </View>

                  {state?.error ? <Text style={styles.dangerText}>{state.error}</Text> : null}

                  {actionsOpen ? (
                    <View style={styles.actionsPanel}>
                      {oauthState === "connected" ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={busyId === entry.id}
                          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                          onPress={() => void disconnect(entry.id)}
                        >
                          <Text style={styles.actionText}>Sign out</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          disabled={busyId === entry.id}
                          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                          onPress={() => void connect(entry.id)}
                        >
                          <Text style={styles.actionText}>
                            {oauthState === "pending" ? "Waiting for OAuth…" : "Connect OAuth"}
                          </Text>
                        </Pressable>
                      )}

                      <Pressable
                        accessibilityRole="button"
                        disabled={busyId === entry.id}
                        style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                        onPress={() => void removeServer(entry.id)}
                      >
                        <Text style={styles.dangerText}>Remove</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {message ? (
        <Text style={messageIsError ? styles.dangerText : styles.message}>{message}</Text>
      ) : null}
      {runtimeError ? <Text style={styles.dangerText}>Runtime: {runtimeError}</Text> : null}
    </ScrollView>
  );
}
