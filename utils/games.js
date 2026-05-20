import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import Fuse from "fuse.js";
import { DATA_HOME, GAME_LIST_SUFFIX } from "./constants.js";
import { fileExists } from "./config.js";

export function gameTitle(game) {
  return game.releaseName || game.name;
}

export function displayTitle(game) {
  let t = gameTitle(game);
  let prev;
  do {
    prev = t;
    t = t.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  } while (t !== prev);
  return t;
}

export function dedupeByReleaseName(games) {
  const seen = new Set();
  const out = [];
  for (const g of games) {
    if (!g.releaseName || seen.has(g.releaseName)) continue;
    seen.add(g.releaseName);
    out.push(g);
  }
  return out;
}

export async function resolveGameListPath(baseDir = DATA_HOME) {
  const entries = await fs.readdir(baseDir);
  const found = entries.find((name) => GAME_LIST_SUFFIX.test(name));
  if (!found) return null;
  return path.join(baseDir, found);
}

export function parseGameList(content) {
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const columns = lines[0].split(";").map((c) => c.trim());
  const idx = {
    gameName: columns.indexOf("Game Name"),
    packageName: columns.indexOf("Package Name"),
    sizeMb: columns.indexOf("Size (MB)"),
    updated: columns.indexOf("Last Updated"),
    releaseName: columns.indexOf("Release Name"),
    versionCode: columns.indexOf("Version Code"),
  };

  const games = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(";");
    if (parts.length < columns.length) continue;

    const name = parts[idx.gameName]?.trim();
    const packageName = parts[idx.packageName]?.trim();
    const releaseName = parts[idx.releaseName]?.trim();
    if (!name || !packageName || !releaseName) continue;

    const sizeMb = parts[idx.sizeMb]?.trim() || "";
    const updated = parts[idx.updated]?.trim() || "";
    const versionCode = parts[idx.versionCode]?.trim() || "";
    const thumbnailPath = packageName
      ? path.join(DATA_HOME, ".meta", "thumbnails", `${packageName}.jpg`)
      : "";
    const notePath = releaseName
      ? path.join(DATA_HOME, ".meta", "notes", `${releaseName}.txt`)
      : "";
    games.push({
      name,
      packageName,
      releaseName,
      sizeMb,
      updated,
      versionCode,
      thumbnailPath,
      notePath,
    });
  }

  return games;
}

export async function loadGamesOrThrow() {
  const gameListPath = await resolveGameListPath(DATA_HOME);
  if (!gameListPath) {
    throw new Error(
      "Game list not found in cache. Run: vrsrc sync-meta"
    );
  }
  const data = await fs.readFile(gameListPath, "utf8");
  return parseGameList(data);
}

export async function loadGamesFromDir(baseDir) {
  const gameListPath = await resolveGameListPath(baseDir);
  if (!gameListPath) {
    return [];
  }
  const data = await fs.readFile(gameListPath, "utf8");
  return parseGameList(data);
}

/** Match a downloaded folder name to catalog metadata (release folder / release name / title). */
export function matchGameByFolderName(games, folderName) {
  const folder = String(folderName || "").trim();
  if (!folder) return null;

  const exact = games.find(
    (g) => g.releaseName === folder || g.packageName === folder || g.name === folder
  );
  if (exact) return exact;

  const folderLower = folder.toLowerCase();
  const exactCi = games.find(
    (g) =>
      g.releaseName?.toLowerCase() === folderLower ||
      g.packageName?.toLowerCase() === folderLower ||
      g.name?.toLowerCase() === folderLower
  );
  if (exactCi) return exactCi;

  const ranked = fuzzySearch(games, folder, 1, { threshold: 0.42 });
  return ranked[0] || null;
}

