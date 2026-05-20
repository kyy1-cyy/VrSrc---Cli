import fs from "fs/promises";
import path from "path";
import { execa } from "execa";
import boxen from "boxen";
import enquirer from "enquirer";
import { theme, icons } from "../utils/theme.js";
import { getDownloadDirectory, clearViewport } from "../utils/config.js";
import {
  loadGamesOrThrow,
  matchGameByFolderName,
  listDownloadedGameFolders,
  displayTitle,
  renderInlineImageIfSupported,
} from "../utils/games.js";
import { detectQuestDevice, AdbCommandError } from "../utils/quest-adb.js";
import { renderCompactProgress } from "../utils/progress.js";
import { waitForKeypressNavigation, waitForReturn } from "./menu.js";
import { fileExists } from "../utils/config.js";

const { Select } = enquirer;

const OBB_REMOTE_ROOT = "/sdcard/Android/obb";
const TMP_APK_REMOTE = "/data/local/tmp/vrsrc-install.apk";

async function directorySizeBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        const st = await fs.stat(full);
        total += st.size;
      }
    }
  }
  return total;
}

async function findInstallAssets(gameDir) {
  const entries = await fs.readdir(gameDir, { withFileTypes: true });
  const apks = [];
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith(".apk")) {
      apks.push({ name: e.name, full: path.join(gameDir, e.name) });
    }
  }
  if (!apks.length) {
    throw new Error(
      `No .apk found in:\n  ${gameDir}\n\nExpected a file like game.com.apk in the game folder.`
    );
  }

  apks.sort((a, b) => b.name.length - a.name.length);
  const chosen = apks[0];
  const base = chosen.name.replace(/\.apk$/i, "");
  const obbDir = path.join(gameDir, base);
  const obbExists = await fileExists(obbDir);
  const obbStat = obbExists ? await fs.stat(obbDir) : null;
  const hasObb = obbStat?.isDirectory();

  return {
    apkPath: chosen.full,
    apkName: chosen.name,
    obbDir: hasObb ? obbDir : null,
    obbFolderName: hasObb ? base : null,
  };
}

function applyOverallProgress(progress, { phase, workDone, stepBytes, stepDone, totalWork, startedAt, hideSpeed }) {
  const transferred = Math.min(totalWork, workDone + Math.min(stepBytes, stepDone));
  const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
  const speed = transferred > 0 ? transferred / elapsed : 0;
  const pct = totalWork > 0 ? Math.min(99, Math.round((transferred / totalWork) * 100)) : 0;
  const remaining = Math.max(0, totalWork - transferred);

  progress.phase = phase;
  progress.transferredBytes = transferred;
  progress.totalBytes = totalWork;
  progress.percent = pct;
  progress.speed = speed;
  progress.eta = speed > 0 && remaining > 0 ? remaining / speed : Infinity;
  if (hideSpeed != null) progress.hideSpeed = hideSpeed;
  renderCompactProgress(progress);
}

/** Find the folder whose files should land directly under obb/<apkBase>/ (unwrap duplicate nests). */
async function resolveObbLeafDir(obbDir, folderName) {
  let current = obbDir;

  for (let depth = 0; depth < 12; depth += 1) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && !e.name.startsWith("."));
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));

    if (files.some((e) => /\.obb$/i.test(e.name))) {
      return current;
    }

    if (dirs.length === 1) {
      current = path.join(current, dirs[0].name);
      continue;
    }

    const sameName = dirs.find((d) => d.name === folderName);
    if (sameName && dirs.length === 1) {
      current = path.join(current, sameName.name);
      continue;
    }

    break;
  }

  return current;
}

async function collectObbFilesRecursive(dir, baseDir = dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await collectObbFilesRecursive(full, baseDir)));
    } else if (e.isFile() && !e.name.startsWith(".")) {
      out.push({
        localPath: full,
        relPath: path.relative(baseDir, full).split(path.sep).join("/"),
      });
    }
  }
  return out;
}

