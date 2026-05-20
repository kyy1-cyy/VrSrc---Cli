# 🥽 VRSRC CLI

**A  macOS terminal CMds to browse, download, and install VR games — powered by `rclone`, with optional Meta Quest support over USB.**

```
 ██╗   ██╗██████╗ ███████╗██████╗  ██████╗
 ██║   ██║██╔══██╗██╔════╝██╔══██╗██╔════╝
 ██║   ██║██████╔╝███████╗██████╔╝██║     
 ╚██╗ ██╔╝██╔══██╗╚════██║██╔══██╗██║     
  ╚████╔╝ ██║  ██║███████║██║  ██║╚██████╗
   ╚═══╝  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝
        VR Src · Terminal 
```

---

## 📖 What is this?

**VRSRC CLI** mirrors the core workflow of a VrSrc-style App directly in your terminal:

| Step | What you do |
|------|-------------|
| **1️⃣ Sync** | Pull the latest game list, thumbnails, and notes from the server |
| **2️⃣ Search** | find titles by name, package, or release folder |
| **3️⃣ Download** | Grab games with a live progress bar (speed, ETA, transfer size) |
| **4️⃣ Extract** | Archives unpack automatically after download (7-Zip) |
| **5️⃣ Install** | Push APK + OBB to a connected **Meta Quest** over USB (ADB) |

Everything is styled with colors, boxes, and keyboard navigation to make it easy to navigate

---

## ✨ Features

### 🎮 Game library

- **🔄 Sync metadata** — Downloads and extracts `meta` into `~/.vrsrc-cli/data/`
- **⬆️ Update metadata** — Refreshes only when a newer archive exists on the server
- **🔍 Fuzzy search** — Fast matching on title, package name, and release folder
- **📋 Browse all games** — Paginated table with size, version, and last updated
- **🖼 Thumbnails & notes** — Inline preview (iTerm) or open in Preview; release notes when available

### ⬇️ Downloads

- **🚀 Rclone-powered transfers** — Same backend as desktop VrSrc tools
- **📊 Single-line progress** — One updating row: bar, %, transferred/total, ETA
- **⚡ Speed readouts** — MiB/s + Mib/s (hidden during upload phases for a cleaner view)
- **⏹ Cancel anytime** — Press `Esc` during a download to abort and clean up partial files
- **📦 Auto-extract** — `.7z` / split archives extracted after download completes
- **📁 Custom download folder** — Pick any directory via Finder or `--dest`

### 🥽 Meta Quest install (ADB)

- **🔌 Auto-detect Quest** — When USB debugging is on, the header shows model, battery, serial, and storage
- **⚠️ No headset?** — Clear **“No headset detected”** message in the header
- **📲 Install games** — Menu option appears only when a Quest is connected
- **🧩 Bundled ADB** — Platform-tools download to `~/.vrsrc-cli/platform-tools` on first use (or use system `adb`)
- **📂 Smart OBB layout** — Files land at `Android/obb/<apk-name>/` without nested duplicate folders
- **📈 Live install progress** — APK upload → install → OBB upload with phase labels and byte counts
- **❌ Detailed errors** — Failed installs show command, exit code, and stderr for troubleshooting

### 🛠 Other

- **🩺 Doctor** — Checks `rclone`, 7-Zip, server config, metadata cache, ADB, and Quest connection
- **🎨 Interactive menu** — Run `vrsrc` with no args for the full TUI experience
- **⌨️ Keyboard navigation** — `↑/↓`, `←/→` pages, `Enter`, `Esc` throughout lists

---

## 💻 Requirements

