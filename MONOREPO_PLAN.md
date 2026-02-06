# Monorepo Integration Plan: meie-server + meie-ui

## Context

Currently, the multi-element-image-engine project has:
- **meie-server**: A functional Node.js/TypeScript backend that integrates with ComfyUI API for image generation
- **meie-ui**: An empty directory placeholder for the React frontend (not yet initialized)

The goal is to integrate both into a monorepo structure to:
1. Enable shared development workflow (single install, concurrent dev)
2. Prepare for code sharing between frontend and backend (types, utilities)
3. Simplify deployment and version management
4. Follow modern monorepo best practices

## Approach: npm Workspaces

**Tool:** npm workspaces (native to npm 7+, zero additional dependencies)

**Why npm workspaces:**
- Already using npm - no package manager migration needed
- Perfect for 2-5 packages - lightweight and simple
- Native workspace support with dependency hoisting
- Easy to upgrade to Turborepo later if needed

**Directory Structure:**
```
multi-element-image-engine/
├── package.json                    # Root workspace coordinator
├── tsconfig.json                   # Base TypeScript config
├── .gitignore                      # Root gitignore
├── apps/
│   ├── meie-server/               # Backend (migrated)
│   │   ├── package.json           # @meie/server
│   │   ├── tsconfig.json          # Extends root
│   │   ├── demo.ts
│   │   ├── check-models.ts
│   │   └── demo_workflow.json
│   └── meie-ui/                   # Frontend (new)
│       ├── package.json           # @meie/ui
│       ├── tsconfig.json          # Extends root
│       ├── vite.config.ts         # Vite + proxy config
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           └── App.css
└── packages/                      # (Future) Shared code
```

## Implementation Steps

### 1. Create Root Workspace Configuration

**File:** `/Users/chris/Documents/GitHub/multi-element-image-engine/package.json`

Create root package.json with workspaces configuration:
- Define `workspaces: ["apps/*", "packages/*"]`
- Add orchestration scripts (dev, build, type-check)
- Hoist shared dependencies (TypeScript, @types/node)
- Set `"private": true` to prevent accidental publishing

**File:** `/Users/chris/Documents/GitHub/multi-element-image-engine/tsconfig.json`

Create base TypeScript config:
- Strict mode enabled
- ES2022 target
- Base settings inherited by both workspaces

**File:** `/Users/chris/Documents/GitHub/multi-element-image-engine/.gitignore`

Root gitignore covering:
- node_modules/
- dist/, build/
- .env files
- IDE and OS files

### 2. Migrate meie-server to apps/meie-server

**Directory:** Create `apps/` and move meie-server into it

**Files to migrate:**
- `demo.ts` → `apps/meie-server/demo.ts`
- `check-models.ts` → `apps/meie-server/check-models.ts`
- `demo_workflow.json` → `apps/meie-server/demo_workflow.json`
- Documentation files → `apps/meie-server/`

**File:** `apps/meie-server/package.json`

Update package.json:
- Name: `@meie/server` (scoped package name)
- Remove TypeScript and @types/node (hoisted to root)
- Keep tsx as workspace-specific dependency
- Add `type-check` script for CI

**File:** `apps/meie-server/tsconfig.json`

Update to extend root config:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./",
    "moduleResolution": "node"
  },
  "include": ["*.ts"]
}
```

**No code changes needed** - relative paths in demo.ts and check-models.ts remain valid within workspace.

### 3. Initialize meie-ui Frontend

**File:** `apps/meie-ui/package.json`

Create package.json with:
- Name: `@meie/ui`
- Dependencies: react, react-dom
- DevDependencies: Vite 5, @vitejs/plugin-react-swc, TypeScript types, ESLint
- Scripts: dev, build, preview, type-check

**File:** `apps/meie-ui/vite.config.ts`

Critical Vite configuration:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
```

**Why proxy:** Routes frontend `/api/*` requests to ComfyUI backend at port 8000, eliminates CORS issues in development.

**File:** `apps/meie-ui/tsconfig.json`

Frontend TypeScript config:
- Extends root base
- Adds DOM libs and JSX support
- `jsx: "react-jsx"` for modern JSX transform

