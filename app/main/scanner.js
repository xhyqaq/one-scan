const fs = require("fs");
const path = require("path");

function isAccessError(err) {
  return err && (err.code === "EACCES" || err.code === "EPERM");
}

function isNotFound(err) {
  return err && err.code === "ENOENT";
}

function shouldSkipDirent(dirent) {
  return dirent.isSymbolicLink();
}

async function safeStat(filePath) {
  try {
    return await fs.promises.stat(filePath);
  } catch (err) {
    return null;
  }
}

async function scanDirectory(rootPath, opts) {
  const onProgress = opts?.onProgress || (() => {});
  const onInitial = opts?.onInitial || (() => {});
  const onItemUpdate = opts?.onItemUpdate || (() => {});
  const cancelToken = opts?.cancelToken || { cancelled: false };

  let scannedFiles = 0;
  let scannedBytes = 0;
  let completedRoot = 0;
  let totalRoot = 0;
  let lastProgressAt = 0;

  function reportProgress(currentPath, force) {
    const now = Date.now();
    if (!force && now - lastProgressAt < 200) return;
    lastProgressAt = now;
    onProgress({
      completed: completedRoot,
      total: totalRoot,
      scannedFiles,
      scannedBytes,
      currentPath
    });
  }

  let rootEntries = [];
  try {
    rootEntries = await fs.promises.readdir(rootPath, { withFileTypes: true });
  } catch (err) {
    const status = isAccessError(err) ? "no_access" : isNotFound(err) ? "not_found" : "error";
    onInitial({ rootPath, items: [] });
    onProgress({ completed: 0, total: 0, scannedFiles, scannedBytes, currentPath: rootPath });
    return {
      items: [],
      scannedFiles,
      scannedBytes,
      status
    };
  }

  rootEntries = rootEntries.filter((entry) => !shouldSkipDirent(entry));
  totalRoot = rootEntries.length;

  const items = rootEntries.map((entry) => {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      return { name: entry.name, path: fullPath, type: "dir", size: null, childCount: null, status: "pending" };
    }
    return { name: entry.name, path: fullPath, type: "file", size: null, mtime: null, status: "pending" };
  });
  const itemByPath = new Map(items.map((item) => [item.path, item]));

  function applyUpdate(update) {
    if (!update?.path) return;
    const target = itemByPath.get(update.path);
    if (target) Object.assign(target, update);
  }

  onInitial({ rootPath, items });
  reportProgress(rootPath, true);

  async function sumDirectorySize(dirPath, initialEntries) {
    let size = 0;
    const stack = [];

    const entries = initialEntries || [];
    for (const entry of entries) {
      if (cancelToken.cancelled) return { size, cancelled: true };
      if (shouldSkipDirent(entry)) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const stat = await safeStat(fullPath);
        if (stat) {
          scannedFiles += 1;
          scannedBytes += stat.size;
          size += stat.size;
        }
      }
      reportProgress(dirPath, false);
    }

    while (stack.length > 0) {
      if (cancelToken.cancelled) return { size, cancelled: true };
      const current = stack.pop();
      let subEntries;
      try {
        subEntries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch (err) {
        continue;
      }

      for (const entry of subEntries) {
        if (cancelToken.cancelled) return { size, cancelled: true };
        if (shouldSkipDirent(entry)) continue;
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          const stat = await safeStat(fullPath);
          if (stat) {
            scannedFiles += 1;
            scannedBytes += stat.size;
            size += stat.size;
          }
        }
        reportProgress(current, false);
      }
    }

    return { size, cancelled: false };
  }

  for (const entry of rootEntries) {
    if (cancelToken.cancelled) break;
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isFile()) {
      const stat = await safeStat(fullPath);
      if (stat) {
        scannedFiles += 1;
        scannedBytes += stat.size;
        const update = {
          path: fullPath,
          type: "file",
          size: stat.size,
          mtime: stat.mtime ? stat.mtime.toISOString().slice(0, 10) : null,
          status: "ok"
        };
        applyUpdate(update);
        onItemUpdate(update);
      } else {
        const update = { path: fullPath, type: "file", status: "error" };
        applyUpdate(update);
        onItemUpdate(update);
      }
      completedRoot += 1;
      reportProgress(fullPath, true);
      continue;
    }

    if (!entry.isDirectory()) {
      const update = { path: fullPath, type: "file", status: "unsupported" };
      applyUpdate(update);
      onItemUpdate(update);
      completedRoot += 1;
      reportProgress(fullPath, true);
      continue;
    }

    let childEntries;
    try {
      childEntries = await fs.promises.readdir(fullPath, { withFileTypes: true });
    } catch (err) {
      const status = isAccessError(err) ? "no_access" : isNotFound(err) ? "not_found" : "error";
      const update = { path: fullPath, type: "dir", size: null, childCount: 0, status };
      applyUpdate(update);
      onItemUpdate(update);
      completedRoot += 1;
      reportProgress(fullPath, true);
      continue;
    }

    const filteredChildEntries = childEntries.filter((child) => !shouldSkipDirent(child));
    const childCountUpdate = {
      path: fullPath,
      type: "dir",
      childCount: filteredChildEntries.length,
      status: "pending"
    };
    applyUpdate(childCountUpdate);
    onItemUpdate(childCountUpdate);

    const { size, cancelled } = await sumDirectorySize(fullPath, filteredChildEntries);
    if (cancelToken.cancelled) {
      const update = { path: fullPath, type: "dir", size, status: "partial" };
      applyUpdate(update);
      onItemUpdate(update);
      break;
    }

    const finalUpdate = { path: fullPath, type: "dir", size, status: cancelled ? "partial" : "ok" };
    applyUpdate(finalUpdate);
    onItemUpdate(finalUpdate);
    completedRoot += 1;
    reportProgress(fullPath, true);
  }

  reportProgress(rootPath, true);

  return {
    items,
    scannedFiles,
    scannedBytes
  };
}

module.exports = {
  scanDirectory
};
