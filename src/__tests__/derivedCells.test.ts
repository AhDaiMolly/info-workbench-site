/**
 * v5 · R1 / R2 列表页派生列的纯函数单测。
 *
 * 覆盖：
 *   · 形态列（拥有形态 → 图标）
 *   · 教程列（有 / 无 / 未知）
 *   · 标记列（计划 / 做过 / 推荐 的图标组合与负向标记）
 *   · 分类列截断（最多 2 个 + 「+n」）
 */

import { describe, expect, it } from 'vitest';
import {
  markIcons, ownershipIcons, tutorialIcon, tutorialIsKnown, truncateTags,
  OWNERSHIP_ICONS, TUTORIAL_ICONS,
} from '../features/list/derivedCells';

describe('v5 · R1 形态列', () => {
  it('拥有电子版 → 💾；拥有纸质版 → 📄', () => {
    expect(ownershipIcons(['电子版'])).toEqual(['💾']);
    expect(ownershipIcons(['纸质版'])).toEqual(['📄']);
  });

  it('双有 → 两个图标，顺序固定（电子版在前）', () => {
    expect(ownershipIcons(['纸质版', '电子版'])).toEqual([OWNERSHIP_ICONS.电子版, OWNERSHIP_ICONS.纸质版]);
  });

  it('皆无 / 非法值 → 空数组', () => {
    expect(ownershipIcons([])).toEqual([]);
    expect(ownershipIcons(undefined)).toEqual([]);
    expect(ownershipIcons('电子版')).toEqual([]);
    expect(ownershipIcons(['不确定'])).toEqual([]);
  });
});

describe('v5 · R1 教程列', () => {
  it('有 / 无 / 未知 分别对应 ▶ / ∅ / ○', () => {
    expect(tutorialIcon('有')).toBe('▶');
    expect(tutorialIcon('无')).toBe('∅');
    expect(tutorialIcon('未知')).toBe('○');
  });

  it('缺省或非法取值按「未知」处理', () => {
    expect(tutorialIcon(undefined)).toBe(TUTORIAL_ICONS['未知']);
    expect(tutorialIcon('')).toBe(TUTORIAL_ICONS['未知']);
    expect(tutorialIcon('别的')).toBe(TUTORIAL_ICONS['未知']);
  });

  it('只有「有 / 无」算确定态', () => {
    expect(tutorialIsKnown('有')).toBe(true);
    expect(tutorialIsKnown('无')).toBe(true);
    expect(tutorialIsKnown('未知')).toBe(false);
    expect(tutorialIsKnown(undefined)).toBe(false);
  });
});

describe('v6.1 · R2 标记列（计划 / 做过 / 推荐 的图标组合）', () => {
  it('计划 = 在计划中 → ⭐；做过 = 是 → ✓；推荐 = 推荐 → 👍', () => {
    const icons = markIcons({ 计划: '在计划中', 做过: true, 推荐: '推荐' });
    expect(icons.map((i) => i.char)).toEqual(['⭐', '✓', '👍']);
    expect(icons.every((i) => i.tone === 'positive')).toBe(true);
    expect(icons.map((i) => i.field)).toEqual(['计划', '做过', '推荐']);
  });

  it('不想做 / 不推荐 → 负向 ✕', () => {
    const icons = markIcons({ 计划: '不想做', 做过: false, 推荐: '不推荐' });
    expect(icons.map((i) => i.char)).toEqual(['✕', '✕']);
    expect(icons.every((i) => i.tone === 'negative')).toBe(true);
  });

  it('不是现在 / 未标记 / 未评价 → 不产生图标', () => {
    expect(markIcons({ 计划: '不是现在', 做过: false, 推荐: '未评价' })).toEqual([]);
    expect(markIcons({ 计划: '未标记' })).toEqual([]);
    expect(markIcons({})).toEqual([]);
  });

  it('混合态：正向与负向可同时出现', () => {
    const icons = markIcons({ 计划: '在计划中', 做过: false, 推荐: '不推荐' });
    expect(icons.map((i) => i.char)).toEqual(['⭐', '✕']);
    expect(icons[0].tone).toBe('positive');
    expect(icons[1].tone).toBe('negative');
  });

  it('字段模型不变：标记列只读，不改写 做过 / 计划 / 推荐 的原始值', () => {
    const r = { 计划: '在计划中', 做过: true, 推荐: '推荐' };
    const before = JSON.stringify(r);
    markIcons(r);
    expect(JSON.stringify(r)).toBe(before);
  });
});

describe('v5 · R1 分类列截断（最多 2 个 + 「+n」）', () => {
  it('不超过 2 个时全部展示', () => {
    expect(truncateTags(['女装'])).toEqual({ shown: ['女装'], extra: 0 });
    expect(truncateTags(['女装', '男装'])).toEqual({ shown: ['女装', '男装'], extra: 0 });
  });

  it('超过 2 个时只展示前 2 个并给出剩余数量', () => {
    expect(truncateTags(['女装', '男装', '童装', '婴童'])).toEqual({ shown: ['女装', '男装'], extra: 2 });
  });

  it('空值 / 非法值 → 空列表', () => {
    expect(truncateTags([])).toEqual({ shown: [], extra: 0 });
    expect(truncateTags(undefined)).toEqual({ shown: [], extra: 0 });
    expect(truncateTags('女装')).toEqual({ shown: [], extra: 0 });
  });
});