| Requirement | Notes |
|-------------|--------|
| **macOS** | Primary target (Linux may work for downloads; Quest install is USB-focused) |
| **Node.js 18+** | [nodejs.org](https://nodejs.org) |
| **rclone** | `brew install rclone` |
| **Server access** | Valid `ServerInfo.json` (base URL + password) |
| **Meta Quest** *(optional)* | USB cable, Developer Mode, USB debugging enabled |

---

## 📥 Installation

### 1. Clone the repository

```bash
git clone https://github.com/kyy1-cyy/VrSrc---Cli.git
cd ~/VrSrc---Cli
```

### 2. Install dependencies

```bash
npm install
```

### 3. Link the global command (recommended)

```bash
npm run link
```

You can now run **`vrsrc`** from any terminal window.

### 4. Run without linking (alternative)

```bash
npm start
# or
node cli.js
```

---

## 🚀 First-time setup

### Step 1 — Install rclone

```bash
brew install rclone
```

Verify:

```bash
rclone version
```

### Step 2 — Create server config

On first launch, `vrsrc` walks you through setup, or create the file manually:

**Path:** `~/.vrsrc-cli/ServerInfo.json`

```json
{
  "baseUri": "https://your-server-url-here",
  "password": "your password"
}
```

Custom path:

```bash
vrsrc --server-info /path/to/ServerInfo.json
```

### Step 3 — Sync the game list

```bash
vrsrc sync-meta
```

Or open the menu and choose **Sync metadata from server**.

This caches:

- Game list (`*amelist.txt`)
- Thumbnails → `~/.vrsrc-cli/data/.meta/thumbnails/`
- Release notes → `~/.vrsrc-cli/data/.meta/notes/`

### Step 4 — Choose a download folder

In the menu: **Change download directory** (opens Finder).

Default if unset: `./downloads` in the current working directory.

Override per session:

```bash
vrsrc --dest ~/Games/VR
```

### Step 5 — Run a system check (optional)

```bash
vrsrc doctor
```

---

## 🎯 How to use

### 🖥 Interactive menu (easiest)

```bash
vrsrc
```

```
┌─────────────────────────────────────────┐
│  VRSRC · VR Release Manager             │
│  🥽 Quest 3                             │
│  Battery: 87%                           │
│  Serial no.: 1WMHH...                   │
│  Storage: 45.2 GiB / 128 GiB            │
└─────────────────────────────────────────┘
```

| Menu item | Description |
|-----------|-------------|
| 🔄 **Sync metadata** | Download & extract full metadata archive |
| ⬆️ **Update metadata** | Incremental update if server has newer meta |
| 📁 **Change download directory** | Pick folder in Finder |
| 🔍 **Search games** | Fuzzy search → view details |
| 🎮 **Browse all games** | Scroll full library with keyboard |
| ⬇️ **Search and download** | Find a game and download it |
| 🥽 **Install games** | *(Quest connected only)* Install from download folder |
| ✓ **System check** | Run doctor diagnostics |
| ✗ **Exit** | Quit |

---

### ⌨️ CLI commands

| Command | Description |
|---------|-------------|
| `vrsrc` | Open interactive menu |
| `vrsrc sync-meta` | Download & extract metadata |
| `vrsrc update-metadata` | Update metadata if newer exists |
| `vrsrc search "query"` | Search games (`-l 20` for limit) |
| `vrsrc list` | Browse all games interactively |
| `vrsrc download "query"` | Search and download a game |
| `vrsrc install-games` | Install downloaded games to Quest |
| `vrsrc doctor` | System dependency check |

**Global options:**

```bash
vrsrc --dest ~/My/VR/Games download "Beat Saber"
vrsrc --server-info ./my-server.json sync-meta
```

---

## ⬇️ Downloading a game

1. Run `vrsrc` → **Search and download**, or:
   ```bash
   vrsrc download "game name"
   ```
2. Use **↑/↓** to highlight a result, **Enter** to select.
3. Preview thumbnail → confirm **Download now**.
4. Watch the progress line update in place.
5. Press **Esc** to cancel mid-download (temp files are removed).
6. Archives extract automatically when finished.

**Example progress line:**

```
[████████░░░░░░░░] 42%  Uploading APK  512M/1.2G  eta 3:12
```

---

## 🥽 Installing to Meta Quest

### Prepare the headset

1. Enable **Developer Mode** on the Quest (Meta Quest app / Meta Horizon).
2. Enable **USB debugging** on the headset.
3. Plug in USB → accept the **RSA fingerprint** prompt on the headset.
4. Launch `vrsrc` — the header should show your Quest model and storage.

### Prepare the game folder

After download + extract, each game should look like:

```
downloads/
└── SomeGame.Release.Name/
    ├── com.example.game.apk      ← APK file
    └── com.example.game/         ← OBB folder (same name as APK, without .apk)
        ├── main.123.com.example.game.obb
        └── …
```

On the Quest, OBB files are placed at:

```
/sdcard/Android/obb/<apk-base-name>/*.obb
```

### Install from the menu

1. `vrsrc` → **Install games (Quest connected)**
2. **↑/↓** to pick a folder (your downloaded releases)
3. **Enter** → preview → **Install now**
4. Wait for: **Uploading APK** → **Installing APK on headset** → **Uploading OBB** (if present)
5. Success box confirms package and paths.

### Install from CLI

```bash
vrsrc install-games
vrsrc --dest ~/Documents/vrp_games install-games
```

---

## 📂 Important paths

| Path | Purpose |
|------|---------|
| `~/.vrsrc-cli/ServerInfo.json` | Server URL & password |
| `~/.vrsrc-cli/config.json` | Download directory preference |
| `~/.vrsrc-cli/data/` | Synced metadata, thumbnails, notes |
| `~/.vrsrc-cli/platform-tools/` | Bundled `adb` (auto-downloaded) |
| `./downloads/` | Default download folder (if unset) |

---

## 🩺 Troubleshooting

| Problem | Try this |
|---------|----------|
| **No headset detected** | Re-plug USB, enable debugging, accept RSA prompt, run `vrsrc doctor` |
| **rclone not found** | `brew install rclone` |
| **Game list empty** | Run `vrsrc sync-meta` first |
| **Download fails** | Run `vrsrc doctor`, check `ServerInfo.json` and network |
| **Install failed** | Read the red error box (stderr often explains package/OBB issues) |
| **Wrong OBB path on Quest** | Delete old `Android/obb/<game>/` folder on headset, reinstall |
| **ADB download slow** | First run downloads platform-tools once (~15 MB) |

---


## 📜 License
....

---

## 🙌 Quick reference card

```
┌──────────────────────────────────────────────────┐
│  SETUP     brew install rclone && npm install    │
│  LINK      npm run link                          │
│  CONFIG    ~/.vrsrc-cli/ServerInfo.json          │
│  SYNC      vrsrc sync-meta                       │
│  MENU      vrsrc                                 │
│  DOWNLOAD  vrsrc download "game name"              │
│  QUEST     USB on → vrsrc → Install games        │
│  CHECK     vrsrc doctor                          │
└──────────────────────────────────────────────────┘
```

**Made for VR collectors who live in the terminal.** 🎮✨
