/**
 * v6.5（需求 9）：「电子 / 纸质」两列标记 + 行标注色纯函数（v6.9 双参口径）
 */

import { describe, expect, it } from 'vitest';
import { formatMarkIcon, rowAnnotation } from '../features/list/derivedCells';

describe('行标注色（v6.9 单规则：没做过且不在任何清单 → 浅黄，其余不填色）', () => {
  it('没做过且不在任何清单 → 浅黄（noformat）—— 分类 / 款式 / 季节 / 拥有形态不再参与', () => {
    expect(rowAnnotation(false, false)).toBe('noformat');
  });

  it('做过但不在任何清单 → 不标色（v6.9 边界：做过 ✓ 优先豁免）', () => {
    expect(rowAnnotation(false, true)).toBeNull();
  });

  it('没做过但在清单里 → 不标色', () => {
    expect(rowAnnotation(true, false)).toBeNull();
  });

  it('做过且在清单里 → 不标色', () => {
    expect(rowAnnotation(true, true)).toBeNull();
  });
});

describe('v6.5（需求 9）：「电子」「纸质」两列标记', () => {
  it('勾选了就是 √，没勾就是 ×', () => {
    expect(formatMarkIcon(['电子版'], '电子版')).toBe('✓');
    expect(formatMarkIcon(['电子版'], '纸质版')).toBe('×');
    expect(formatMarkIcon(['电子版', '纸质版'], '纸质版')).toBe('✓');
    expect(formatMarkIcon([], '电子版')).toBe('×');
    expect(formatMarkIcon(undefined, '电子版')).toBe('×');
  });
});