export async function listDownloadedGameFolders(downloadDir) {
  let entries;
  try {
    entries = await fs.readdir(downloadDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return folders;
}

export function fuzzySearch(games, query, limit = 20, opts = {}) {
  if (!query?.trim()) return games.slice(0, limit);

  const threshold = opts.threshold ?? 0.28;
  const fuse = new Fuse(games, {
    keys: [
      { name: "releaseName", weight: 0.45 },
      { name: "name", weight: 0.35 },
      { name: "packageName", weight: 0.2 },
    ],
    threshold,
    includeScore: true,
    ignoreLocation: false,
    minMatchCharLength: 2,
  });

  const ranked = fuse.search(query).slice(0, limit * 2).map((r) => r.item);
  return dedupeByReleaseName(ranked).slice(0, limit);
}

export function releaseHash(releaseName) {
  return crypto.createHash("md5").update(`${releaseName}\n`).digest("hex");
}

export async function showGameImageOnly(game, theme, icons, divider, clearViewport, displayTitle) {
  clearViewport();
  console.log();
  console.log(theme.primaryBright(`${icons.image}  Game Preview`));
  console.log(divider());
  console.log();
  console.log(theme.white(displayTitle(game)));
  console.log();
  
  const imageExists = game.thumbnailPath ? await fileExists(game.thumbnailPath) : false;
  if (imageExists) {
    const shownInline = await renderInlineImageIfSupported(game.thumbnailPath);
    if (!shownInline) {
      console.log(theme.dim("Inline thumbnail preview not available in this terminal."));
      console.log(theme.dim(`Image file: ${game.thumbnailPath}`));
    }
  } else {
    console.log(theme.yellow(`${icons.warning} No thumbnail available`));
  }
  console.log();
}

export async function renderInlineImageIfSupported(imagePath) {
  if (!imagePath) return false;
  if (process.env.TERM_PROGRAM !== "iTerm.app") return false;
  try {
    const raw = await fs.readFile(imagePath);
    const nameB64 = Buffer.from(path.basename(imagePath)).toString("base64");
    const dataB64 = raw.toString("base64");
    process.stdout.write(`\u001b]1337;File=name=${nameB64};inline=1;width=32:${dataB64}\u0007\n`);
    return true;
  } catch {
    return false;
  }
}

export async function showGameDetails(game, theme, icons, divider, boxen, clearViewport, displayTitle, execa, waitForReturn, fileExists, fs, path, backLabel = "Back") {
  clearViewport();
  const imageExists = game.thumbnailPath ? await fileExists(game.thumbnailPath) : false;
  const noteExists = game.notePath ? await fileExists(game.notePath) : false;
  const noteText = noteExists ? await fs.readFile(game.notePath, "utf8") : "";

  console.log();
  console.log(theme.primaryBright(`${icons.game}  Game Details`));
  console.log(divider());
  console.log();

  const infoBox = [
    `${theme.white("📱 Name:")}     ${theme.primaryBright(game.name)}`,
    `${theme.white("📦 Release:")}  ${theme.dim(game.releaseName)}`,
    `${theme.white("🔖 Package:")}  ${theme.cyan(game.packageName)}`,
    `${theme.white("🏷  Version:")}  ${theme.secondary(game.versionCode || "-")}`,
    `${theme.white("💾 Size:")}     ${theme.green(game.sizeMb ? `${game.sizeMb} MB` : "-")}`,
    `${theme.white("📅 Updated:")}  ${theme.yellow(game.updated || "-")}`,
  ].join("\n");

  console.log(
    boxen(infoBox, {
      padding: { left: 2, right: 2, top: 1, bottom: 1 },
      borderColor: "blue",
      borderStyle: "round",
      dimBorder: true,
    })
  );

  console.log();
  if (imageExists) {
    const shownInline = await renderInlineImageIfSupported(game.thumbnailPath);
    if (!shownInline) {
      console.log(theme.dim(`${icons.image} Preview not available in this terminal`));
      console.log(theme.dim(`   Location: ${game.thumbnailPath}`));
    }
  } else {
    console.log(theme.yellow(`${icons.warning} No thumbnail available`));
  }

  console.log();
  console.log(theme.primaryBright(`${icons.note} Release Notes`));
  console.log(divider());
  if (noteText?.trim()) {
    console.log(theme.white(noteText.trim()));
  } else {
    console.log(theme.dim("No release notes available."));
  }

  console.log();
  const choices = [{ name: "back", message: `${icons.back} ${backLabel}` }];
  if (imageExists) {
    choices.unshift({ name: "open", message: `${icons.image} Open image in Preview` });
  }
  
  const enquirer = await import("enquirer");
  const { Select } = enquirer.default || enquirer;
  const openChoice = new Select({
    name: "action",
    message: theme.primary("Select action"),
    choices,
  });
  
  const action = await openChoice.run();
  if (action === "open") {
    await execa("open", [game.thumbnailPath], { stdio: "ignore" });
    await waitForReturn();
  }
}
