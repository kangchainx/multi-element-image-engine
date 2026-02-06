# Multi-Element Image Engine

A monorepo project integrating ComfyUI API backend with React frontend for advanced image generation workflows.

## 📁 Project Structure

```
multi-element-image-engine/
├── apps/
│   ├── meie-server/          # Backend - ComfyUI API integration
│   └── meie-ui/              # Frontend - React + Vite
├── packages/                  # (Future) Shared code
├── package.json              # Root workspace configuration
└── tsconfig.json             # Shared TypeScript config
```

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm >= 7.0.0
- ComfyUI running on port 8000

### Installation

```bash
# Install all dependencies (root + workspaces)
npm install
```

### Development

**Start both frontend and backend concurrently:**
```bash
npm run dev
```

**Start individually:**
```bash
# Backend only (ComfyUI API demo)
npm run dev:server

# Frontend only (React app on port 5173)
npm run dev:ui
```

### Building

```bash
# Build both workspaces
npm run build

# Build individually
npm run build:server
npm run build:ui
```

### Type Checking

```bash
# Check types in all workspaces
npm run type-check
```

## 📦 Workspaces

### @meie/server

Backend TypeScript application that integrates with ComfyUI API for image generation.

**Key files:**
- `demo.ts` - Main ComfyUI API integration demo
- `check-models.ts` - Model verification utility
- `demo_workflow.json` - Example workflow configuration

**Commands:**
```bash
cd apps/meie-server
npm run start        # Run demo
npm run check        # Check models
npm run dev          # Watch mode
npm run build        # Compile TypeScript
```

**Documentation:**
- [使用指南](apps/meie-server/使用指南.md)
- [快速开始](apps/meie-server/快速开始.md)
- [模型安装指南](apps/meie-server/模型安装指南.md)

### @meie/ui

React frontend built with Vite, featuring modern development workflow and API proxy.

**Key features:**
- React 18 with TypeScript
- Vite 5 for fast HMR
- Proxy configuration for backend API calls (`/api/*` → `http://127.0.0.1:8000`)
- Dark/light theme support

**Commands:**
```bash
cd apps/meie-ui
npm run dev          # Start dev server (port 5173)
npm run build        # Build for production
npm run preview      # Preview production build
```

## 🔧 Architecture

### npm Workspaces

This monorepo uses native npm workspaces for:
- **Dependency hoisting**: Common dependencies (TypeScript, @types/node) installed at root
- **Simplified workflow**: Single `npm install` for entire project
- **Code sharing**: Prepared for shared packages between frontend/backend

### API Proxy

Frontend development server proxies `/api/*` requests to ComfyUI backend:
- **Frontend**: `http://localhost:5173/api/system_stats`
- **Proxies to**: `http://127.0.0.1:8000/system_stats`
- **Benefit**: No CORS issues during development

### TypeScript Configuration

Base configuration at root, extended by workspaces:
- **Root**: Shared strict settings, ES2022 target
- **Server**: Node.js specific settings
- **UI**: React + DOM libraries, modern JSX transform

## 🛠️ Development Workflow

1. **Start ComfyUI** on port 8000
2. **Run monorepo dev**: `npm run dev`
3. **Frontend**: Opens on http://localhost:5173
4. **Backend**: Watches TypeScript files in server workspace
5. **API calls**: Frontend `/api/*` automatically proxied to backend

## 📝 Future Enhancements

- **Shared packages**: Create `packages/shared-types` for common TypeScript interfaces
- **Build caching**: Add Turborepo for optimized builds
- **Code quality**: ESLint + Prettier configuration
- **Pre-commit hooks**: Husky for automated checks

## 📚 Documentation

Detailed documentation available in workspace directories:
- [meie-server README](apps/meie-server/README.md)
- [中文文档](apps/meie-server/使用指南.md)

## 🔍 Verification

After setup, verify everything works:

```bash
# 1. Check dependencies installed
ls -la node_modules/@types
ls -la apps/meie-server/node_modules/tsx

# 2. Test backend
npm run dev:server
# Should connect to ComfyUI and show available models

# 3. Test frontend
npm run dev:ui
# Open http://localhost:5173
# Should show ComfyUI connection status

# 4. Test type checking
npm run type-check
# Should show no errors

# 5. Test builds
npm run build
# Should create dist/ folders in both workspaces
```

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! This monorepo structure makes it easy to:
- Add new shared packages
- Maintain consistent code quality
- Scale to additional applications

---

**Built with**: Node.js • TypeScript • React • Vite • ComfyUI • npm Workspaces
