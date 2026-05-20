import boxen from "boxen";
import enquirer from "enquirer";
import { theme, icons } from "../utils/theme.js";
import { stripAnsi, fitCell } from "../utils/format.js";
import { clearViewport } from "../utils/config.js";
import { loadGamesOrThrow, gameTitle, displayTitle, fuzzySearch, showGameDetails, showGameImageOnly } from "../utils/games.js";
import { waitForKeypressNavigation, waitForReturn } from "./menu.js";

const { Select } = enquirer;

export function printDownloadCancelHint() {
  console.log(theme.dim(`${icons.warning} Press ${theme.yellow("Esc")} to cancel download`));
}

export function printGames(games, limit = 15, startIndex = 0, totalInDataset = null, selectedAbsoluteIndex = null) {
  const termWidth = Math.max(48, process.stdout.columns || 100);
  const numW = 5;
  const sizeW = 12;
  const dateW = Math.min(16, Math.max(10, Math.floor(termWidth * 0.15)));
  const verW = 8;
  const sep = theme.dark(" │ ");
  const sepPlain = 3;
  const narrow = termWidth < 90;
  const sepCount = narrow ? 4 : 5;
  const fixed = numW + sizeW + dateW + verW + sepCount * sepPlain;
  let pkgW = 0;
  let titleW;
  if (narrow) {
    titleW = Math.max(20, termWidth - fixed);
  } else {
    const flex = Math.max(35, termWidth - fixed);
    pkgW = Math.max(12, Math.floor(flex * 0.3));
    titleW = Math.max(20, flex - pkgW);
  }

  const headerCells = [
    theme.dim("#".padStart(numW)),
    theme.primaryBright("Title".padEnd(titleW)),
  ];
  if (!narrow) headerCells.push(theme.dim("Package".padEnd(pkgW)));
  headerCells.push(
    theme.cyan("Size".padEnd(sizeW)),
    theme.secondary("Ver".padEnd(verW)),
    theme.muted("Updated".padEnd(dateW))
  );

  const headerLine = headerCells.join(sep);
  const ruleLen = stripAnsi(headerLine).length;
  const rule = theme.dark("━".repeat(Math.min(ruleLen, termWidth)));

  console.log();
  console.log(headerLine);
  console.log(rule);

  const rows = games.slice(0, limit);
  rows.forEach((game, i) => {
    const absoluteIndex = startIndex + i;
    const size = game.sizeMb ? `${game.sizeMb} MB` : "-";
    const isSelected = selectedAbsoluteIndex === absoluteIndex;
    
    const cells = [
      isSelected ? theme.white(String(absoluteIndex + 1).padStart(numW)) : theme.dim(String(absoluteIndex + 1).padStart(numW)),
      isSelected ? theme.white(fitCell(displayTitle(game), titleW)) : theme.white(fitCell(displayTitle(game), titleW)),
    ];
    if (!narrow) cells.push(theme.dim(fitCell(game.packageName, pkgW)));
    cells.push(
      theme.cyan(fitCell(size, sizeW)),
      theme.secondary(fitCell(game.versionCode || "-", verW)),
      theme.muted(fitCell(game.updated || "-", dateW))
    );
    
    const rowLine = cells.join(sep);
    if (isSelected) {
      console.log(theme.primaryBright(`▶ ${rowLine}`));
      return;
    }
    console.log(rowLine);
  });

  const lo = startIndex + 1;
  const hi = startIndex + rows.length;
  const total = totalInDataset ?? games.length;
  console.log();
  if (totalInDataset != null) {
    console.log(theme.dim(`${icons.bullet} Showing ${theme.white(`${lo}-${hi}`)} of ${theme.primary(total)} games`));
  } else {
    console.log(theme.dim(`${icons.bullet} Showing ${theme.white(`${lo}-${hi}`)} games`));
  }
}

export function printSearchTable(games, limit = 10, startIndex = 0, selectedAbsoluteIndex = null) {
  const termWidth = Math.max(64, process.stdout.columns || 100);
  const numW = 5;
  const sizeW = 12;
  const verW = 10;
  const dateW = Math.min(16, Math.max(10, Math.floor(termWidth * 0.15)));
  const sep = theme.dark(" │ ");
  const sepCount = 5;
  const fixed = numW + sizeW + verW + dateW + sepCount * 3;
  const pkgW = Math.max(15, Math.floor((termWidth - fixed) * 0.35));
  const titleW = Math.max(25, termWidth - fixed - pkgW);

  console.log();
  
  const header = [
    theme.dim("#".padStart(numW)),
    theme.primaryBright("Title".padEnd(titleW)),
    theme.dim("Package".padEnd(pkgW)),
    theme.cyan("Size".padEnd(sizeW)),
    theme.secondary("Ver".padEnd(verW)),
    theme.muted("Updated".padEnd(dateW)),
  ].join(sep);
  
  console.log(header);
  console.log(theme.dark("━".repeat(Math.min(stripAnsi(header).length, termWidth))));

  const rows = games.slice(0, limit);
  rows.forEach((game, i) => {
    const absoluteIndex = startIndex + i;
    const isSelected = selectedAbsoluteIndex === absoluteIndex;
    const size = game.sizeMb ? `${game.sizeMb} MB` : "-";
    
    const line = [
      isSelected ? theme.white(String(absoluteIndex + 1).padStart(numW)) : theme.dim(String(absoluteIndex + 1).padStart(numW)),
      isSelected ? theme.primaryBright(fitCell(displayTitle(game), titleW)) : theme.white(fitCell(displayTitle(game), titleW)),
      theme.dim(fitCell(game.packageName, pkgW)),
      theme.cyan(fitCell(size, sizeW)),
      theme.secondary(fitCell(game.versionCode || "-", verW)),
      theme.muted(fitCell(game.updated || "-", dateW)),
    ].join(sep);
    
    if (isSelected) {
      console.log(theme.primaryBright(`▶ ${line}`));
      return;
    }
    console.log(line);
  });
}

