/**
 * v6.5（需求 9）：「电子 / 纸质」两列标记 + 行标注色纯函数（v6.8 单规则口径）
 */

import { describe, expect, it } from 'vitest';
import { formatMarkIcon, rowAnnotation } from '../features/list/derivedCells';

describe('行标注色（v6.8 单规则：不在任何清单 → 浅黄，其余不填色）', () => {
  it('不在任何清单 → 浅黄（noformat）—— 分类 / 款式 / 季节 / 拥有形态不再参与', () => {
    expect(rowAnnotation(false)).toBe('noformat');
  });

  it('在清单里 → 无标注色（即使信息不齐全或无拥有形态）', () => {
    expect(rowAnnotation(true)).toBeNull();
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
