import fs from "fs/promises";
import path from "path";
import { execa } from "execa";
import boxen from "boxen";
import ora from "ora";
import { DATA_HOME, META_ARCHIVE } from "../utils/constants.js";
import { theme, icons, divider } from "../utils/theme.js";
import { ensureDirs, ensureRclone, ensure7zaExecutable, loadServerInfo, clearDirectory } from "../utils/config.js";
import { loadGamesFromDir } from "../utils/games.js";
import { extractArchive } from "../utils/archives.js";
import { renderCompactProgress } from "../utils/progress.js";
import { printGames } from "./search.js";

export async function downloadMetaArchive(baseUri, outputDir) {
  const targetArchive = path.join(outputDir, "meta.7z");
  await fs.mkdir(outputDir, { recursive: true });

  const child = execa(
    "rclone",
    [
      "copy",
      ":http:/meta.7z",
      outputDir,
      "--config",
      "/dev/null",
      "--http-url",
      baseUri,
      "--no-check-certificate",
      "--stats",
      "1s",
      "--stats-log-level",
      "NOTICE",
      "--use-json-log",
      "--transfers",
      "4",
      "--multi-thread-streams",
      "4",
    ],
    { stdout: "ignore", stderr: "pipe", buffer: false }
  );

  let buffer = "";
  let latest = { percent: 0, speed: 0, eta: Infinity, transferredBytes: 0, totalBytes: 0 };
  child.stderr.on("data", async (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/[\r\n]+/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const clean = line.trim();
      const parsed = parseRcloneJsonStats(clean);
      if (parsed) {
        latest = parsed;
        renderCompactProgress(parsed);
      }
    }
  });

  await child;
  renderCompactProgress({
    percent: 100,
    speed: latest.speed,
    eta: 0,
    transferredBytes: latest.totalBytes || latest.transferredBytes,
    totalBytes: latest.totalBytes,
  });
  process.stdout.write("\n");
  return targetArchive;
}

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

export async function syncMeta(serverInfoPath) {
  await ensureDirs();
  await ensureRclone();
  await ensure7zaExecutable();
  const info = await loadServerInfo(serverInfoPath);
  
  console.log();
  console.log(theme.primaryBright(`${icons.sync}  Syncing Metadata`));
  console.log(divider());
  console.log(theme.dim(`${icons.bullet} Source: ${info.baseUri}`));
  console.log();
  
  const archivePath = await downloadMetaArchive(info.baseUri, DATA_HOME);
  
  console.log();
  console.log(theme.primary(`${icons.package} Extracting metadata...`));
  try {
    await extractArchive(archivePath, DATA_HOME, info.passwordDecoded, true, renderCompactProgress);
  } catch (err) {
    console.log();
    console.log(theme.error(`Extraction failed: ${err.message || String(err)}`));
    console.log(theme.dim(`Archive: ${archivePath}`));
    console.log(theme.dim(`Output: ${DATA_HOME}`));
    throw err;
  }
  await fs.rm(archivePath, { force: true });
  
  console.log();
  console.log(
    boxen(
      `${theme.success(`${icons.check} Sync Complete`)}\n` +
      `${theme.dim("Metadata successfully downloaded and extracted")}`,
      {
        padding: { left: 2, right: 2, top: 1, bottom: 1 },
        borderColor: "green",
        borderStyle: "round",
      }
    )
  );
}

export async function updateMetadata(serverInfoPath) {
  await ensureDirs();
  await ensureRclone();
  await ensure7zaExecutable();
  const info = await loadServerInfo(serverInfoPath);

  const beforeGames = await loadGamesFromDir(DATA_HOME);
  const tempRoot = path.join(DATA_HOME, "..", `meta-update-${Date.now()}`);
  const tempExtractDir = path.join(tempRoot, "extract");

  await fs.mkdir(tempExtractDir, { recursive: true });

  console.log();
  console.log(theme.primaryBright(`${icons.update}  Updating Metadata`));
  console.log(divider());
  console.log(theme.dim(`${icons.bullet} Current: ${beforeGames.length} games in cache`));
  console.log();
  
  const tempArchivePath = await downloadMetaArchive(info.baseUri, tempRoot);

  console.log();
  console.log(theme.primary(`${icons.package} Extracting new metadata...`));
  try {
    await extractArchive(tempArchivePath, tempExtractDir, info.passwordDecoded, true, renderCompactProgress);
  } catch (err) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw new Error(`Failed to extract metadata: ${err.message || String(err)}`);
  }
  process.stdout.write("\n");

  const afterGames = await loadGamesFromDir(tempExtractDir);
  const previousReleaseSet = new Set(beforeGames.map((g) => g.releaseName));
  const newReleases = afterGames.filter((g) => !previousReleaseSet.has(g.releaseName));

  const spinner = ora({
    text: theme.dim("Applying new metadata cache..."),
    spinner: "dots",
  }).start();
  
  await clearDirectory(DATA_HOME);
  const extractedEntries = await fs.readdir(tempExtractDir);
  for (const entry of extractedEntries) {
    await fs.cp(path.join(tempExtractDir, entry), path.join(DATA_HOME, entry), { recursive: true });
  }
  await fs.rm(tempArchivePath, { force: true });
  await fs.rm(tempRoot, { recursive: true, force: true });
  
  spinner.succeed(theme.success("Metadata cache updated"));

  if (newReleases.length > 0) {
    console.log();
    console.log(
      boxen(
        `${theme.success(`${icons.check} ${newReleases.length} New Release${newReleases.length === 1 ? "" : "s"} Found`)}`,
        {
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          borderColor: "green",
          borderStyle: "round",
        }
      )
    );
    console.log();
    printGames(newReleases, Math.min(10, newReleases.length), 0, newReleases.length);
    return;
  }
  
  console.log();
  console.log(
    boxen(
      `${theme.success(`${icons.check} Up to Date`)}\n` +
      `${theme.dim("No new releases found. Cache is current.")}`,
      {
        padding: { left: 2, right: 2, top: 1, bottom: 1 },
        borderColor: "green",
        borderStyle: "round",
      }
    )
  );
}
