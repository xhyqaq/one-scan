const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { scanDirectory } = require("./scanner");

let mainWindow = null;
let currentScan = null;
const scanCache = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0f1115",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function listDrives() {
  if (process.platform === "win32") {
    const drives = [];
    for (let i = 65; i <= 90; i++) {
      const letter = String.fromCharCode(i);
      const drivePath = `${letter}:\\`;
      if (fs.existsSync(drivePath)) drives.push(drivePath);
    }
    return drives;
  }

  if (process.platform === "darwin") {
    const drives = ["/"];
    try {
      const volumes = fs.readdirSync("/Volumes", { withFileTypes: true });
      for (const entry of volumes) {
        if (entry.isDirectory()) drives.push(path.join("/Volumes", entry.name));
      }
    } catch (_err) {
      // ignore
    }
    return drives;
  }

  return ["/"];
}

function cancelCurrentScan() {
  if (currentScan?.token) {
    currentScan.token.cancelled = true;
  }
}

ipcMain.handle("list-drives", () => listDrives());

ipcMain.handle("scan-directory", async (event, payload) => {
  cancelCurrentScan();

  const rootPath = typeof payload === "string" ? payload : payload?.path;
  const force = typeof payload === "object" && payload?.force === true;
  if (!rootPath) return { scanId: null };

  const token = { cancelled: false };
  const scanId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  currentScan = { token, scanId };

  if (!force && scanCache.has(rootPath)) {
    const cached = scanCache.get(rootPath);
    event.sender.send("scan-start", { scanId, rootPath, cached: true });
    event.sender.send("scan-initial", { scanId, rootPath, items: cached.items });
    event.sender.send("scan-progress", {
      scanId,
      completed: cached.items.length,
      total: cached.items.length,
      scannedFiles: cached.scannedFiles,
      scannedBytes: cached.scannedBytes,
      currentPath: rootPath
    });
    event.sender.send("scan-done", {
      scanId,
      rootPath,
      items: cached.items,
      cancelled: false,
      scannedFiles: cached.scannedFiles,
      scannedBytes: cached.scannedBytes,
      cached: true
    });
    currentScan = null;
    return { scanId, cached: true };
  }

  event.sender.send("scan-start", { scanId, rootPath });

  (async () => {
    try {
      const result = await scanDirectory(rootPath, {
        cancelToken: token,
        onInitial: (payload) => {
          event.sender.send("scan-initial", {
            scanId,
            ...payload
          });
        },
        onItemUpdate: (item) => {
          event.sender.send("scan-item-update", {
            scanId,
            item
          });
        },
        onProgress: (progress) => {
          event.sender.send("scan-progress", {
            scanId,
            ...progress
          });
        }
      });

      const items = result.items || [];
      if (!token.cancelled) {
        scanCache.set(rootPath, {
          items,
          scannedFiles: result.scannedFiles,
          scannedBytes: result.scannedBytes,
          cachedAt: Date.now()
        });
      }
      event.sender.send("scan-done", {
        scanId,
        rootPath,
        items,
        cancelled: token.cancelled,
        scannedFiles: result.scannedFiles,
        scannedBytes: result.scannedBytes
      });
      currentScan = null;
    } catch (err) {
      event.sender.send("scan-error", {
        scanId,
        rootPath,
        message: err?.message || "scan failed"
      });
      currentScan = null;
    }
  })();

  return { scanId };
});

ipcMain.handle("cancel-scan", () => {
  cancelCurrentScan();
  return { ok: true };
});

ipcMain.handle("open-location", async (_event, payload) => {
  const targetPath = payload?.path;
  const type = payload?.type;
  if (!targetPath) return { ok: false };

  if (type === "file") {
    shell.showItemInFolder(targetPath);
    return { ok: true };
  }

  await shell.openPath(targetPath);
  return { ok: true };
});

ipcMain.handle("pick-directory", async () => {
  if (!mainWindow) return { ok: false };
  const { dialog } = require("electron");
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths?.length) {
    return { ok: false };
  }
  return { ok: true, path: result.filePaths[0] };
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
