import fs from "fs/promises";
import path from "path";
import Seven from "node-7z";
import { path7za } from "7zip-bin";
import { execa } from "execa";
import { ensure7zaExecutable } from "./config.js";

export async function collectArchivesRecursive(rootDir) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (/\.(7z|zip)$/.test(lower)) {
        out.push(fullPath);
        continue;
      }
      if (/\.(7z|zip)\.001$/.test(lower)) {
        out.push(fullPath);
      }
    }
  }
  await walk(rootDir);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export async function extractSingleArchive(archivePath, outputDir, passwordDecoded) {
  const runExtract = (password) =>
    new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const stream = Seven.extractFull(archivePath, outputDir, {
        $bin: path7za,
        ...(password ? { password } : {}),
        $progress: true,
      });

      stream.on("progress", (progress) => {
        const pct = Math.max(0, Math.min(100, Number(progress.percent || 0)));
        const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
        const eta = pct > 0 && pct < 100
          ? Math.max(0, Math.round((elapsedSec * (100 - pct)) / pct))
          : Infinity;
        if (global.renderCompactProgress) {
          global.renderCompactProgress({
            percent: pct,
            speed: 0,
            eta,
            transferredBytes: 0,
            totalBytes: 0,
          });
        }
      });

      stream.on("end", resolve);
      stream.on("error", reject);
    });

  try {
    await runExtract(passwordDecoded);
    return;
  } catch (err) {
    if (!passwordDecoded) throw err;
  }
  await runExtract("");
}

export async function countSplitParts(archivePath) {
  const lower = archivePath.toLowerCase();
  if (!/\.(7z|zip)\.001$/.test(lower)) return 1;
  const dir = path.dirname(archivePath);
  const base = path.basename(archivePath).replace(/\.001$/i, "");
  const entries = await fs.readdir(dir);
  return entries.filter((name) => new RegExp(`^${escapeRegex(base)}\\.\\d{3}$`, "i").test(name)).length;
}

export async function deleteArchiveSet(archivePath) {
  const lower = archivePath.toLowerCase();
  if (!/\.(7z|zip)\.001$/.test(lower)) {
    await fs.rm(archivePath, { force: true });
    return 1;
  }
  const dir = path.dirname(archivePath);
  const base = path.basename(archivePath).replace(/\.001$/i, "");
  const entries = await fs.readdir(dir);
  const parts = entries.filter((name) => new RegExp(`^${escapeRegex(base)}\\.\\d{3}$`, "i").test(name));
  await Promise.all(parts.map((name) => fs.rm(path.join(dir, name), { force: true })));
  return parts.length;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function flattenRedundantExtractionLayout(rootDir) {
  let flattened = 0;
  while (true) {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const visible = entries.filter((e) => !e.name.startsWith("."));
    const files = visible.filter((e) => e.isFile());
    const dirs = visible.filter((e) => e.isDirectory());
    if (files.length > 0 || dirs.length !== 1) break;
    const child = path.join(rootDir, dirs[0].name);
    await fs.cp(child, rootDir, { recursive: true });
    await fs.rm(child, { recursive: true, force: true });
    flattened += 1;
  }
  return flattened;
}

export async function extractArchivesInDirectory(inputDir, passwordDecoded, theme, icons, boxen, extras = {}) {
  const log =
    extras.logLine ??
    ((line) => {
      console.log(line);
    });

  await ensure7zaExecutable();
  log("");
  log(theme.primary(`${icons.package} Scanning for archives...`));
  
  const processed = new Set();
  let extractedCount = 0;
  let pass = 1;

  while (true) {
    const archives = await collectArchivesRecursive(inputDir);
    const pending = archives.filter((archive) => !processed.has(archive));
    if (!pending.length) break;

    log("");
    log(
      boxen(
        `${theme.primaryBright(`${icons.package} Extraction Pass ${pass}`)}\n` +
        `${theme.dim(`${pending.length} archive${pending.length === 1 ? "" : "s"} found`)}`,
        {
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          borderColor: "blue",
          borderStyle: "single",
          dimBorder: true,
        }
      )
    );

    for (let i = 0; i < pending.length; i += 1) {
      const archive = pending[i];
      processed.add(archive);
      const partsCount = await countSplitParts(archive);
      const partSuffix = partsCount > 1 ? theme.dim(` (${partsCount} parts)`) : "";

      log(theme.dim(`  ${icons.arrow} Extracting ${theme.white(path.basename(archive))}${partSuffix}`));
      await extractSingleArchive(archive, path.dirname(archive), passwordDecoded);
      const deletedParts = await deleteArchiveSet(archive);

      if (global.renderCompactProgress) {
        global.renderCompactProgress({
          percent: 100,
          speed: 0,
          eta: 0,
          transferredBytes: 0,
          totalBytes: 0,
        });
      }
      if (!extras.logLine) {
        process.stdout.write("\n");
      }
      extractedCount += 1;
    }
    pass += 1;
  }

  if (!extractedCount) {
    log(theme.dim(`  ${icons.bullet} No archives found to extract`));
    return { extracted: false, count: 0 };
  }

  const flattened = await flattenRedundantExtractionLayout(inputDir);
  if (flattened > 0) {
    log(theme.dim(`  ${icons.bullet} Flattened ${flattened} nested folder level${flattened === 1 ? "" : "s"}`));
  }

  return { extracted: true, count: extractedCount };
}

export async function extractArchive(archivePath, outputPath, password, showProgress = false, renderCompactProgress) {
  const args = ["x", "-y", `-o${outputPath}`, archivePath];
  if (password) {
    args.push(`-p${password}`);
  }
  
  try {
    await execa(path7za, args, { stdio: "pipe" });
  } catch (err) {
    const stderr = err.stderr || "";
    const stdout = err.stdout || "";
    throw new Error(`7z extraction failed: ${stderr || stdout || err.message || String(err)}`);
  }
}
