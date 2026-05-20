import fs from "fs/promises";
import path from "path";
import { execa } from "execa";
import boxen from "boxen";
import enquirer from "enquirer";
import { theme, icons } from "../utils/theme.js";
import { ensureDirs, ensureRclone, ensure7zaExecutable, loadServerInfo, getDownloadDirectory, clearViewport } from "../utils/config.js";
import { loadGamesOrThrow, fuzzySearch, displayTitle, releaseHash, showGameImageOnly, showGameDetails } from "../utils/games.js";
import { extractArchivesInDirectory } from "../utils/archives.js";
import { renderCompactProgress } from "../utils/progress.js";
import { printSearchTable, printDownloadCancelHint } from "./search.js";
import { waitForKeypressNavigation, waitForReturn } from "./menu.js";

const { Select } = enquirer;

function parseRcloneJsonStats(line) {
  if (!line || line[0] !== "{") return null;
  try {
    const parsed = JSON.parse(line);
    if (!parsed.stats) return null;
    const stats = parsed.stats;
    if (!stats.totalBytes || stats.totalBytes <= 0) return null;
    const pct = Math.max(0, Math.min(99, Math.round((stats.bytes / stats.totalBytes) * 100)));
    return {
      percent: pct,
      speed: stats.speed || 0,
      eta: stats.eta ?? Infinity,
      transferredBytes: stats.bytes || 0,
      totalBytes: stats.totalBytes || 0,
    };
  } catch {
    return null;
  }
}

export async function runDownload(game, destination, serverInfoPath) {
  await ensureDirs();
  await ensureRclone();
  await ensure7zaExecutable();
  const info = await loadServerInfo(serverInfoPath);
  const releaseDir = path.join(destination, game.releaseName);
  await fs.mkdir(releaseDir, { recursive: true });

  const hash = releaseHash(game.releaseName);
  const source = `:http:/${hash}`;

  console.log();
  console.log(
    boxen(
      `${theme.primaryBright(`${icons.download} Download Started`)}\n\n` +
      `${theme.white("Game:")}    ${theme.primaryBright(displayTitle(game))}\n` +
      `${theme.white("Size:")}    ${theme.green(game.sizeMb ? `${game.sizeMb} MB` : "Unknown")}\n` +
      `${theme.white("Target:")}  ${theme.dim(releaseDir)}`,
      {
        padding: { left: 2, right: 2, top: 1, bottom: 1 },
        borderColor: "green",
        borderStyle: "round",
      }
    )
  );
  console.log();

  const child = execa(
    "rclone",
    [
      "copy",
      source,
      releaseDir,
      "--config",
      "/dev/null",
      "--http-url",
      info.baseUri,
      "--no-check-certificate",
      "--stats",
      "1s",
      "--stats-log-level",
      "NOTICE",
      "--use-json-log",
      "--partial-suffix",
      ".partial",
      "--transfers",
      "4",
      "--multi-thread-streams",
      "4",
      "--low-level-retries",
      "10",
      "--retries",
      "5",
    ],
    {
      stdout: "ignore",
      stderr: "pipe",
      buffer: false,
    }
  );

  let buffer = "";
  let latest = { percent: 0, speed: 0, eta: Infinity, transferredBytes: 0, totalBytes: 0 };
  let cancelled = false;
  let onKeypress = null;

  printDownloadCancelHint();
  console.log();

  if (process.stdin.isTTY) {
    const readline = await import("readline");
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    onKeypress = (str, key) => {
      if (!key) return;
      if (key.name === "escape") {
        cancelled = true;
        child.kill("SIGTERM");
      }
    };
    process.stdin.on("keypress", onKeypress);
  }

  child.stderr.on("data", async (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/[\r\n]+/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const clean = line.trim();
      const parsed = parseRcloneJsonStats(clean);
      if (parsed) {
        latest = parsed;
        renderCompactProgress(latest);
      }
    }
  });

  try {
    await child;
    renderCompactProgress({
      percent: 100,
      speed: latest.speed,
      eta: 0,
      transferredBytes: latest.totalBytes || latest.transferredBytes,
      totalBytes: latest.totalBytes,
    });
    process.stdout.write("\n\n");
    
    console.log(
      boxen(
        `${theme.success(`${icons.check} Download Complete`)}\n\n` +
        `${theme.white("Game:")}    ${theme.primaryBright(displayTitle(game))}\n` +
        `${theme.white("Saved to:")} ${theme.dim(releaseDir)}`,
        {
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          borderColor: "green",
          borderStyle: "round",
        }
      )
    );
    
    const extractResult = await extractArchivesInDirectory(releaseDir, info.passwordDecoded, theme, icons, boxen);
    if (extractResult.extracted) {
      console.log();
      console.log(
        boxen(
          `${theme.success(`${icons.check} Extraction Complete`)}\n` +
          `${theme.dim(`Extracted ${extractResult.count} archive${extractResult.count === 1 ? "" : "s"}`)}`,
          {
            padding: { left: 2, right: 2, top: 0, bottom: 0 },
            borderColor: "green",
            borderStyle: "single",
            dimBorder: true,
          }
        )
      );
    }
  } catch (error) {
    process.stdout.write("\n");
    if (cancelled) {
      await fs.rm(releaseDir, { recursive: true, force: true });
      console.log();
      console.log(
        boxen(
          `${theme.warning(`${icons.warning} Download Cancelled`)}\n` +
          `${theme.dim("Temporary files have been cleaned up")}`,
          {
            padding: { left: 2, right: 2, top: 0, bottom: 0 },
            borderColor: "yellow",
            borderStyle: "round",
          }
        )
      );
      return;
    }
    throw error;
  } finally {
    if (onKeypress) {
      const readline = await import("readline");
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }
  }
}

