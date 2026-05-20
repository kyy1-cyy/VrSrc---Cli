import fs from "fs/promises";
import path from "path";
import process from "process";
import os from "os";
import { execa } from "execa";
import { path7za } from "7zip-bin";
import { APP_HOME, DATA_HOME, TRAFFIC_LOG_PATH, CONFIG_PATH, SERVER_INFO_DEFAULT } from "./constants.js";

export async function ensureDirs() {
  await fs.mkdir(APP_HOME, { recursive: true });
  await fs.mkdir(DATA_HOME, { recursive: true });
  try {
    await fs.access(TRAFFIC_LOG_PATH);
  } catch {
    await fs.writeFile(TRAFFIC_LOG_PATH, "", "utf8");
  }
}

export async function loadAppConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveAppConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export async function getDownloadDirectory(explicitDest) {
  if (explicitDest) return path.resolve(explicitDest);
  const cfg = await loadAppConfig();
  if (cfg.downloadDir) return cfg.downloadDir;
  return path.join(process.cwd(), "downloads");
}

export async function chooseFolderInFinder() {
  const script = 'POSIX path of (choose folder with prompt "Select download folder for VrSrc CLI")';
  const { stdout } = await execa("osascript", ["-e", script], { stdio: "pipe" });
  return stdout.trim().replace(/\/$/, "");
}

export async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function loadServerInfo(explicitPath) {
  const candidates = [explicitPath, SERVER_INFO_DEFAULT].filter(Boolean);

  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) continue;
    const raw = await fs.readFile(candidate, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.baseUri || !parsed.password) {
      throw new Error(`Invalid ServerInfo.json at ${candidate} (missing baseUri/password)`);
    }
    return {
      path: candidate,
      baseUri: parsed.baseUri,
      passwordDecoded: parsed.password,
    };
  }

  throw new Error(
    `No ServerInfo.json found. Create one at ${SERVER_INFO_DEFAULT} or pass --server-info`
  );
}

export async function setupServerInfo() {
  const enquirer = await import("enquirer");
  const { Input } = enquirer.default || enquirer;

  console.log();
  console.log("ServerInfo.json not found. Let's set it up.");
  console.log();

  const baseUriInput = new Input({
    name: "baseUri",
    message: "Enter base URL (e.g., https://example.com)",
  });
  const baseUri = await baseUriInput.run();

  const passwordInput = new Input({
    name: "password",
    message: "Enter password (base64 encoded)",
  });
  const password = await passwordInput.run();

  const passwordDecoded = Buffer.from(password, "base64").toString("utf8");

  const serverInfo = {
    baseUri: baseUri.trim().replace(/\/$/, ""),
    password: passwordDecoded,
  };

  await fs.mkdir(APP_HOME, { recursive: true });
  await fs.writeFile(SERVER_INFO_DEFAULT, JSON.stringify(serverInfo, null, 2), "utf8");

  console.log();
  console.log(`ServerInfo.json created at ${SERVER_INFO_DEFAULT}`);
  return serverInfo;
}

export async function ensureRclone() {
  try {
    await execa("rclone", ["version"], { stdio: "ignore" });
  } catch {
    throw new Error("rclone is not installed. Install with: brew install rclone");
  }
}

export async function ensure7zaExecutable() {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return;
  }
  try {
    await fs.chmod(path7za, 0o755);
  } catch (err) {
    throw new Error(`Unable to set execute permission on 7za binary: ${err.message}`);
  }
}

export function clearViewport() {
  process.stdout.write("\x1b[2J\x1b[H");
}

export async function clearDirectory(targetDir) {
  const entries = await fs.readdir(targetDir);
  await Promise.all(
    entries.map((entry) => fs.rm(path.join(targetDir, entry), { recursive: true, force: true }))
  );
}
