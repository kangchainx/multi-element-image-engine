# @meie/server

MEIE（Multi-Element Image Engine）的后端服务。

它对外提供异步 Job API，并通过 Worker 进程调用 ComfyUI 出图。

## 架构说明

- 队列：BullMQ + Redis
- 持久化：SQLite（job 元数据/文件索引/结果；不承担排队）
- 进度：API 订阅 BullMQ QueueEvents，通过 SSE 推送到客户端
- 同用户并发限制：Redis Lua，按 `X-User-Id`（默认最多 3 个未完成任务）
- Worker：`cluster` master fork 多进程；并发根据 CPU 和 ComfyUI `/system_stats` 推导

## 运行依赖

- Node.js >= 18
- Redis 已启动（默认 `127.0.0.1:6379`）
- ComfyUI 已启动（默认 `http://127.0.0.1:8000`）

## 配置（.env）

把 `.env` 放在仓库根目录（不要放在本目录）。所有脚本都通过 Node 原生参数 `--env-file-if-exists=../../.env` 自动读取。

常用变量：

```env
COMFYUI_API_BASE=http://127.0.0.1:8000
REDIS_URL=redis://127.0.0.1:6379

# BullMQ queue name 不能包含 ":"（请用下划线）
QUEUE_NAME=meie_jobs

# ComfyUI input 目录的绝对路径
COMFY_INPUT_DIR=D:/develop/ComfyUI_Files/input

# 需要让局域网其它电脑访问 API 时，设置为 0.0.0.0
HOST=0.0.0.0
PORT=8090
```

更多变量见 `../../.env.example`。

## 安装依赖

在仓库根目录执行：

```bash
npm install
```

## 启动（开发模式）

启动 API（自动编译并在变更后重启）：

```bash
npm run dev --workspace=@meie/server
```

启动 Worker（第二个终端）：

```bash
npm run dev:worker --workspace=@meie/server
```

## 启动（类生产）

API：

```bash
npm run api --workspace=@meie/server
```

Worker：

```bash
npm run worker --workspace=@meie/server
```

## API 接口速查

Base URL: `http://<HOST>:<PORT>`（默认 `127.0.0.1:8090`）

- `GET /healthz`
- `POST /v1/jobs`（multipart；必需 Header `X-User-Id`）
- `GET /v1/jobs/:jobId`
- `GET /v1/jobs/:jobId/events`（SSE：`snapshot`、`state`、`progress`、`completed`、`failed`）
- `GET /v1/jobs/:jobId/images/:idx`
- `POST /v1/jobs/:jobId/cancel`
