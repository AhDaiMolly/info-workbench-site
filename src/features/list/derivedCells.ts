/**
 * 信息汇总工作台 · 列表页派生列的纯函数（R1 / R2）
 *
 * v5 列表页默认 8 列里有三列是「派生列」——它们不是数据字段，而是由已有字段渲染出来的：
 *   · 形态 ← 拥有形态（💾 电子版 / 📄 纸质版）
 *   · 教程 ← 教程（有 = ▶ / 无 = ∅ / 未知 = 灰○）
 *   · 标记 ← 计划 / 做过 / 推荐（⭐ / ✓ / 👍，负向 = 灰✕）
 *
 * 展示口径来自设计文档第 6 节。把它们抽成纯函数，
 * 单测不必起浏览器就能覆盖渲染口径（真机冒烟再兜一层）。
 */

import { OWNERSHIP_FORMAT_OPTIONS } from '../../schema';

/** 拥有形态 → 图标（💾 电子版 / 📄 纸质版） */
export const OWNERSHIP_ICONS: Record<string, string> = {
  电子版: '💾',
  纸质版: '📄',
};

/** 教程 → 图标（有 = ▶ / 无 = ∅ / 未知 = 灰○） */
export const TUTORIAL_ICONS: Record<string, string> = {
  有: '▶',
  无: '∅',
  未知: '○',
};

export type MarkTone = 'positive' | 'negative';

export interface MarkIcon {
  char: string;
  tone: MarkTone;
  /** 图标对应的字段名 —— 用于 title 无障碍标签与测试断言 */
  field: string;
}

/** 形态列：返回图标数组（未拥有任何形态 → 空数组） */
export function ownershipIcons(own: unknown): string[] {
  const list = Array.isArray(own) ? own.map((v) => String(v)) : [];
  return OWNERSHIP_FORMAT_OPTIONS
    .filter((o) => list.includes(o))
    .map((o) => OWNERSHIP_ICONS[o]);
}

/** 教程列：图标（未知取值一律按「未知」处理） */
export function tutorialIcon(value: unknown): string {
  const v = String(value ?? '').trim();
  return TUTORIAL_ICONS[v] ?? TUTORIAL_ICONS['未知'];
}

/** 教程列是否为「有确定答案」（有 / 无），决定图标是否灰显 */
export function tutorialIsKnown(value: unknown): boolean {
  const v = String(value ?? '').trim();
  return v === '有' || v === '无';
}

/**
 * 标记列：计划 / 做过 / 推荐 的图标组合。
 *
 * 口径：计划=在计划中 → ⭐；做过=是 → ✓；推荐=推荐 → 👍；
 *       计划=不想做 / 推荐=不推荐 → 灰✕；其余（不是现在 / 未标记 / 未评价）不产生图标。
 */
export function markIcons(r: { 计划?: string; 做过?: boolean; 推荐?: string }): MarkIcon[] {
  const out: MarkIcon[] = [];
  if (r.计划 === '在计划中') out.push({ char: '⭐', tone: 'positive', field: '计划' });
  else if (r.计划 === '不想做') out.push({ char: '✕', tone: 'negative', field: '计划' });
  if (r.做过) out.push({ char: '✓', tone: 'positive', field: '做过' });
  if (r.推荐 === '推荐') out.push({ char: '👍', tone: 'positive', field: '推荐' });
  else if (r.推荐 === '不推荐') out.push({ char: '✕', tone: 'negative', field: '推荐' });
  return out;
}

/** 分类列：最多 max 个标签 + 「+n」（R1：最多 2 个） */
export function truncateTags(values: unknown, max = 2): { shown: string[]; extra: number } {
  const list = Array.isArray(values) ? values.map((v) => String(v)) : [];
  const shown = list.slice(0, max);
  return { shown, extra: Math.max(0, list.length - shown.length) };
}
