import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 信息汇总工作台 · 构建配置
 * base: './' —— 相对路径产物，GitHub Pages 的
 * https://OWNER.github.io/REPO/ 与 https://OWNER.github.io/ 两种形态都能正常加载（架构 8 阶段三）。
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          echarts: ['echarts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  preview: {
    port: 4173,
    host: '0.0.0.0',
  },
});
