/**
 * 信息汇总工作台 · 列表页派生列的纯函数（R1 / R2）
 *
 * v6.4 派生列口径调整：
 *   · 形态 ← 拥有形态（💾 电子版 / 📄 纸质版）—— 仍是派生列
 *   · 教程 ← 教程（有 = ✓ / 无 = ✗ / 未填 = 留空，不再有「未知」灰圈态）
 *   · 「标记」派生列已删除；「做过」改为独立列直接展示数据字段（是 → ✓ / 其余 → 留空）
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

/** 教程 → 图标（有 = ✓ / 无 = ✗；未填不在映射里 → 留空） */
export const TUTORIAL_ICONS: Record<string, string> = {
  有: '✓',
  无: '✗',
};

/** 形态列：返回图标数组（未拥有任何形态 → 空数组） */
export function ownershipIcons(own: unknown): string[] {
  const list = Array.isArray(own) ? own.map((v) => String(v)) : [];
  return OWNERSHIP_FORMAT_OPTIONS
    .filter((o) => list.includes(o))
    .map((o) => OWNERSHIP_ICONS[o]);
}

/**
 * 教程列：三态图标（v6.4）。
 * 有 → ✓；无 → ✗；未填 / 未知 / 空白 / 任意其它取值 → ''（留空）。
 */
export function tutorialIcon(value: unknown): string {
  const v = String(value ?? '').trim();
  return TUTORIAL_ICONS[v] ?? '';
}

/**
 * 做过列：两态（v6.4 新增，替代原「标记」派生列）。
 * 做过 = 是（真值）→ ✓；其余（否 / 未填）→ ''（留空）。
 */
export function doneIcon(value: unknown): string {
  return value ? '✓' : '';
}

/** 分类列：最多 max 个标签 + 「+n」（R1：最多 2 个） */
export function truncateTags(values: unknown, max = 2): { shown: string[]; extra: number } {
  const list = Array.isArray(values) ? values.map((v) => String(v)) : [];
  const shown = list.slice(0, max);
  return { shown, extra: Math.max(0, list.length - shown.length) };
}

/**
 * 列表行标注色（v6.5 引入；v6.6 纳入清单口径；v6.8 简化为单规则；v6.9 纳入「做过」）。
 *
 *   · v6.9 单规则：「没做过」且「不在任何清单中」的记录整行标浅黄（noformat），其余一律不填色。
 *     做过 ✓ 的记录即使不在任何清单也不标色。
 *   · v6.8 废除旧浅灰（incomplete）规则与「拥有形态为空标黄」规则 ——
 *     分类 / 款式 / 季节 / 拥有形态不再参与行标注色。
 *
 * hasPlan = 该记录至少属于一份计划清单；done = 该记录「做过」为真值。
 * 两者缺省均为 true（调用方无法提供时退化为「不标色」的保守口径）。
 */
export type RowAnnotation = 'noformat' | null;

export function rowAnnotation(hasPlan: boolean = true, done: boolean = true): RowAnnotation {
  return !hasPlan && !done ? 'noformat' : null;
}

/**
 * v6.5（需求 9）：「电子」「纸质」两列的单元格 —— 勾选该形态显示 ✓，未勾选显示 ×。
 */
export function formatMarkIcon(own: unknown, format: '电子版' | '纸质版'): '✓' | '×' {
  const list = Array.isArray(own) ? own.map((v) => String(v)) : [];
  return list.includes(format) ? '✓' : '×';
}
