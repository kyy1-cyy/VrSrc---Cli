import boxen from "boxen";
import { theme, icons } from "../utils/theme.js";
import { ensureRclone, ensure7zaExecutable, loadServerInfo, fileExists } from "../utils/config.js";
import { SERVER_INFO_DEFAULT, DATA_HOME } from "../utils/constants.js";
import { loadGamesFromDir } from "../utils/games.js";
import { resolveAdbPath, getBundledAdbPath } from "../utils/adb-bundle.js";
import { detectQuestDevice } from "../utils/quest-adb.js";
import fs from "fs/promises";

export async function doctor(serverInfoPath) {
  console.log();
  console.log(theme.primaryBright(`${icons.check}  System Check`));
  console.log(theme.dark("─".repeat(40)));
  console.log();

  const checks = [];

  try {
    await ensureRclone();
    checks.push({
      name: "rclone",
      status: "ok",
      message: "Installed and working",
    });
  } catch (err) {
    checks.push({
      name: "rclone",
      status: "error",
      message: err.message,
      fix: "brew install rclone",
    });
  }

  try {
    await ensure7zaExecutable();
    checks.push({
      name: "7za",
      status: "ok",
      message: "Available",
    });
  } catch (err) {
    checks.push({
      name: "7za",
      status: "error",
      message: err.message,
    });
  }

  try {
    const info = await loadServerInfo(serverInfoPath);
    checks.push({
      name: "ServerInfo",
      status: "ok",
      message: info.baseUri,
    });
  } catch (err) {
    checks.push({
      name: "ServerInfo",
      status: "error",
      message: err.message,
      fix: `Create at ${SERVER_INFO_DEFAULT}`,
    });
  }

  const adbPath = await resolveAdbPath();
  if (adbPath) {
    checks.push({
      name: "ADB",
      status: "ok",
      message: adbPath,
    });
    try {
      const quest = await detectQuestDevice();
      checks.push({
        name: "Quest headset",
        status: quest.connected ? "ok" : "warning",
        message: quest.connected
          ? `${quest.model} · ${quest.serial}`
          : "Not connected (USB debugging + authorize on headset)",
      });
    } catch (err) {
      checks.push({
        name: "Quest headset",
        status: "warning",
        message: err.message,
      });
    }
  } else {
    checks.push({
      name: "ADB",
      status: "warning",
      message: `Not bundled yet (downloads to ${getBundledAdbPath()} on first install)`,
      fix: "Use Install games with Quest connected, or install Android platform-tools",
    });
  }

  try {
    await fs.access(DATA_HOME);
    const games = await loadGamesFromDir(DATA_HOME);
    checks.push({
      name: "Metadata cache",
      status: games.length > 0 ? "ok" : "warning",
      message: games.length > 0 ? `${games.length} games loaded` : "Empty - run sync-meta",
    });
  } catch {
    checks.push({
      name: "Metadata cache",
      status: "warning",
      message: "Not initialized - run sync-meta",
    });
  }

  for (const check of checks) {
    const icon = check.status === "ok" ? theme.success(icons.check) : 
                 check.status === "warning" ? theme.warning(icons.warning) : 
                 theme.error(icons.cross);
    const status = check.status === "ok" ? theme.success("OK") : 
                   check.status === "warning" ? theme.warning("WARN") : 
                   theme.error("FAIL");
    
    console.log(`${icon} ${theme.white(check.name.padEnd(15))} ${status.padEnd(6)}  ${theme.dim(check.message)}`);
    
    if (check.fix) {
      console.log(`   ${theme.yellow("→ " + check.fix)}`);
    }
  }

  console.log();
  const allOk = checks.every(c => c.status === "ok");
  const hasWarnings = checks.some(c => c.status === "warning");
  
  if (allOk) {
    console.log(
      boxen(
        `${theme.success(`${icons.check} All Systems Operational`)}`,
        {
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          borderColor: "green",
          borderStyle: "round",
        }
      )
    );
  } else if (hasWarnings) {
    console.log(
      boxen(
        `${theme.warning(`${icons.warning} System Check Complete`)}\n` +
        `${theme.dim("Some components need attention")}`,
        {
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          borderColor: "yellow",
          borderStyle: "round",
        }
      )
    );
  } else {
    console.log(
      boxen(
        `${theme.error(`${icons.cross} Issues Found`)}\n` +
        `${theme.dim("Please fix the errors above")}`,
        {
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          borderColor: "red",
          borderStyle: "round",
        }
      )
    );
  }
}
