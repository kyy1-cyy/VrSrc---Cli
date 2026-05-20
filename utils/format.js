export function stripAnsi(s) {
  return String(s).replace(/\u001b\[[\d;]*m/g, "");
}

export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[idx]}`;
}

export function formatBytesCompact(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0";
  const u = ["B", "K", "M", "G", "T"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(v)}B`;
  const n = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(0) : v.toFixed(1);
  return `${n}${u[i]}`;
}

function formatScaledRate(bytesPerSec, scales) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return scales[0].label;
  let idx = 0;
  while (idx < scales.length - 1 && bytesPerSec >= scales[idx + 1].divisor) {
    idx += 1;
  }
  const value = bytesPerSec / scales[idx].divisor;
  const n =
    value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${n} ${scales[idx].label}`;
}

/** Binary byte transfer rate, e.g. MiB/s (from rclone bytes/sec). */
export function formatSpeedBytesCompact(bytesPerSec) {
  return formatScaledRate(bytesPerSec, [
    { divisor: 1, label: "B/s" },
    { divisor: 1024, label: "KiB/s" },
    { divisor: 1024 ** 2, label: "MiB/s" },
    { divisor: 1024 ** 3, label: "GiB/s" },
  ]);
}

/** Binary bit transfer rate, e.g. Mib/s (bytes/sec × 8). */
export function formatSpeedBitsCompact(bytesPerSec) {
  return formatScaledRate(bytesPerSec * 8, [
    { divisor: 1, label: "b/s" },
    { divisor: 1024, label: "Kib/s" },
    { divisor: 1024 ** 2, label: "Mib/s" },
    { divisor: 1024 ** 3, label: "Gib/s" },
  ]);
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatEtaCompact(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds === Infinity) return "--";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function normalizeCellText(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fitCell(text, width) {
  const raw = normalizeCellText(text);
  if (width <= 1) return raw.slice(0, 1);
  if (raw.length <= width) return raw.padEnd(width, " ");
  return `${raw.slice(0, Math.max(1, width - 1))}…`.padEnd(width, " ");
}

export function fitText(value, width) {
  const text = String(value || "-");
  if (text.length <= width) return text.padEnd(width, " ");
  if (width <= 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}
