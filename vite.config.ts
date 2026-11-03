import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * 信息汇总工作台 · 构建配置
 * base: './' —— 相对路径产物，GitHub Pages 的
 * https://OWNER.github.io/REPO/ 与 https://OWNER.github.io/ 两种形态都能正常加载（架构 8 阶段三）。
 *
 * v6（需求 1）：构建时注入版本信息（package.json 版本号 + 构建日期 + 提交短哈希），
 * 由 src/version.ts 读取，展示在「设置」页底部信息区。
 */

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** 提交短哈希：CI / 本地都能取到；取不到（源码包解压等）时降级为 unknown */
function readCommitShort(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  base: './',
  define: {
    __WB_BUILD_INFO__: JSON.stringify({
      version: pkg.version,
      builtAt: new Date().toISOString(),
      commit: readCommitShort(),
    }),
  },
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
  test: {
    // 纯函数测试跑在 node；*.dom.test.tsx 跑在 jsdom（表单分区 / 单选交互）
    // 注：vitest 4 已移除 environmentMatchGlobs，等价写法是 projects
    globals: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.dom.test.tsx'],
        },
      },
    ],
  },
});
