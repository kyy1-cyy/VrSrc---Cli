import readline from "readline";
import enquirer from "enquirer";
import boxen from "boxen";
import { theme, icons, header } from "../utils/theme.js";
import { getDownloadDirectory, chooseFolderInFinder, loadAppConfig, saveAppConfig } from "../utils/config.js";
import { syncMeta, updateMetadata } from "./sync.js";
import { browseAllGames, searchCommand } from "./search.js";
import { downloadCommand } from "./download.js";
import { doctor } from "./doctor.js";
import { detectQuestDevice } from "../utils/quest-adb.js";
import { installGamesCommand } from "./quest-install.js";

const { Select, Input } = enquirer;

export async function waitForReturn() {
  const back = new Input({
    name: "back",
    message: "Press enter to return",
  });
  await back.run();
}

export function waitForKeypressNavigation() {
  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeypress = (str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }
      if (key.name === "left") {
        cleanup();
        resolve("left");
        return;
      }
      if (key.name === "up") {
        cleanup();
        resolve("up");
        return;
      }
      if (key.name === "down") {
        cleanup();
        resolve("down");
        return;
      }
      if (key.name === "right") {
        cleanup();
        resolve("right");
        return;
      }
      if (key.name === "escape") {
        cleanup();
        resolve("back");
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve("enter");
      }
    };

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    }

    process.stdin.on("keypress", onKeypress);
  });
}

export async function showMenu(options) {
  while (true) {
    console.clear();

    let quest = { connected: false };
    try {
      quest = await detectQuestDevice(undefined, { allowDownload: true });
    } catch {
      quest = { connected: false };
    }

    header(quest);

    const activeDir = await getDownloadDirectory(options.dest);
    
    console.log();
    console.log(
      boxen(
        `${theme.primaryBright(`${icons.folder} Download Directory`)}\n` +
        `${theme.dim(activeDir)}`,
        {
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          borderColor: "blue",
          borderStyle: "single",
          dimBorder: true,
        }
      )
    );
    console.log();

    const menuChoices = [
      { name: "sync", message: `${icons.sync}  Sync metadata from server` },
      { name: "updateMeta", message: `${icons.update}  Update metadata` },
      { name: "changeDir", message: `${icons.folder}  Change download directory` },
      { name: "search", message: `${icons.search}  Search games` },
      { name: "list", message: `${icons.game}  Browse all games` },
      { name: "download", message: `${icons.download}  Search and download` },
    ];

    if (quest.connected) {
      menuChoices.push({
        name: "installGames",
        message: `${icons.vr}  Install games (Quest connected)`,
      });
    }

    menuChoices.push(
      { name: "doctor", message: `${icons.check}  System check` },
      { name: "exit", message: `${icons.cross}  Exit` }
    );

    const selector = new Select({
      name: "menu",
      message: theme.primary("Select an action"),
      choices: menuChoices,
    });

    const action = await selector.run();
    if (action === "exit") return;

    if (action === "sync") {
      await syncMeta(options.serverInfo);
      await waitForReturn();
      continue;
    }
    if (action === "updateMeta") {
      await updateMetadata(options.serverInfo);
      await waitForReturn();
      continue;
    }
    if (action === "changeDir") {
      try {
        const selectedDir = await chooseFolderInFinder();
        const config = await loadAppConfig();
        config.downloadDir = selectedDir;
        await saveAppConfig(config);
        console.log();
        console.log(
          boxen(
            `${theme.success(`${icons.check} Directory Updated`)}\n` +
            `${theme.dim(selectedDir)}`,
            {
              padding: { left: 1, right: 1, top: 0, bottom: 0 },
              borderColor: "green",
              borderStyle: "round",
            }
          )
        );
      } catch (err) {
        console.log();
        console.log(
          boxen(
            `${theme.warning(`${icons.warning} Selection Cancelled`)}`,
            {
              padding: { left: 1, right: 1, top: 0, bottom: 0 },
              borderColor: "yellow",
              borderStyle: "round",
            }
          )
        );
      }
      await waitForReturn();
      continue;
    }

    if (action === "doctor") {
      await doctor(options.serverInfo);
      await waitForReturn();
      continue;
    }

    if (action === "installGames") {
      await installGamesCommand({ dest: options.dest });
      await waitForReturn();
      continue;
    }

    if (action === "list") {
      await browseAllGames();
      continue;
    }

    const input = new Input({
      name: "query",
      message: theme.primary("Enter game name or package"),
    });
    const query = await input.run();

    if (action === "search") {
      await searchCommand(query, { limit: 20 });
      await waitForReturn();
      continue;
    }

    if (action === "download") {
      await downloadCommand(query, {
        dest: options.dest,
        serverInfo: options.serverInfo,
      });
      await waitForReturn();
      continue;
    }
  }
}
