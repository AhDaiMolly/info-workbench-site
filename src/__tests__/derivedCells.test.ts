/**
 * 列表页派生列的纯函数单测（v6.4 口径）。
 *
 * 覆盖：
 *   · 形态列（拥有形态 → 图标）
 *   · 教程列三态（有 = ✓ / 无 = ✗ / 未填 = 留空）
 *   · 做过列两态（是 = ✓ / 其余 = 留空）—— v6.4 新增，替代原「标记」派生列
 *   · 分类列截断（最多 2 个 + 「+n」）
 */

import { describe, expect, it } from 'vitest';
import {
  doneIcon, ownershipIcons, tutorialIcon, truncateTags,
  OWNERSHIP_ICONS, TUTORIAL_ICONS,
} from '../features/list/derivedCells';

describe('形态列', () => {
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

describe('v6.4 · 教程列三态（有 = ✓ / 无 = ✗ / 未填 = 留空）', () => {
  it('有 → ✓；无 → ✗', () => {
    expect(tutorialIcon('有')).toBe('✓');
    expect(tutorialIcon('无')).toBe('✗');
    expect(TUTORIAL_ICONS.有).toBe('✓');
    expect(TUTORIAL_ICONS.无).toBe('✗');
  });

  it('未填 / 空白 / 未知 / 非法取值 → 留空（不再有「未知」灰圈态）', () => {
    expect(tutorialIcon(undefined)).toBe('');
    expect(tutorialIcon('')).toBe('');
    expect(tutorialIcon('未知')).toBe('');
    expect(tutorialIcon('别的')).toBe('');
    expect('未知' in TUTORIAL_ICONS).toBe(false);
  });
});

describe('v6.4 · 做过列两态（是 = ✓ / 其余 = 留空）', () => {
  it('做过为真值 → ✓', () => {
    expect(doneIcon(true)).toBe('✓');
  });

  it('做过为否 / 未填 → 留空', () => {
    expect(doneIcon(false)).toBe('');
    expect(doneIcon(undefined)).toBe('');
  });
});

describe('分类列截断（最多 2 个 + 「+n」）', () => {
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
