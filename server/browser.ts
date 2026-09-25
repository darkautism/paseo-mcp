import { spawn } from "node:child_process";

export async function openSystemBrowser(url: string): Promise<{ ok: boolean; error: string | null }> {
  try {
    new URL(url);
  } catch {
    return { ok: false, error: "Invalid OAuth authorization URL" };
  }

  const command =
    process.platform === "win32"
      ? { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
      : process.platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] };

  return await new Promise((resolve) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      child.unref();
      resolve({ ok: true, error: null });
    }, 250);
    timer.unref?.();

    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.once("spawn", () => {
      clearTimeout(timer);
      child.unref();
      resolve({ ok: true, error: null });
    });
  });
}
