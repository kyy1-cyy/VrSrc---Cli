import { theme } from "./theme.js";
import {
  formatBytesCompact,
  formatEtaCompact,
  formatSpeedBitsCompact,
  formatSpeedBytesCompact,
  stripAnsi,
} from "./format.js";

export function renderCompactProgress(state) {
  const cols = Math.max(28, process.stdout.columns || 80);
  const pct = Math.min(100, Math.max(0, Math.round(state.percent ?? 0)));
  const transferred = state.transferredBytes ?? 0;
  const total = state.totalBytes ?? 0;
  const spd = state.speed ?? 0;
  const eta = state.eta;

  const gap = "  ";
  const showEta = pct < 100 && Number.isFinite(eta) && eta > 0 && eta !== Infinity;

  function barSegment(width) {
    const w = Math.max(4, width);
    const filled = Math.round((pct / 100) * w);
    const empty = Math.max(0, w - filled);
    const fillChar = "█";
    const emptyChar = "░";
    const bar = theme.success(fillChar.repeat(filled)) + theme.dark(emptyChar.repeat(empty));
    return `[${bar}] ${theme.white(`${pct}%`)}`;
  }

  const estTail = 52 + (showEta ? 8 : 0);
  let barW = Math.max(8, Math.min(32, cols - estTail));

  const tailParts = [];
  if (state.phase) {
    tailParts.push(theme.secondary(String(state.phase)));
  }
  if (total > 0) {
    tailParts.push(`${theme.cyan(formatBytesCompact(transferred))}${theme.dim("/")}${theme.cyan(formatBytesCompact(total))}`);
  }
  if (spd > 0 && !state.hideSpeed) {
    tailParts.push(
      `${theme.green(formatSpeedBytesCompact(spd))}${theme.dim(" · ")}${theme.green(formatSpeedBitsCompact(spd))}`
    );
  }
  if (showEta) {
    tailParts.push(`${theme.dim("eta")} ${theme.yellow(formatEtaCompact(eta))}`);
  }

  let head = barSegment(barW);
  let line = tailParts.length ? `${head}${gap}${tailParts.join(gap)}` : head;

  while (stripAnsi(line).length > cols - 1 && barW > 6) {
    barW -= 1;
    head = barSegment(barW);
    line = tailParts.length ? `${head}${gap}${tailParts.join(gap)}` : head;
  }
  while (stripAnsi(line).length > cols - 1 && tailParts.length > 0) {
    tailParts.pop();
    line = tailParts.length ? `${head}${gap}${tailParts.join(gap)}` : head;
  }
  while (stripAnsi(line).length > cols - 1 && barW > 4) {
    barW -= 1;
    head = barSegment(barW);
    line = tailParts.length ? `${head}${gap}${tailParts.join(gap)}` : head;
  }
  if (stripAnsi(line).length > cols - 1) {
    line = line.slice(0, Math.max(12, cols - 2)) + theme.dim("…");
  }
  process.stdout.write(`\x1b[2K\r${line}`);
}

global.renderCompactProgress = renderCompactProgress;