**Files:** Create React app structure
- `index.html` - Entry point
- `src/main.tsx` - React root render
- `src/App.tsx` - Main component (with example API call to backend)
- `src/App.css`, `src/index.css` - Basic styles
- `src/vite-env.d.ts` - Vite type declarations

### 4. Install Dependencies

**Command:** `npm install` at root

This will:
1. Install root dependencies (TypeScript, @types/node)
2. Install workspace dependencies
3. Hoist compatible versions to root node_modules
4. Create unified package-lock.json at root

### 5. Git Repository Setup

**Current state:** Git repo exists in meie-server with staged (uncommitted) files

**Action:** Initialize fresh git repo at root
1. Remove `.git` from `apps/meie-server/`
2. Run `git init` at monorepo root
3. Create initial commit with full monorepo structure

**Why fresh start:** No commit history exists yet (only staged files), simpler than preserving minimal staging metadata.

## Critical Files

1. **Root package.json** - Workspace configuration, orchestration scripts
2. **Root tsconfig.json** - Base TypeScript settings
3. **apps/meie-server/package.json** - Backend workspace config
4. **apps/meie-ui/package.json** - Frontend workspace config
5. **apps/meie-ui/vite.config.ts** - Proxy setup for backend integration

## Development Workflow

**Start both apps concurrently:**
```bash
npm run dev
```

**Start individually:**
```bash
npm run dev:server  # Backend only (tsx watch)
npm run dev:ui      # Frontend only (Vite HMR)
```

**Build for production:**
```bash
npm run build       # Both workspaces
npm run build:server  # Backend → dist/
npm run build:ui      # Frontend → dist/
```

**Type checking:**
```bash
npm run type-check  # All workspaces
```

## Verification Steps

After implementation, verify:

1. **Dependency installation:**
   - Check root node_modules exists
   - Verify TypeScript hoisted to root
   - Confirm workspace-specific deps in workspace node_modules

2. **Backend functionality:**
   ```bash
   npm run dev:server
   # Should start tsx watch on demo.ts
   # Verify ComfyUI API connection works
   ```

3. **Frontend functionality:**
   ```bash
   npm run dev:ui
   # Should start Vite dev server on port 5173
   # Open http://localhost:5173
   # Verify React app loads
   ```

4. **Proxy integration:**
   - Start backend (port 8000)
   - Start frontend (port 5173)
   - Frontend API call to `/api/*` should proxy to backend
   - Check browser network tab for successful proxy

5. **Type checking:**
   ```bash
   npm run type-check
   # Should check types in both workspaces
   # No TypeScript errors expected
   ```

6. **Build:**
   ```bash
   npm run build
   # Should compile TypeScript for backend
   # Should build Vite bundle for frontend
   # Check apps/meie-server/dist/ and apps/meie-ui/dist/
   ```

7. **Git:**
   ```bash
   git status
   # Should show clean monorepo structure
   # Verify .gitignore working (node_modules excluded)
   ```

## Future Enhancements

**Shared packages (when needed):**
- Create `packages/shared-types/` for TypeScript interfaces
- Share workflow types, API contracts between frontend/backend
- Use `workspace:*` protocol for internal dependencies

**Task orchestration (if project grows):**
- Add Turborepo for build caching
- Implement dependency graph execution
- Not needed initially for 2 workspaces

**Code quality:**
- Add ESLint + Prettier at root
- Shared formatting rules across workspaces
- Pre-commit hooks with husky

## Risks & Mitigations

**Risk:** Path references in meie-server code break after move
- **Mitigation:** All paths in demo.ts are relative (work within workspace) or absolute (ComfyUI paths unchanged)
- **Verification:** Test backend functionality after migration

**Risk:** Git history lost
- **Mitigation:** No commits exist yet, only staged files - minimal loss
- **Alternative:** Could preserve history with git filter-branch (complex, not worth it for 0 commits)

**Risk:** npm workspaces learning curve
- **Mitigation:** Well-documented, standard tool in 2026
- **Reference:** npm workspaces docs, clear error messages

## Summary

This plan migrates the project to a modern monorepo using:
- **npm workspaces** for dependency management
- **apps/ structure** for organization and scalability
- **Vite + React** for modern frontend development
- **Shared TypeScript config** for consistency

The migration is low-risk (mostly file moves), maintains all existing functionality, and sets up a foundation for future code sharing and scaling.
