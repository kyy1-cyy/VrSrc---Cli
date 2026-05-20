import fs from "fs/promises";
import path from "path";
import os from "os";
import { createWriteStream } from "fs";
import { execa } from "execa";
import { APP_HOME } from "./constants.js";
import { fileExists } from "./config.js";

const PLATFORM_TOOLS_DIR = path.join(APP_HOME, "platform-tools");
const MARKER = path.join(PLATFORM_TOOLS_DIR, ".vrsrc-adb-ready");

function adbExecutableName() {
  return process.platform === "win32" ? "adb.exe" : "adb";
}

export function getBundledAdbPath() {
  return path.join(PLATFORM_TOOLS_DIR, adbExecutableName());
}

function platformToolsZipSlug() {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "windows";
  return "linux";
}

/**
 * Download official Google platform-tools into ~/.vrsrc-cli/platform-tools (first run only).
 */
export async function ensureBundledAdb(onStatus) {
  const adbPath = getBundledAdbPath();
  if ((await fileExists(adbPath)) && (await fileExists(MARKER))) {
    if (process.platform !== "win32") {
      try {
        await fs.chmod(adbPath, 0o755);
      } catch {
        // ignore
      }
    }
    return adbPath;
  }

  const slug = platformToolsZipSlug();
  const url = `https://dl.google.com/android/repository/platform-tools-latest-${slug}.zip`;
  onStatus?.(`Downloading Android platform-tools (${slug})…`);

  await fs.mkdir(APP_HOME, { recursive: true });
  const tmpZip = path.join(os.tmpdir(), `vrsrc-platform-tools-${Date.now()}.zip`);

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download platform-tools (HTTP ${res.status}). Check network and try again.`);
  }

  const total = Number(res.headers.get("content-length") || 0);
  let received = 0;
  const logEvery = Math.max(256 * 1024, Math.floor(total / 40) || 1);

  const out = createWriteStream(tmpZip);
  try {
    for await (const chunk of res.body) {
      out.write(chunk);
      received += chunk.length;
      if (total > 0 && onStatus && (received % logEvery < chunk.length || received >= total)) {
        const pct = Math.min(100, Math.round((received / total) * 100));
        onStatus?.(
          `Downloading platform-tools… ${pct}% (${formatMb(received)} / ${formatMb(total)} MiB)`
        );
      }
    }
    await new Promise((resolve, reject) => {
      out.end(() => resolve());
      out.on("error", reject);
    });
  } catch (err) {
    out.destroy();
    await fs.rm(tmpZip, { force: true });
    throw new Error(`platform-tools download failed: ${err.message}`);
  }

  onStatus?.("Extracting platform-tools…");
  await fs.rm(PLATFORM_TOOLS_DIR, { recursive: true, force: true });
  await fs.mkdir(APP_HOME, { recursive: true });

  try {
    await execa("tar", ["-xf", tmpZip, "-C", APP_HOME], { stdio: "pipe" });
  } catch (err) {
    await fs.rm(tmpZip, { force: true });
    throw new Error(
      `Could not extract platform-tools (tar failed: ${err.message}). Install unzip/tar or set ANDROID_HOME with platform-tools.`
    );
  }

  await fs.rm(tmpZip, { force: true });

  if (!(await fileExists(adbPath))) {
    throw new Error("platform-tools extracted but adb was not found. Remove ~/.vrsrc-cli/platform-tools and retry.");
  }

  if (process.platform !== "win32") {
    await fs.chmod(adbPath, 0o755);
  }
  await fs.writeFile(MARKER, `${new Date().toISOString()}\n`, "utf8");
  onStatus?.("ADB ready.");
  return adbPath;
}

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Prefer bundled adb, then ANDROID_HOME, then PATH.
 */
export async function resolveAdbPath() {
  const bundled = getBundledAdbPath();
  if ((await fileExists(bundled)) && (await fileExists(MARKER))) {
    return bundled;
  }

  const fromEnv = process.env.ANDROID_HOME
    ? path.join(process.env.ANDROID_HOME, "platform-tools", adbExecutableName())
    : null;
  if (fromEnv && (await fileExists(fromEnv))) return fromEnv;

  try {
    const { stdout } = await execa("which", ["adb"], { stdio: "pipe" });
    const p = stdout.trim();
    if (p && (await fileExists(p))) return p;
  } catch {
    // ignore
  }

  return null;
}
