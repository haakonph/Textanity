import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, '');
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    envDir: workspaceRoot,
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: process.env.API_PROXY_TARGET || env.API_PROXY_TARGET || 'http://127.0.0.1:3000' } },
    },
    build: { outDir: '../../dist/apps/web', emptyOutDir: true },
  };
});
