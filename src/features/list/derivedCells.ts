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
 * v6.5（需求 8）：列表行标注色。
 *
 *   · 分类 / 款式 / 季节 任一为空 → 浅灰（incomplete）
 *   · 三者都有值、但拥有形态为空 → 浅黄（noformat）
 *   · 灰优先于黄：两条规则互不叠加（分类/款式/季节有缺项时只看灰色）
 */
export type RowAnnotation = 'incomplete' | 'noformat' | null;

export function rowAnnotation(r: {
  分类?: unknown; 款式?: unknown; 季节?: unknown; 拥有形态?: unknown;
}): RowAnnotation {
  const catRaw = Array.isArray(r.分类) ? r.分类 : (r.分类 === undefined || r.分类 === null ? [] : [r.分类]);
  const catEmpty = catRaw.every((v) => String(v ?? '').trim() === '');
  const styleEmpty = String(r.款式 ?? '').trim() === '';
  const seasonEmpty = String(r.季节 ?? '').trim() === '';
  if (catEmpty || styleEmpty || seasonEmpty) return 'incomplete';
  const own = Array.isArray(r.拥有形态) ? r.拥有形态 : [];
  if (own.length === 0) return 'noformat';
  return null;
}

/**
 * v6.5（需求 9）：「电子」「纸质」两列的单元格 —— 勾选该形态显示 ✓，未勾选显示 ×。
 */
export function formatMarkIcon(own: unknown, format: '电子版' | '纸质版'): '✓' | '×' {
  const list = Array.isArray(own) ? own.map((v) => String(v)) : [];
  return list.includes(format) ? '✓' : '×';
}
