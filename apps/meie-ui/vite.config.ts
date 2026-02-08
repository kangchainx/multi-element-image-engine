import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // Proxy MEIE API in dev to avoid CORS and keep relative URLs working (SSE, images, etc).
        // UI calls: /api/v1/...  ->  API listens: http://127.0.0.1:8090/v1/...
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
