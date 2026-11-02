/**
 * 信息汇总工作台 · 应用入口
 *
 * 挂载顺序：Provider → App。
 * 样式在入口一次性引入，避免闪烁；CSS 变量定义在 tokens.css。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './store/store';
import './styles/tokens.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到挂载节点 #root，index.html 可能被改动');
}

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
