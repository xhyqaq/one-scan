const state = {
  drives: [],
  currentPath: null,
  items: [],
  scanning: false,
  scanId: null,
  scannedFiles: 0,
  scannedBytes: 0,
  currentProgressPath: "",
  progressCompleted: 0,
  progressTotal: 0,
  searchQuery: ""
};

const layout = {
  minCardWidth: 220,
  cardHeight: 150,
  gap: 14,
  bufferRows: 2
};

let renderScheduled = false;

function isWindowsPath(p) {
  return /^[A-Za-z]:\\/.test(p);
}

function splitPath(p) {
  if (!p) return [];
  if (isWindowsPath(p)) {
    const root = p.slice(0, 3);
    const rest = p.slice(3).split("\\").filter(Boolean);
    return [root, ...rest];
  }
  if (p === "/") return ["/"];
  return ["/", ...p.split("/").filter(Boolean)];
}

function joinPath(segments) {
  if (segments.length === 0) return "";
  if (isWindowsPath(segments[0])) {
    const root = segments[0];
    const rest = segments.slice(1);
    return root + rest.join("\\");
  }
  if (segments[0] === "/") {
    return "/" + segments.slice(1).join("/");
  }
  return segments.join("/");
}

function parentPath(p) {
  if (!p) return null;
  if (isWindowsPath(p)) {
    let normalized = p;
    if (normalized.endsWith("\\") && normalized.length > 3) {
      normalized = normalized.slice(0, -1);
    }
    const idx = normalized.lastIndexOf("\\");
    if (idx <= 2) return normalized.slice(0, 3);
    return normalized.slice(0, idx);
  }
  if (p === "/") return null;
  const idx = p.lastIndexOf("/");
  if (idx === 0) return "/";
  return p.slice(0, idx);
}

function formatSize(bytes) {
  if (bytes == null) return "未知";
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function formatItemSize(item) {
  if (item.status === "pending" || item.status === "partial") return "计算中";
  if (item.status === "no_access") return "未知";
  return formatSize(item.size);
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const sa = a.size ?? -1;
    const sb = b.size ?? -1;
    return sb - sa;
  });
}

function filterItems(items) {
  const q = state.searchQuery.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.name.toLowerCase().includes(q));
}

function setStatus(text) {
  document.getElementById("progressMeta").textContent = text;
}

function renderBreadcrumb() {
  const el = document.getElementById("breadcrumb");
  const segments = splitPath(state.currentPath);
  if (segments.length === 0) {
    el.textContent = "路径: -";
    return;
  }

  const links = segments.map((seg, idx) => {
    return `<a href="#" data-idx="${idx}">${seg}</a>` + (idx < segments.length - 1 ? " &gt; " : "");
  });
  el.innerHTML = "路径: " + links.join("");

  el.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const idx = parseInt(a.dataset.idx, 10);
      const targetPath = joinPath(segments.slice(0, idx + 1));
      startScan(targetPath, false);
    });
  });
}

function renderProgress() {
  const bar = document.getElementById("progressBar");
  const total = state.progressTotal || 0;
  const completed = state.progressCompleted || 0;
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  bar.style.width = percent + "%";
}

function renderGrid() {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("emptyTip");
  if (!grid) return;

  const lastScrollTop = grid.scrollTop;
  grid.innerHTML = "";

  if (!state.items || state.items.length === 0) {
    empty.textContent = "暂无数据，请点击“开始扫描”。";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const filtered = filterItems(state.items);
  if (filtered.length === 0) {
    empty.textContent = "没有匹配结果";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const items = sortItems(filtered);
  const containerWidth = grid.clientWidth || grid.offsetWidth || (layout.minCardWidth + layout.gap);
  const gridStyle = window.getComputedStyle(grid);
  const paddingLeft = parseFloat(gridStyle.paddingLeft) || 0;
  const paddingRight = parseFloat(gridStyle.paddingRight) || 0;
  const availableWidth = Math.max(0, containerWidth - paddingLeft - paddingRight);
  const columns = Math.max(1, Math.floor((availableWidth + layout.gap) / (layout.minCardWidth + layout.gap)));
  const cardWidth = Math.max(
    layout.minCardWidth,
    Math.floor((availableWidth - layout.gap * (columns - 1)) / columns)
  );
  const rowHeight = layout.cardHeight + layout.gap;
  const totalRows = Math.ceil(items.length / columns);
  const totalHeight = Math.max(0, totalRows * rowHeight - layout.gap);

  const spacer = document.createElement("div");
  spacer.className = "spacer";
  spacer.style.height = totalHeight + "px";
  grid.appendChild(spacer);

  const viewTop = lastScrollTop;
  const viewHeight = grid.clientHeight || 0;
  const startRow = Math.max(0, Math.floor(viewTop / rowHeight) - layout.bufferRows);
  const endRow = Math.min(totalRows, Math.ceil((viewTop + viewHeight) / rowHeight) + layout.bufferRows);
  const startIndex = startRow * columns;
  const endIndex = Math.min(items.length, endRow * columns);

  for (let i = startIndex; i < endIndex; i += 1) {
    const item = items[i];
    const row = Math.floor(i / columns);
    const col = i % columns;
    const card = document.createElement("div");
    card.className = "card " + (item.type === "file" ? "file" : "dir");
    card.style.position = "absolute";
    card.style.top = `${row * rowHeight}px`;
    card.style.left = `${paddingLeft + col * (cardWidth + layout.gap)}px`;
    card.style.width = `${cardWidth}px`;
    card.style.height = `${layout.cardHeight}px`;
    card.innerHTML = `
      <div class="name" title="${item.name}">${item.name}</div>
      <div class="size">${formatItemSize(item)}</div>
      <div class="meta">
        <span class="tag ${item.type === "dir" ? "dir" : "file"}">${item.type === "dir" ? "目录" : "文件"}</span>
        ${item.type === "dir" ? `<span>子项 ${item.childCount ?? "-"}</span>` : `<span>修改: ${item.mtime ?? "-"}</span>`}
      </div>
      <button class="open-btn" data-action="open">打开所在位置</button>
      ${item.status === "no_access" ? `<div class="status">无权限/未扫描</div>` : ""}
    `;

    if (item.type === "dir" && item.status !== "no_access") {
      card.addEventListener("click", (e) => {
        if (e.target && e.target.dataset?.action === "open") return;
        startScan(item.path, false);
      });
    }

    const openBtn = card.querySelector(".open-btn");
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.api.openLocation({ path: item.path, type: item.type });
    });

    grid.appendChild(card);
  }

  grid.scrollTop = lastScrollTop;
}