/** Push each file to obb/<apkBase>/<relative-path> — never creates an extra folder level. */
async function pushObbContentsFlat({
  adbPath,
  deviceId,
  obbSource,
  remoteObb,
  progress,
  totalWork,
  workDone,
  hideSpeed,
}) {
  const files = await collectObbFilesRecursive(obbSource);
  if (!files.length) {
    throw new Error(
      `No OBB files found under:\n  ${obbSource}\n\nExpected .obb files inside the folder matching the APK name.`
    );
  }

  let done = workDone;
  for (const { localPath, relPath } of files) {
    const remoteFile = `${remoteObb}/${relPath}`;
    const remoteParent = remoteFile.includes("/")
      ? remoteFile.slice(0, remoteFile.lastIndexOf("/"))
      : remoteObb;

    await execa(adbPath, ["-s", deviceId, "shell", "mkdir", "-p", remoteParent], {
      timeout: 30000,
    });

    const pushed = await adbPushWithProgress(adbPath, deviceId, localPath, remoteFile, {
      phase: "Uploading OBB",
      totalWork,
      workDone: done,
      progress,
      hideSpeed,
      pollRemotePath: remoteFile,
      pollIsDirectory: false,
    });
    done += pushed;
  }

  return done - workDone;
}

async function prepareObbRemoteDir(adbPath, deviceId, obbFolderName) {
  const remoteObb = `${OBB_REMOTE_ROOT}/${obbFolderName}`;
  await execa(adbPath, ["-s", deviceId, "shell", "rm", "-rf", remoteObb], { timeout: 60000 });
  await execa(adbPath, ["-s", deviceId, "shell", "mkdir", "-p", remoteObb], { timeout: 30000 });
  return remoteObb;
}