export async function downloadCommand(query, options) {
  const games = await loadGamesOrThrow();
  const candidates = fuzzySearch(games, query, 25, { threshold: 0.26 });

  if (!candidates.length) {
    console.log();
    console.log(
      boxen(
        `${theme.warning(`${icons.warning} No Results`)}\n` +
        `${theme.dim(`No games found matching "${query}"`)}`,
        {
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          borderColor: "yellow",
          borderStyle: "round",
        }
      )
    );
    return;
  }

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(candidates.length / pageSize));
  let selected = 0;

  while (true) {
    const page = Math.floor(selected / pageSize);
    const start = page * pageSize;
    const slice = candidates.slice(start, start + pageSize);

    clearViewport();
    console.log();
    console.log(theme.primaryBright(`${icons.download}  Search & Download`));
    console.log(theme.dark("─".repeat(40)));
    console.log(
      theme.dim(`${icons.bullet} Query: ${theme.white(query)}  ${icons.bullet} Found: ${theme.primary(candidates.length)} games`)
    );
    console.log();
    
    printSearchTable(slice, pageSize, start, selected);
    
    console.log();
    console.log(
      theme.dim(`${icons.bullet} Page ${theme.white(`${page + 1}/${totalPages}`)} `) +
      theme.dim(`(${candidates.length} results)`)
    );
    console.log();
    
    const picked = candidates[selected];
    console.log(
      boxen(
        `${theme.white("Selected:")} ${theme.primaryBright(displayTitle(picked))}\n` +
        `${theme.dim(`${icons.package} ${picked.packageName}  ${icons.size} ${picked.sizeMb || "?"} MB  ${icons.version} ${picked.versionCode || "-"}`)}`,
        {
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          borderColor: "green",
          borderStyle: "single",
          dimBorder: true,
        }
      )
    );
    
    console.log();
    console.log(
      theme.dim(`${icons.arrow} ${theme.yellow("↑/↓")} navigate  `) +
      theme.dim(`${icons.arrow} ${theme.yellow("←/→")} page  `) +
      theme.dim(`${icons.arrow} ${theme.yellow("Enter")} select  `) +
      theme.dim(`${icons.arrow} ${theme.yellow("Esc")} back`)
    );

    const key = await waitForKeypressNavigation();
    if (key === "back") return;
    if (key === "up") {
      selected = Math.max(0, selected - 1);
      continue;
    }
    if (key === "down") {
      selected = Math.min(candidates.length - 1, selected + 1);
      continue;
    }
    if (key === "left") {
      if (page <= 0) continue;
      selected = (page - 1) * pageSize;
      continue;
    }
    if (key === "right") {
      if (page >= totalPages - 1) continue;
      selected = (page + 1) * pageSize;
      continue;
    }
    if (key === "enter") {
      if (!picked) continue;
      
      await showGameImageOnly(picked, theme, icons, theme.dark.bind(theme), clearViewport, displayTitle);
      
      const { fileExists } = await import("../utils/config.js");
      
      const confirm = new Select({
        name: "confirmDownload",
        message: theme.primary(`Download ${displayTitle(picked)}?`),
        choices: [
          { name: "download", message: `${icons.download} Download now` },
          { name: "openImage", message: `${icons.image} Open image in Preview` },
          { name: "cancel", message: `${icons.cross} Cancel` },
        ],
      });
      const action = await confirm.run();
      if (action === "cancel") continue;
      if (action === "openImage") {
        if (picked.thumbnailPath && (await fileExists(picked.thumbnailPath))) {
          await execa("open", [picked.thumbnailPath], { stdio: "ignore" });
        } else {
          console.log(theme.yellow(`${icons.warning} No image file found for this game.`));
          await waitForReturn();
        }
        continue;
      }

      const target = await getDownloadDirectory(options.dest);
      await runDownload(picked, target, options.serverInfo);
      return;
    }
  }
}
