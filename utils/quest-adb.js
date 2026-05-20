import fs from "fs/promises";
import path from "path";
import { execa } from "execa";
import { ensureBundledAdb, resolveAdbPath } from "./adb-bundle.js";
import { formatBytes } from "./format.js";

const QUEST_VENDOR_ID = "2833";

function parseAdbKeyValue(stdout) {
  const out = {};
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function parseAdbDevices(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const devices = [];
  for (const line of lines) {
    if (line.startsWith("List of devices")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [id, state, ...rest] = parts;
    const details = rest.join(" ");
    devices.push({ id, state, details });
  }
  return devices;
}

const QUEST_HINT = /quest|oculus|meta|hollywood|panther|eureka|monterey|seacliff/i;

function isQuestDeviceHint(...parts) {
  const blob = parts.filter(Boolean).join(" ").toLowerCase();
  return QUEST_HINT.test(blob) || blob.includes("2833");
}

function formatQuestModel(model) {
  const m = String(model || "").trim();
  if (!m) return "Quest";
  if (/quest/i.test(m)) {
    return m.replace(/meta\s*/i, "").replace(/\s+/g, " ").trim() || "Quest";
  }
  return m;
}

function parseBatteryLevel(stdout) {
  const m = String(stdout || "").match(/level:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function parseStoragePair(stdout) {
  const used = stdout.match(/Used:\s*(\d+)/i);
  const total = stdout.match(/Total:\s*(\d+)/i);
  if (used && total) {
    return {
      usedBytes: Number(used[1]),
      totalBytes: Number(total[1]),
    };
  }
  return parseDfKOutput(stdout);
}

/** Parse `df -k` lines (Android / Quest): 1K-blocks, Used, Available, mountpoint. */
function parseDfKOutput(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^Filesystem/i.test(l));

  let emulated = null;
  let largest = null;

  for (const line of lines) {
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 4) continue;

    const blocksKib = Number(parts[1]);
    const usedKib = Number(parts[2]);
    const availKib = Number(parts[3]);
    if (!Number.isFinite(blocksKib) || blocksKib <= 0) continue;
    if (!Number.isFinite(usedKib) || !Number.isFinite(availKib)) continue;

    const totalBytes = (usedKib + availKib) * 1024;
    const usedBytes = usedKib * 1024;
    const entry = { usedBytes, totalBytes };
    const mount = parts[parts.length - 1] || "";

    if (/emulated|sdcard|fuse|media_rw/i.test(`${line} ${mount}`)) {
      emulated = entry;
    }
    if (!largest || totalBytes > largest.totalBytes) {
      largest = entry;
    }
  }

  return emulated || largest;
}

async function fetchQuestStorage(adbPath, deviceId) {
  const mountPaths = ["/storage/emulated/0", "/sdcard", "/mnt/sdcard", "/data/media/0"];

  for (const mount of mountPaths) {
    try {
      const { stdout } = await runAdb(adbPath, ["shell", "df", "-k", mount], {
        deviceId,
        timeoutMs: 8000,
      });
      const parsed = parseDfKOutput(stdout);
      if (parsed?.totalBytes > 0) return parsed;
    } catch {
      // try next path
    }
  }

  try {
    const { stdout } = await runAdb(adbPath, ["shell", "df", "-k"], { deviceId, timeoutMs: 8000 });
    const parsed = parseDfKOutput(stdout);
    if (parsed?.totalBytes > 0) return parsed;
  } catch {
    // optional
  }

  try {
    const { stdout } = await runAdb(adbPath, ["shell", "dumpsys", "diskstats"], {
      deviceId,
      timeoutMs: 10000,
    });
    const dataKb = stdout.match(/Data\s+(\d+)\s+(\d+)/i);
    if (dataKb) {
      const totalBytes = Number(dataKb[1]) * 1024;
      const freeBytes = Number(dataKb[2]) * 1024;
      if (totalBytes > 0) {
        return {
          totalBytes,
          usedBytes: Math.max(0, totalBytes - freeBytes),
        };
      }
    }
  } catch {
    // optional
  }

  return null;
}

export class AdbCommandError extends Error {
  constructor(message, { command, args, stderr, stdout, exitCode } = {}) {
    super(message);
    this.name = "AdbCommandError";
    this.command = command;
    this.args = args;
    this.stderr = stderr;
    this.stdout = stdout;
    this.exitCode = exitCode;
  }

  detailBlock() {
    const lines = [this.message];
    if (this.command) lines.push(`Command: ${this.command} ${(this.args || []).join(" ")}`);
    if (this.exitCode != null) lines.push(`Exit code: ${this.exitCode}`);
    if (this.stderr?.trim()) lines.push(`stderr:\n${this.stderr.trim()}`);
    if (this.stdout?.trim()) lines.push(`stdout:\n${this.stdout.trim()}`);
    return lines.join("\n\n");
  }
}

export async function getAdbExecutable(onStatus) {
  const existing = await resolveAdbPath();
  if (existing) return existing;
  return ensureBundledAdb(onStatus);
}

async function runAdb(adbPath, args, { deviceId, timeoutMs } = {}) {
  const fullArgs = deviceId ? ["-s", deviceId, ...args] : args;
  try {
    const result = await execa(adbPath, fullArgs, {
      timeout: timeoutMs,
      reject: true,
      all: true,
    });
    return { stdout: result.stdout, stderr: result.stderr, all: result.all };
  } catch (err) {
    const stderr = err.stderr || err.all || "";
    const stdout = err.stdout || "";
    throw new AdbCommandError(
      err.shortMessage || err.message || "adb command failed",
      {
        command: adbPath,
        args: fullArgs,
        stderr,
        stdout,
        exitCode: err.exitCode,
      }
    );
  }
}

export async function detectQuestDevice(onStatus, opts = {}) {
  const adbPath = opts.allowDownload
    ? await getAdbExecutable(onStatus)
    : await resolveAdbPath();
  if (!adbPath) {
    return { connected: false, adbPath: null };
  }
  const { stdout: devicesOut } = await runAdb(adbPath, ["devices", "-l"]);
  const devices = parseAdbDevices(devicesOut).filter((d) => d.state === "device");

  if (!devices.length) {
    return { connected: false, adbPath };
  }

  let chosen = devices[0];
  for (const d of devices) {
    const low = `${d.id} ${d.details}`.toLowerCase();
    if (low.includes("quest") || low.includes("oculus") || d.id.startsWith(QUEST_VENDOR_ID)) {
      chosen = d;
      break;
    }
  }

  const deviceId = chosen.id;
  let props = {};
  try {
    const { stdout } = await runAdb(adbPath, ["shell", "getprop"], { deviceId, timeoutMs: 15000 });
    props = parseAdbKeyValue(stdout);
  } catch {
    // continue with partial info
  }

  const model = props["ro.product.model"] || props["ro.product.device"] || chosen.details || "Quest";
  const manufacturer = props["ro.product.manufacturer"] || "";
  const vendorQuest = isQuestDeviceHint(
    deviceId,
    chosen.details,
    model,
    manufacturer,
    props["ro.product.brand"]
  );

  if (!vendorQuest) {
    return { connected: false, adbPath, reason: "non_quest_device" };
  }

  if (devices.length > 1 && !isQuestDeviceHint(chosen.details, model)) {
    return { connected: false, adbPath, reason: "multiple_devices" };
  }

  let serial = props["ro.serialno"] || deviceId;
  let batteryLevel = null;
  try {
    const { stdout } = await runAdb(adbPath, ["shell", "dumpsys", "battery"], { deviceId, timeoutMs: 8000 });
    batteryLevel = parseBatteryLevel(stdout);
  } catch {
    // optional
  }

  const storage = await fetchQuestStorage(adbPath, deviceId);

  const storageFormatted = formatQuestStorage(storage);

  return {
    connected: true,
    adbPath,
    deviceId,
    model: formatQuestModel(model),
    serial,
    batteryLevel,
    storage,
    storageFormatted,
  };
}

export function formatQuestStorage(storage) {
  if (!storage?.totalBytes) return "? / ?";
  return `${formatBytes(storage.usedBytes)} / ${formatBytes(storage.totalBytes)}`;
}

export function renderQuestDeviceBox(quest, theme, icons, boxen) {
  if (!quest?.connected) return null;
  const battery =
    quest.batteryLevel != null ? `${quest.batteryLevel}%` : theme.dim("unavailable");
  const storage = formatQuestStorage(quest.storage);

  return boxen(
    `${theme.primaryBright(`${icons.vr} ${quest.model}`)}\n` +
      `${theme.white("Battery:")}     ${theme.green(battery)}\n` +
      `${theme.white("Serial no.:")}  ${theme.cyan(quest.serial)}\n` +
      `${theme.white("Storage:")}    ${theme.yellow(storage)}`,
    {
      padding: { left: 1, right: 1, top: 0, bottom: 0 },
      borderColor: "magenta",
      borderStyle: "round",
      dimBorder: true,
    }
  );
}
