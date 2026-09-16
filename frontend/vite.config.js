import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api':     { target: 'http://localhost:5000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:5000', changeOrigin: true },
      '/ws':      { target: 'ws://localhost:5000',  ws: true },
    },
  },
  // `vite preview` (used to serve the production build) does NOT reuse
  // `server.proxy` automatically — it needs its own `preview.proxy` block,
  // or API/upload/websocket requests silently 404 once you switch from
  // `npm run dev` to `npm run build && npm run preview`.
  preview: {
    host: true,
    port: 5173,
    proxy: {
      '/api':     { target: 'http://localhost:5000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:5000', changeOrigin: true },
      '/ws':      { target: 'ws://localhost:5000',  ws: true },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:  ['react', 'react-dom', 'react-router-dom'],
          editor:  ['@monaco-editor/react'],
          charts:  ['recharts'],
        },
      },
    },
  },
});
