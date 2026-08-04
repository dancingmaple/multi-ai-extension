import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './manifest';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: 'dist',
    // 关闭自动清空：本环境 safe-delete 会拦截 dist 目录的 trash 操作，
    // 导致 vite 的 emptyDir 失败。旧 assets（hash 命名）不被 index.html 引用，可安全残留。
    emptyOutDir: false,
  },
});
