# Multi-Element Image Engine

这是一个集成了 **ComfyUI API 后端** 与 **React 前端** 的 Monorepo 项目，旨在构建高级的 AI 图像生成工作流。

## 📁 项目结构

```
multi-element-image-engine/
├── apps/
│   ├── meie-server/          # 后端 - ComfyUI API 集成与测试工具
│   └── meie-ui/              # 前端 - React + Vite + TailwindCSS
├── package.json              # 根工作区配置
└── tsconfig.json             # 共享 TypeScript 配置
```

## 🚀 快速开始

### 1. 环境准备

- Node.js >= 18.0.0
- npm >= 7.0.0
- **ComfyUI** 正在本地运行 (默认端口 8000)

### 2. ComfyUI 模型配置（重要）

你需要先确保 ComfyUI 中安装了基础模型（Checkpoint）才能生成图片。

**如何安装模型：**

1.  **使用 ComfyUI Manager (推荐)**:
    - 打开 http://127.0.0.1:8000
    - 点击 "Manager" -> "Model Manager"
    - 搜索并安装 "Stable Diffusion v1.5"

2.  **手动安装**:
    - 下载模型文件（如 `.safetensors`）
    - 放入 ComfyUI 的模型目录：`/Users/chris/Documents/ComfyUI/models/checkpoints/`
    - [Stable Diffusion v1.5 下载链接](https://huggingface.co/runwayml/stable-diffusion-v1-5)

**验证模型安装：**

在项目根目录运行以下命令，检查 ComfyUI 是否识别到了模型：

```bash
cd apps/meie-server
npm run check
```

如果看到 "✓ 找到 X 个可用模型"，说明配置成功。

### 3. 安装与运行

回到项目根目录：

```bash
# 1. 安装所有依赖
npm install

# 2. 启动开发环境（同时启动前端和后端）
npm run dev
```

- **前端界面**: 打开 [http://localhost:5173](http://localhost:5173)
- **后端服务**: 运行在监听模式，处理 TypeScript 编译

---

## 📘 详细使用指南

### 后端功能 (@meie/server)

后端模块主要用于测试 ComfyUI API 连接和执行自动化工作流。

**常用命令** (在 `apps/meie-server` 目录下):

- `npm start`: 运行 Demo，读取 `demo_workflow.json` 并生成一张图片。
- `npm run check`: 检查可用模型，并自动更新 workflow 文件以使用第一个可用模型。

**工作流原理：**

1.  代码读取 `Unsaved Workflow.json` (ComfyUI API 格式)。
2.  通过 HTTP 请求将工作流发送给 ComfyUI (`http://127.0.0.1:8000/prompt`)。
3.  通过 WebSocket 监听生成进度。
4.  图片生成后保存在 ComfyUI 的 `output` 目录下。

### 前端功能 (@meie/ui)

MEIE Studio 是一个现代化的 AI 图像合成工作台。

**主要特性：**
- **拖拽上传**: 支持参考图（Reference）和多张素材图（Source）的拖拽上传。
- **实时状态**: 完整的生成进度模拟和状态展示。
- **Modern UI**: 使用 TailwindCSS 构建的 Claude 风格界面，支持深色/浅色主题。
- **API 代理**: 开发服务器配置了代理，前端请求 `/api/*` 会自动转发到本地 ComfyUI。

---

## 🔧 架构说明

### Monorepo (npm workspaces)
本项目使用 npm workspaces 管理依赖：
- **依赖提升**: 公共依赖（TypeScript, @types/node）安装在根目录。
- **统一管理**: 一次 `npm install` 即可安装所有依赖。

### API Proxy
前端开发服务器 (Vite) 配置了代理：
- 前端请求: `http://localhost:5173/api/...`
- 自动转发: `http://127.0.0.1:8000/...`
- **优势**: 解决了开发环境下的 CORS 跨域问题。

---

## ❓ 常见问题 (FAQ)

**Q: 为什么运行 npm start 报错说找不到模型？**
A: 请参考上文的"模型配置"部分。ComfyUI 需要 Checkpoint 模型才能工作。运行 `npm run check` 可以帮你诊断问题。

**Q: 如何修改生成的图片内容？**
A:
1.  **前端**: 在网页界面上传不同的参考图或修改参数。
2.  **后端**: 修改 `apps/meie-server/demo_workflow.json` 文件中的 prompt 节点文本，或者修改代码中的参数。

**Q: 生成图片需要多久？**
A: 取决于你的硬件。在 Apple Silicon (M1/M2/M3) Mac 上，使用 MPS 加速通常需要 20-60 秒。

**Q: 手动设计的 ComfyUI 工作流怎么用？**
A: 在 ComfyUI 网页端点击 "Save (API Format)" 导出 JSON，将其保存为项目中的 `demo_workflow.json` (或代码中指定的文件名) 即可。

---

## 🤝 贡献与开发

```bash
# 运行类型检查
npm run type-check

# 构建生产版本
npm run build
```

**License**: MIT
