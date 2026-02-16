# 小万专用-磁盘清理（Electron MVP）

用于扫描指定目录的磁盘占用情况，按当前层级展示目录与文件大小，并支持目录钻取。

## 功能概览
- 选择磁盘 / 选择目录（自动扫描）
- 当前层级目录 + 文件卡片展示
- 目录大小递归统计（单次遍历）
- 扫描进度与中断
- 面包屑导航 + 返回上一级
- 打开所在位置（资源管理器 / Finder）
- 列表虚拟化（大目录更流畅）
- 结果缓存（返回上一级不重复扫描）

## 本地运行
环境要求：Node.js 18+

```bash
npm install
npm run dev
```

## 目录结构
```
app/
  main/       # Electron 主进程
  renderer/   # UI 页面
.github/
  workflows/  # CI 打包
 docs/        # 方案与计划文档
```

## 打包（Windows 单文件 EXE）
在 Windows 环境运行：
```bash
npm run build:win
```
产物输出到 `dist/`。

## GitHub Actions
已配置 Windows 打包工作流：
- 方式一：Actions 页面手动触发（workflow_dispatch）
- 方式二：打 tag 触发（如 `v0.1.0`）

打包产物会以 artifact 形式上传。

## 已知限制
- 为避免内存膨胀，扫描时只保留当前层列表；首次进入子目录仍需扫描。
- mac 上可测试逻辑与 UI；Windows 打包与权限测试需在 Windows 环境完成。

## 许可证
暂无（如需可补充）。