export async function browseAllGames() {
  const all = await loadGamesOrThrow();
  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  let selected = 0;

  while (true) {
    const page = Math.floor(selected / pageSize);
    clearViewport();
    
    console.log();
    console.log(theme.primaryBright(`${icons.game}  All Games`));
    console.log(theme.dark("─".repeat(40)));
    console.log();
    
    const start = page * pageSize;
    const slice = all.slice(start, start + pageSize);
    printGames(slice, pageSize, start, all.length, selected);
    
    console.log();
    console.log(
      theme.dim(`${icons.bullet} Page ${theme.white(`${page + 1}/${totalPages}`)} `) +
      theme.dim("  ") +
      theme.dim(`Total: ${theme.primary(all.length)} games`)
    );
    console.log();
    
    const currentGame = all[selected];
    console.log(
      boxen(
        `${theme.white("Selected:")} ${theme.primaryBright(displayTitle(currentGame))}\n` +
        `${theme.dim(`${icons.package} ${currentGame.packageName}  ${icons.size} ${currentGame.sizeMb || "?"} MB`)}`,
        {
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          borderColor: "blue",
          borderStyle: "single",
          dimBorder: true,
        }
      )
    );
    
    console.log();
    console.log(
      theme.dim(`${icons.arrow} ${theme.yellow("↑/↓")} navigate  `) +
      theme.dim(`${icons.arrow} ${theme.yellow("←/→")} page  `) +
      theme.dim(`${icons.arrow} ${theme.yellow("Enter")} details  `) +
      theme.dim(`${icons.arrow} ${theme.yellow("Esc")} back`)
    );

    const key = await waitForKeypressNavigation();
    if (key === "back") return;
    if (key === "up") {
      selected = Math.max(0, selected - 1);
      continue;
    }
    if (key === "down") {
      selected = Math.min(all.length - 1, selected + 1);
      continue;
    }
    if (key === "left") {
      if (page <= 0) continue;
      const prevPage = page - 1;
      selected = prevPage * pageSize;
      continue;
    }
    if (key === "right") {
      if (page >= totalPages - 1) continue;
      const nextPage = page + 1;
      selected = nextPage * pageSize;
      continue;
    }
    if (key === "enter" && all[selected]) {
      await showGameDetails(all[selected], theme, icons, theme.dark.bind(theme), boxen, clearViewport, displayTitle, (await import("execa")).execa, waitForReturn, (await import("../utils/config.js")).fileExists, (await import("fs/promises")).default, (await import("path")).default);
    }
  }
}

export async function searchCommand(query, options) {
  const games = await loadGamesOrThrow();
  const results = fuzzySearch(games, query, Number(options.limit) || 20);
  if (!results.length) {
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
  
  while (true) {
    clearViewport();
    console.log();
    console.log(
      theme.primaryBright(`${icons.search}  Search Results`)
    );
    console.log(theme.dark("─".repeat(40)));
    console.log(
      theme.dim(`${icons.bullet} Query: ${theme.white(query)}  ${icons.bullet} Found: ${theme.primary(results.length)} games`)
    );
    console.log();
    
    printSearchTable(results, Number(options.limit) || 20, 0, null);
    
    const choices = results.map((game, idx) => ({
      name: String(idx),
      message: `${theme.dim(String(idx + 1).padStart(3))}  ${theme.white(displayTitle(game))}`,
    }));
    choices.push({ name: "back", message: `${icons.back} Back` });
    
    const picker = new Select({
      name: "searchResultPick",
      message: theme.primary("Select a game to view details"),
      choices,
      pageSize: Math.min(15, choices.length),
    });
    
    const selected = await picker.run();
    if (selected === "back") return;
    const idx = Number(selected);
    if (!Number.isFinite(idx) || !results[idx]) return;
    await showGameDetails(results[idx], theme, icons, theme.dark.bind(theme), boxen, clearViewport, displayTitle, (await import("execa")).execa, waitForReturn, (await import("../utils/config.js")).fileExists, (await import("fs/promises")).default, (await import("path")).default, "Back to Search results");
  }
}
