/**
 * 信息汇总工作台 · 版本信息（v6 需求 1）
 *
 * 版本号（package.json）+ 构建日期 + 提交短哈希由 vite.config.ts 在构建时
 * 通过 define 注入为 __WB_BUILD_INFO__；「设置」页底部信息区展示。
 *
 * 兜底：源码不经 vite（单测 worker 注入失效、源码包直接运行）时使用本地占位值，
 * 展示层不会因此报错。
 */

export interface BuildInfo {
  /** package.json 的版本号（不带 v 前缀） */
  version: string;
  /** 构建时刻（ISO 字符串） */
  builtAt: string;
  /** 提交短哈希 */
  commit: string;
}

declare const __WB_BUILD_INFO__: BuildInfo;

export const BUILD_INFO: BuildInfo = typeof __WB_BUILD_INFO__ === 'undefined'
  ? { version: '0.0.0-local', builtAt: '', commit: '' }
  : __WB_BUILD_INFO__;

/** 构建日期（本地化到天）；无构建时间（本地源码运行）时返回空串 */
export function buildDateText(): string {
  if (!BUILD_INFO.builtAt) return '';
  const d = new Date(BUILD_INFO.builtAt);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 设置页展示用的一行版本描述，如「v6.0.0（构建 2026-11-03 · 提交 1a2b3c4）」 */
export function buildInfoText(): string {
  const version = `v${BUILD_INFO.version}`;
  const date = buildDateText();
  const parts: string[] = [];
  if (date) parts.push(`构建 ${date}`);
  if (BUILD_INFO.commit) parts.push(`提交 ${BUILD_INFO.commit}`);
  return parts.length ? `${version}（${parts.join(' · ')}）` : `${version}（本地源码，未经过构建注入）`;
}
