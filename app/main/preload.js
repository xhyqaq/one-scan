const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listDrives: () => ipcRenderer.invoke("list-drives"),
  scanDirectory: (rootPath) => ipcRenderer.invoke("scan-directory", rootPath),
  cancelScan: () => ipcRenderer.invoke("cancel-scan"),
  openLocation: (payload) => ipcRenderer.invoke("open-location", payload),
  pickDirectory: () => ipcRenderer.invoke("pick-directory"),
  onScanStart: (handler) => ipcRenderer.on("scan-start", (_event, data) => handler(data)),
  onScanInitial: (handler) => ipcRenderer.on("scan-initial", (_event, data) => handler(data)),
  onItemUpdate: (handler) => ipcRenderer.on("scan-item-update", (_event, data) => handler(data)),
  onProgress: (handler) => ipcRenderer.on("scan-progress", (_event, data) => handler(data)),
  onScanDone: (handler) => ipcRenderer.on("scan-done", (_event, data) => handler(data)),
  onScanError: (handler) => ipcRenderer.on("scan-error", (_event, data) => handler(data))
});
