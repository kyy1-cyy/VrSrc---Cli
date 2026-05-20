#!/usr/bin/env node

import { program } from "commander";
import boxen from "boxen";
import { theme, icons } from "./utils/theme.js";
import { ensureDirs, loadServerInfo, setupServerInfo } from "./utils/config.js";
import { renderCompactProgress } from "./utils/progress.js";
import { syncMeta, updateMetadata } from "./functions/sync.js";
import { searchCommand } from "./functions/search.js";
import { browseAllGames } from "./functions/search.js";
import { downloadCommand } from "./functions/download.js";
import { doctor } from "./functions/doctor.js";
import { showMenu } from "./functions/menu.js";
import { installGamesCommand } from "./functions/quest-install.js";

global.renderCompactProgress = renderCompactProgress;

program
  .name("vrsrc")
  .description("VrSrc CLI for macOS using rclone")
  .option("--server-info <path>", "Path to ServerInfo.json")
  .option("--dest <path>", "Default download destination");

program
  .command("sync-meta")
  .description("Download and extract metadata from server")
  .action(async () => {
    const options = program.opts();
    await syncMeta(options.serverInfo);
  });

program
  .command("update-metadata")
  .description("Update metadata if newer archive exists")
  .action(async () => {
    const options = program.opts();
    await updateMetadata(options.serverInfo);
  });

program
  .command("list")
  .description("Browse all games interactively")
  .action(async () => {
    await browseAllGames();
  });

program
  .command("search <query>")
  .description("Search games by name or package")
  .option("-l, --limit <n>", "Maximum results", "20")
  .action(async (query, options) => {
    await searchCommand(query, options);
  });

program
  .command("download <query>")
  .description("Search and download a game")
  .action(async (query) => {
    const options = program.opts();
    await downloadCommand(query, { dest: options.dest, serverInfo: options.serverInfo });
  });

program
  .command("doctor")
  .description("Check system dependencies (rclone, ServerInfo, etc.)")
  .action(async () => {
    const options = program.opts();
    await doctor(options.serverInfo);
  });

program
  .command("install-games")
  .description("Install downloaded games to a connected Quest via ADB")
  .action(async () => {
    const options = program.opts();
    await installGamesCommand({ dest: options.dest });
  });

program.action(async () => {
  const options = program.opts();
  try {
    await loadServerInfo(options.serverInfo);
  } catch {
    await setupServerInfo();
  }
  await showMenu(options);
});

try {
  await ensureDirs();
  await program.parseAsync(process.argv);
} catch (error) {
  process.stdout.write("\n");
  console.log();
  console.log(
    boxen(
      `${theme.error(`${icons.cross} Error`)}\n\n` +
      `${theme.white(error.message)}`,
      {
        padding: { left: 2, right: 2, top: 1, bottom: 1 },
        borderColor: "red",
        borderStyle: "round",
      }
    )
  );
  process.exit(1);
}
