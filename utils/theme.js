import chalk from "chalk";
import boxen from "boxen";
import figlet from "figlet";

export const theme = {
  primary: chalk.hex("#60a5fa"),
  primaryBright: chalk.hex("#93c5fd"),
  secondary: chalk.hex("#c084fc"),
  success: chalk.hex("#4ade80"),
  successDim: chalk.hex("#86efac"),
  warning: chalk.hex("#fbbf24"),
  error: chalk.hex("#f87171"),
  muted: chalk.hex("#9ca3af"),
  dim: chalk.hex("#6b7280"),
  dark: chalk.hex("#374151"),
  bg: chalk.hex("#1f2937"),
  white: chalk.hex("#f9fafb"),
  accent: chalk.hex("#f472b6"),
  cyan: chalk.hex("#22d3ee"),
  green: chalk.hex("#34d399"),
  yellow: chalk.hex("#facc15"),
  red: chalk.hex("#fb7185"),
};

export const icons = {
  vr: "🥽",
  search: "🔍",
  download: "⬇️",
  folder: "📁",
  sync: "🔄",
  update: "⬆️",
  check: "✓",
  cross: "✗",
  arrow: "→",
  back: "←",
  bullet: "•",
  star: "★",
  heart: "♥",
  info: "ℹ",
  warning: "⚠",
  package: "📦",
  game: "🎮",
  image: "🖼",
  note: "📝",
  calendar: "📅",
  size: "💾",
  version: "🔖",
  hash: "#",
};

export function divider(width = null) {
  const w = width || Math.max(40, process.stdout.columns || 80);
  return theme.dark("─".repeat(Math.min(w, 100)));
}

export function header(quest = null) {
  const termWidth = Math.max(60, process.stdout.columns || 100);
  const text = figlet.textSync("VRSRC", {
    font: "Small",
    horizontalLayout: "fitted",
    width: Math.max(40, termWidth - 8),
  });
  const lines = text.split("\n");
  const colored = lines.map((line, i) => {
    const gradient = [theme.primaryBright, theme.primary, theme.secondary, theme.cyan];
    return gradient[i % gradient.length](line);
  }).join("\n");

  let body = `${colored}\n${theme.muted("VR Release Manager")}`;
  if (quest?.connected) {
    const battery =
      quest.batteryLevel != null ? `${quest.batteryLevel}%` : theme.dim("unavailable");
    const storage = quest.storageFormatted || "? / ?";
    body +=
      `\n\n${theme.primaryBright(`${icons.vr} ${quest.model}`)}\n` +
      `${theme.white("Battery:")}     ${theme.green(battery)}\n` +
      `${theme.white("Serial no.:")}  ${theme.cyan(quest.serial)}\n` +
      `${theme.white("Storage:")}    ${theme.yellow(storage)}`;
  } else {
    body +=
      `\n\n${theme.warning(`${icons.vr} No headset detected`)}\n` +
      `${theme.dim("Connect Quest via USB · enable debugging · accept the RSA prompt")}`;
  }

  console.log(
    boxen(body, {
      padding: { top: 1, bottom: 0, left: 2, right: 2 },
      borderColor: quest?.connected ? "magenta" : "blue",
      borderStyle: "round",
      dimBorder: true,
      width: Math.max(60, termWidth - 2),
    })
  );
}
