# Multi-Element Image Engine

一个把 **多张输入图片**（1 张参考图 `REF` + N 张素材图 `SRC`）组织成 **ComfyUI workflow** 并以 **Job 队列**方式运行的示例工程。

## 架构图（简化示意）

```text
             (HTTP: 上传/创建任务/查状态/SSE/取结果)
+-------------------+        +-------------------------+
|  meie-ui (Vite)   | <----> |  meie-server API (8090) |
+-------------------+        +-------------------------+
                                  |            ^
                                  |            |
                                  | SSE events |
                                  v            |
                           +-------------------------+
                           |  Redis + BullMQ Queue   |
                           +-------------------------+
                                  ^            |
                                  | consume    | enqueue(jobId)
                                  |            v
                        +-------------------------------+
                        |  meie-server Worker (BullMQ)  |
                        +-------------------------------+
                                  |  POST /prompt + WS /ws
                                  v
                           +------------------+
                           |   ComfyUI (8000) |
                           +------------------+
                            ^              |
                            | reads input  | writes output
                            |              v
   COMFY_INPUT_DIR/UPLOAD_SUBDIR/<jobId>/...      (ComfyUI output dir)

                        +------------------+
                        | SQLite (meie.db) |
                        +------------------+
                      (job/事件/结果元数据持久化)
```

## 目录结构

- `apps/meie-ui`: React + Vite 前端
- `apps/meie-server`: Node.js 后端（API + Worker + SQLite + BullMQ）
- `workflow_api.json`: 旧版 ComfyUI workflow（legacy）
- `workflow_api.lite.json`: lite workflow（Depth + Canny 双 ControlNet + IPAdapter，多数场景推荐默认）
- `workflow_api.full.json`: full workflow（在 lite 基础上增加：自动 Prompt、自动 Mask、可选后处理；对节点依赖更多）
  - 约定：后端会优先通过关键节点的 `_meta.title` 定位节点（例如 `POS_PROMPT` / `NEG_PROMPT` / `REF_COMPOSITION` / `SRC_FEATURE_STYLE` / `IPAdapterAdvanced (Track B)` 等）。
  - 如果你在 ComfyUI 里编辑并重新导出 workflow，建议尽量保持这些标题不变；否则需要同步更新后端的 title 映射（或确保关键节点的 id 仍与默认一致）。

## Workflow 模式（params.workflow_mode）

`POST /v1/jobs` 的 `params` 支持选择工作流模式：

```json
{
  "workflow_mode": "lite",
  "workflow_strict": false
}
```

- `workflow_mode`: `"lite"` 或 `"full"`（默认 `"lite"`）
- `workflow_strict`: `true` 时若缺少节点类型会直接失败；`false` 时会自动回退到更简单的 workflow（full -> lite -> legacy）

## 架构概览

1. UI（`meie-ui`）调用 API（`meie-server`）上传 `ref` 和 `sources[]`
2. API 把上传的图片写入 **ComfyUI input 目录**下的 `UPLOAD_SUBDIR/<jobId>/...`
3. API 将 jobId 入队（BullMQ/Redis）
4. Worker 取队列任务，构建/校验 workflow，调用 ComfyUI：
   - `POST /prompt` 提交任务
   - `WS /ws` 或轮询 history 读取进度与输出
5. Worker 保存输出元数据到 SQLite
6. UI 通过 SSE（`/v1/jobs/:jobId/events`）更新进度，完成后展示输出图

注意：如果你的机器只有 **1 张 GPU**，ComfyUI 的 `devices=1` 属正常现象。多 Worker 只会增加“提交并发”，但 ComfyUI 仍可能在 GPU 上串行执行（队列排队）。

## 运行依赖

你需要准备以下组件：

### 1) Node.js + npm

- 推荐：Node.js 20+（本项目脚本使用了 `node --env-file-if-exists` 读取根目录 `.env`）
- 也可用 Node 18，但需要你自行在 shell 里导出环境变量（或改脚本用 dotenv）

### 2) Redis（BullMQ 队列依赖）

推荐用 Docker（最省心）：

```bash
docker run --name redis-meie -p 6379:6379 -d redis:7
```

如果你不用 Docker：
- Windows：建议用 WSL2 跑 Redis，或使用兼容产品（如 Memurai）
- macOS：`brew install redis && brew services start redis`
- Linux：`apt/yum/pacman` 安装 `redis-server` 并启动

默认连接：`redis://127.0.0.1:6379`

### 3) ComfyUI（生成引擎）

需要在本机跑一个 ComfyUI 服务（默认端口 `8000`），并确保 workflow 里使用到的自定义节点已安装（例如 IPAdapter 相关节点）。

一个常见的安装方式（示例）：
1. 安装 Python（建议 3.10/3.11）并创建虚拟环境
2. 克隆 ComfyUI 仓库并安装依赖
3. 启动 ComfyUI（示例端口 8000）

你最终需要的是：ComfyUI 能访问自己的 `input/` 目录，并能正常接受 `POST /prompt`。

默认连接：`http://127.0.0.1:8000`

## 环境变量（.env）

本项目后端会在启动时尝试读取仓库根目录的 `.env`（如果存在）。

最小可用示例（Windows 路径建议用正斜杠）：

说明：上传的图片会保存到：

`COMFY_INPUT_DIR/UPLOAD_SUBDIR/<jobId>/ref.(png|jpg|webp)`

`COMFY_INPUT_DIR/UPLOAD_SUBDIR/<jobId>/src_0.(png|jpg|webp)`、`src_1...`

更多配置项见 `.env.example`。

## 安装与启动

### 安装依赖

```bash
npm install
```

### 启动（推荐：分开 3 个终端）

1. 启动 API（默认 `http://127.0.0.1:8090`）
```bash
npm run dev:server
```

2. 启动 Worker
```bash
npm run dev:worker
```

3. 启动 UI（默认 `http://localhost:5173`）
```bash
npm run dev:ui
```

Windows 提示：
- 如果你在 PowerShell 里遇到 `npm.ps1` 执行策略问题，可以改用：
  - `cmd /c npm run dev:ui`（或在 CMD 里运行）
  - 或 PowerShell 使用 `-NoProfile`

### 一键启动（可选）

```bash
npm run dev
```

## 使用方式（UI）

1. 打开 UI：`http://localhost:5173`
2. 左侧上传：
   - 参考图（REF）：1 张
   - 素材图（SRC）：至少 1 张（支持多张）
3. 点击「创建任务」
4. 右侧「进行中」Tab 可查看排队/运行中的任务进度
5. 任务完成后，点击任务可在中间区域查看结果并下载

## 后端 API（简表）

Base URL：`http://127.0.0.1:8090`

### 创建任务
- `POST /v1/jobs`
- Header：`X-User-Id: <string>`（用于按用户限流与历史查询）
- Body：`multipart/form-data`
  - `ref`: 单文件
  - `sources`: 多文件（>= 1）
  - `params`: JSON（可选）
  - `debug`: `"1"`（可选）
- 返回：`202 { "jobId": "<uuid>" }`

### 查询任务
- `GET /v1/jobs/:jobId`

### 订阅进度（SSE）
- `GET /v1/jobs/:jobId/events`
- 事件包括：`snapshot`、`state`、`progress`、`completed`、`failed`

### 查询历史列表（新增）
- `GET /v1/jobs?state=active|done|all&limit=100`
- Header：`X-User-Id: <string>`

### 获取输出图片（后端代理 ComfyUI /view）
- `GET /v1/jobs/:jobId/images/:idx`

### 取消任务
- `POST /v1/jobs/:jobId/cancel`

## License

MIT