async function remoteFileSizeBytes(adbPath, deviceId, remotePath) {
  try {
    const { stdout } = await execa(
      adbPath,
      ["-s", deviceId, "shell", "stat", "-c", "%s", remotePath],
      { timeout: 5000 }
    );
    const n = Number(String(stdout).trim());
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function remoteDirSizeBytes(adbPath, deviceId, remoteDir) {
  try {
    const { stdout } = await execa(
      adbPath,
      ["-s", deviceId, "shell", "du", "-sb", remoteDir],
      { timeout: 15000 }
    );
    const n = Number(String(stdout).trim().split(/\s+/)[0]);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    // fall through
  }
  try {
    const { stdout } = await execa(
      adbPath,
      ["-s", deviceId, "shell", "du", "-s", remoteDir],
      { timeout: 15000 }
    );
    const n = Number(String(stdout).trim().split(/\s+/)[0]);
    if (Number.isFinite(n) && n >= 0) return n * 1024;
  } catch {
    // ignore
  }
  return 0;
}

async function runPhaseWithProgress({
  adbPath,
  deviceId,
  phase,
  totalWork,
  workDone,
  stepBytes,
  pollRemotePath,
  pollIsDirectory,
  progress,
  hideSpeed = false,
  run,
}) {
  const startedAt = Date.now();
  let stepDone = 0;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    if (pollRemotePath) {
      stepDone = pollIsDirectory
        ? await remoteDirSizeBytes(adbPath, deviceId, pollRemotePath)
        : await remoteFileSizeBytes(adbPath, deviceId, pollRemotePath);
    }
    applyOverallProgress(progress, {
      phase,
      workDone,
      stepBytes,
      stepDone,
      totalWork,
      startedAt,
      hideSpeed,
    });
  };

  applyOverallProgress(progress, {
    phase,
    workDone,
    stepBytes,
    stepDone: 0,
    totalWork,
    startedAt,
    hideSpeed,
  });

  const interval = setInterval(() => {
    tick().catch(() => {});
  }, 350);

  try {
    await run();
    stepDone = stepBytes;
    applyOverallProgress(progress, {
      phase,
      workDone,
      stepBytes,
      stepDone: stepBytes,
      totalWork,
      startedAt,
      hideSpeed,
    });
  } finally {
    stopped = true;
    clearInterval(interval);
  }

  return stepBytes;
}

async function adbPushWithProgress(
  adbPath,
  deviceId,
  localPath,
  remotePath,
  { phase, totalWork, workDone, progress, hideSpeed = false, sizeBytes, pollRemotePath, pollIsDirectory }
) {
  const pushContents = /[/\\]\.$/.test(localPath);
  const sourcePath = pushContents ? localPath.replace(/[/\\]\.$/, "") : localPath;
  const st = await fs.stat(sourcePath);
  const isDirectory = pushContents || st.isDirectory();
  const stepBytes =
    sizeBytes ?? (isDirectory ? await directorySizeBytes(sourcePath) : st.size);
  const pollPath = pollRemotePath ?? remotePath.replace(/\/$/, "");
  const pollDir = pollIsDirectory ?? isDirectory;

  progress.hideSpeed = hideSpeed;

  try {
    await runPhaseWithProgress({
      adbPath,
      deviceId,
      phase,
      totalWork,
      workDone,
      stepBytes,
      pollRemotePath: pollPath,
      pollIsDirectory: pollDir,
      progress,
      hideSpeed,
      run: () =>
        execa(adbPath, ["-s", deviceId, "push", localPath, remotePath], {
          timeout: 0,
          reject: true,
        }),
    });
  } catch (err) {
    throw new AdbCommandError(
      `adb push failed for ${path.basename(localPath)} → ${remotePath}`,
      {
        command: adbPath,
        args: ["-s", deviceId, "push", localPath, remotePath],
        stderr: err.stderr || err.all || "",
        stdout: err.stdout || "",
        exitCode: err.exitCode,
      }
    );
  }

  progress.hideSpeed = hideSpeed;
  applyOverallProgress(progress, {
    phase,
    workDone: workDone + stepBytes,
    stepBytes,
    stepDone: stepBytes,
    totalWork,
    startedAt: Date.now(),
    hideSpeed,
  });
  return stepBytes;
}

async function adbInstallApk(adbPath, deviceId, remoteApk) {
  try {
    await execa(adbPath, ["-s", deviceId, "shell", "pm", "install", "-r", "-g", remoteApk], {
      timeout: 300000,
      reject: true,
    });
  } catch (err) {
    let msg = err.stderr || err.stdout || err.message;
    if (/INSTALL_FAILED/i.test(msg)) {
      msg = `Package install rejected by the headset:\n${msg.trim()}`;
    }
    throw new AdbCommandError(msg, {
      command: adbPath,
      args: ["-s", deviceId, "shell", "pm", "install", "-r", "-g", remoteApk],
      stderr: err.stderr || "",
      stdout: err.stdout || "",
      exitCode: err.exitCode,
    });
  } finally {
    try {
      await execa(adbPath, ["-s", deviceId, "shell", "rm", "-f", remoteApk], { timeout: 10000 });
    } catch {
      // ignore cleanup errors
    }
  }
}

function resolvePackageName(game, assets) {
  if (game?.packageName?.trim()) return game.packageName.trim();
  return assets.obbFolderName || assets.apkName.replace(/\.apk$/i, "");
}

export async function installGameToQuest(quest, gameDir, game, options = {}) {
  const assets = await findInstallAssets(gameDir);
  const packageName = resolvePackageName(game, assets);
  const apkSize = (await fs.stat(assets.apkPath)).size;
  const obbSize = assets.obbDir ? await directorySizeBytes(assets.obbDir) : 0;
  const installOverhead = Math.max(1, Math.round(apkSize * 0.02));
  const totalWork = apkSize + obbSize + installOverhead;

  const progress = {
    phase: "Preparing",
    percent: 0,
    speed: 0,
    eta: Infinity,
    transferredBytes: 0,
    totalBytes: totalWork,
  };

  let workDone = 0;

  console.log();
  console.log(theme.dim(`${icons.arrow} Installing ${displayTitle(game) || path.basename(gameDir)}`));
  console.log();

  try {
    try {
      await execa(quest.adbPath, ["-s", quest.deviceId, "shell", "rm", "-f", TMP_APK_REMOTE], {
        timeout: 10000,
      });
    } catch {
      // ignore
    }

    progress.hideSpeed = true;
    workDone += await adbPushWithProgress(
      quest.adbPath,
      quest.deviceId,
      assets.apkPath,
      TMP_APK_REMOTE,
      {
        phase: "Uploading APK",
        totalWork,
        workDone,
        progress,
        hideSpeed: true,
        pollRemotePath: TMP_APK_REMOTE,
        pollIsDirectory: false,
      }
    );

    progress.hideSpeed = false;
    await runPhaseWithProgress({
      adbPath: quest.adbPath,
      deviceId: quest.deviceId,
      phase: "Installing APK on headset",
      totalWork,
      workDone,
      stepBytes: installOverhead,
      pollRemotePath: null,
      pollIsDirectory: false,
      progress,
      hideSpeed: false,
      run: async () => {
        const installStarted = Date.now();
        const pulse = setInterval(() => {
          const elapsed = (Date.now() - installStarted) / 1000;
          const fakeDone = Math.min(installOverhead, Math.round((elapsed / 45) * installOverhead));
          applyOverallProgress(progress, {
            phase: "Installing APK on headset",
            workDone,
            stepBytes: installOverhead,
            stepDone: fakeDone,
            totalWork,
            startedAt: installStarted,
            hideSpeed: false,
          });
        }, 400);
        try {
          await adbInstallApk(quest.adbPath, quest.deviceId, TMP_APK_REMOTE);
        } finally {
          clearInterval(pulse);
        }
      },
    });
    workDone += installOverhead;

    if (assets.obbDir && assets.obbFolderName) {
      const obbSource = await resolveObbLeafDir(assets.obbDir, assets.obbFolderName);
      const remoteObb = await prepareObbRemoteDir(
        quest.adbPath,
        quest.deviceId,
        assets.obbFolderName
      );

      progress.hideSpeed = true;
      workDone += await pushObbContentsFlat({
        adbPath: quest.adbPath,
        deviceId: quest.deviceId,
        obbSource,
        remoteObb,
        progress,
        totalWork,
        workDone,
        hideSpeed: true,
      });
      progress.hideSpeed = false;
    }

    progress.phase = "Complete";
    progress.percent = 100;
    progress.transferredBytes = totalWork;
    progress.eta = 0;
    renderCompactProgress(progress);
    process.stdout.write("\n\n");

    console.log(
      boxen(
        `${theme.success(`${icons.check} Installed successfully`)}\n\n` +
          `${theme.white("Game:")}     ${theme.primaryBright(displayTitle(game) || path.basename(gameDir))}\n` +
          `${theme.white("Package:")}  ${theme.cyan(packageName)}\n` +
          `${theme.white("APK:")}      ${theme.dim(assets.apkName)}` +
          (assets.obbDir
            ? `\n${theme.white("OBB:")}      ${theme.dim(`${OBB_REMOTE_ROOT}/${assets.obbFolderName}/`)}`
            : `\n${theme.dim("No OBB folder (optional subfolder named like the APK without .apk)")}`),
        {
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          borderColor: "green",
          borderStyle: "round",
        }
      )
    );
  } catch (err) {
    process.stdout.write("\n\n");
    const detail = err instanceof AdbCommandError ? err.detailBlock() : err.message || String(err);
    console.log(
      boxen(
        `${theme.error(`${icons.cross} Installation failed`)}\n\n` +
          `${theme.white(displayTitle(game) || path.basename(gameDir))}\n\n` +
          `${theme.dim(detail)}`,
        {
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          borderColor: "red",
          borderStyle: "round",
        }
      )
    );
    throw err;
  }
}

export async function installGamesCommand(options = {}) {
  const quest = await detectQuestDevice(
    (line) => {
      console.log(theme.dim(line));
    },
    { allowDownload: true }
  );

  if (!quest.connected) {
    console.log(
      boxen(
        `${theme.warning(`${icons.warning} No headset detected`)}\n\n` +
          `${theme.dim("Connect your Quest with USB debugging enabled, accept the RSA prompt on the headset, then try again.")}`,
        {
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          borderColor: "yellow",
          borderStyle: "round",
        }
      )
    );
    return;
  }

  const downloadDir = await getDownloadDirectory(options.dest);
  const folders = await listDownloadedGameFolders(downloadDir);
  if (!folders.length) {
    console.log(
      boxen(
        `${theme.warning(`${icons.warning} No downloaded games`)}\n\n` +
          `${theme.dim(`No folders found in:\n${downloadDir}`)}`,
        {
          padding: { left: 2, right: 2, top: 1, bottom: 1 },
          borderColor: "yellow",
          borderStyle: "round",
        }
      )
    );
    return;
  }

  let catalog = [];
  try {
    catalog = await loadGamesOrThrow();
  } catch {
    catalog = [];
  }

  const pageSize = 12;
  let selected = 0;

  while (true) {
    const page = Math.floor(selected / pageSize);
    const start = page * pageSize;
    const slice = folders.slice(start, start + pageSize);
    const totalPages = Math.max(1, Math.ceil(folders.length / pageSize));

    clearViewport();
    console.log();
    console.log(theme.primaryBright(`${icons.download}  Install games on Quest`));
    console.log(theme.dark("─".repeat(40)));
    console.log(theme.dim(`Folder: ${downloadDir}`));
    console.log();

    slice.forEach((name, i) => {
      const idx = start + i;
      const meta = catalog.length ? matchGameByFolderName(catalog, name) : null;
      const title = meta ? displayTitle(meta) : null;
      const line =
        idx === selected
          ? theme.primaryBright(`▶ ${theme.white(name)}`)
          : `${theme.dim(String(idx + 1).padStart(2))}  ${theme.white(name)}`;
      console.log(line);
      if (title && title.toLowerCase() !== name.toLowerCase()) {
        console.log(theme.dim(`    ${icons.game} ${title}`));
      }
    });

    console.log();
    console.log(
      theme.dim(`${icons.bullet} Page ${theme.white(`${page + 1}/${totalPages}`)} · ${folders.length} folders`)
    );
    console.log();
    console.log(
      theme.dim(`${icons.arrow} ${theme.yellow("↑/↓")} navigate  `) +
        theme.dim(`${icons.arrow} ${theme.yellow("←/→")} page  `) +
        theme.dim(`${icons.arrow} ${theme.yellow("Enter")} install  `) +
        theme.dim(`${icons.arrow} ${theme.yellow("Esc")} back`)
    );

    const key = await waitForKeypressNavigation();
    if (key === "back") return;
    if (key === "up") {
      selected = Math.max(0, selected - 1);
      continue;
    }
    if (key === "down") {
      selected = Math.min(folders.length - 1, selected + 1);
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
      const folderName = folders[selected];
      const gameDir = path.join(downloadDir, folderName);
      const game =
        catalog.length > 0
          ? matchGameByFolderName(catalog, folderName) || {
              name: folderName,
              releaseName: folderName,
              packageName: "",
              sizeMb: "",
              updated: "",
              versionCode: "",
              thumbnailPath: "",
              notePath: "",
            }
          : {
              name: folderName,
              releaseName: folderName,
              packageName: "",
              sizeMb: "",
              updated: "",
              versionCode: "",
              thumbnailPath: "",
              notePath: "",
            };

      clearViewport();
      console.log();
      console.log(theme.primaryBright(`${icons.vr}  Install on Quest`));
      console.log(theme.dark("─".repeat(40)));
      console.log();

      if (game.thumbnailPath && (await fileExists(game.thumbnailPath))) {
        const shown = await renderInlineImageIfSupported(game.thumbnailPath);
        if (!shown) {
          console.log(theme.dim(`${icons.image} ${game.thumbnailPath}`));
        }
        console.log();
      }

      console.log(
        boxen(
          `${theme.white("Folder:")}   ${theme.dim(folderName)}\n` +
            `${theme.white("Title:")}    ${theme.primaryBright(displayTitle(game))}\n` +
            `${theme.white("Package:")}  ${theme.cyan(game.packageName || "—")}\n` +
            `${theme.white("Size:")}     ${theme.green(game.sizeMb ? `${game.sizeMb} MB` : "—")}`,
          {
            padding: { left: 1, right: 1, top: 0, bottom: 0 },
            borderColor: "magenta",
            borderStyle: "round",
            dimBorder: true,
          }
        )
      );
      console.log();

      const confirm = new Select({
        name: "installConfirm",
        message: theme.primary(`Install ${displayTitle(game)} on Quest?`),
        choices: [
          { name: "install", message: `${icons.download} Install now` },
          { name: "cancel", message: `${icons.cross} Cancel` },
        ],
      });
      const action = await confirm.run();
      if (action !== "install") continue;

      try {
        await installGameToQuest(quest, gameDir, game);
      } catch {
        // error already printed
      }
      await waitForReturn();
    }
  }
}