function scheduleRenderGrid() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderGrid();
  });
}

function updateControls() {
  const cancelBtn = document.getElementById("cancelBtn");
  const backBtn = document.getElementById("backBtn");
  cancelBtn.disabled = !state.scanning;
  backBtn.disabled = !parentPath(state.currentPath);
}

async function loadDrives() {
  state.drives = await window.api.listDrives();
  const select = document.getElementById("diskSelect");
  select.innerHTML = state.drives.map((d, i) => `<option value="${i}">${d}</option>`).join("");
  select.addEventListener("change", () => {
    const idx = parseInt(select.value, 10);
    startScan(state.drives[idx], false);
  });

  if (state.drives.length > 0) {
    startScan(state.drives[0], false);
  }
}

function startScan(targetPath, force) {
  if (!targetPath) return;
  state.currentPath = targetPath;
  state.items = [];
  state.scanning = true;
  state.scanId = null;
  state.scannedFiles = 0;
  state.scannedBytes = 0;
  state.currentProgressPath = "";
  state.progressCompleted = 0;
  state.progressTotal = 0;
  setStatus("扫描中...");
  renderBreadcrumb();
  renderGrid();
  renderProgress();
  updateControls();

  window.api.scanDirectory({ path: targetPath, force: !!force }).then((res) => {
    state.scanId = res.scanId;
  });

  const pathInput = document.getElementById("pathInput");
  if (pathInput) pathInput.value = targetPath;
}

function bindButtons() {
  document.getElementById("pickPathBtn").addEventListener("click", async () => {
    const result = await window.api.pickDirectory();
    if (result?.ok && result.path) {
      const input = document.getElementById("pathInput");
      if (input) input.value = result.path;
      startScan(result.path, true);
    }
  });

  document.getElementById("cancelBtn").addEventListener("click", () => {
    window.api.cancelScan();
  });

  document.getElementById("backBtn").addEventListener("click", () => {
    const parent = parentPath(state.currentPath);
    if (parent) startScan(parent, false);
  });
}

function setupEvents() {
  window.api.onScanStart((data) => {
    state.scanId = data.scanId;
  });

  window.api.onScanInitial((data) => {
    if (data.scanId !== state.scanId && state.scanId !== null) return;
    state.items = data.items || [];
    scheduleRenderGrid();
  });

  window.api.onItemUpdate((data) => {
    if (data.scanId !== state.scanId && state.scanId !== null) return;
    const item = data.item;
    if (!item?.path) return;
    const idx = state.items.findIndex((i) => i.path === item.path);
    if (idx >= 0) {
      state.items[idx] = { ...state.items[idx], ...item };
    }
    scheduleRenderGrid();
  });

  window.api.onProgress((data) => {
    if (data.scanId !== state.scanId) return;
    state.scannedFiles = data.scannedFiles;
    state.scannedBytes = data.scannedBytes;
    state.currentProgressPath = data.currentPath || "";
    state.progressCompleted = data.completed ?? state.progressCompleted;
    state.progressTotal = data.total ?? state.progressTotal;
    const progressText = state.progressTotal > 0
      ? `进度: ${state.progressCompleted}/${state.progressTotal} 项`
      : "进度: 0/0";
    setStatus(`${progressText} · 已扫描 ${state.scannedFiles} 文件 · ${formatSize(state.scannedBytes)}`);
    renderProgress();
  });

  window.api.onScanDone((data) => {
    if (data.scanId !== state.scanId) return;
    state.items = data.items || [];
    state.scanning = false;
    state.progressCompleted = state.items.length;
    state.progressTotal = state.items.length;
    const doneText = data.cancelled ? "已中断" : "扫描完成";
    setStatus(`${doneText}: ${data.scannedFiles} 文件 · ${formatSize(data.scannedBytes)}`);
    scheduleRenderGrid();
    renderProgress();
    updateControls();
  });

  window.api.onScanError((data) => {
    if (data.scanId !== state.scanId) return;
    state.scanning = false;
    setStatus(`扫描失败: ${data.message}`);
    scheduleRenderGrid();
    updateControls();
  });
}

function init() {
  bindButtons();
  setupEvents();
  loadDrives();
  const grid = document.getElementById("grid");
  if (grid) {
    grid.addEventListener("scroll", () => scheduleRenderGrid());
  }
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value || "";
      scheduleRenderGrid();
    });
  }
  window.addEventListener("resize", () => scheduleRenderGrid());
}

init();
