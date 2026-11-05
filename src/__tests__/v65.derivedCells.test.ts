/**
 * v6.5（需求 8 / 9）：列表行标注色与「电子 / 纸质」两列标记
 */

import { describe, expect, it } from 'vitest';
import { formatMarkIcon, rowAnnotation } from '../features/list/derivedCells';

describe('v6.5（需求 8）：行标注色 —— 灰优先于黄，两规则互不叠加', () => {
  it('分类 / 款式 / 季节任一为空 → 浅灰（incomplete）', () => {
    expect(rowAnnotation({ 分类: [], 款式: '外套', 季节: '夏' })).toBe('incomplete');
    expect(rowAnnotation({ 分类: ['女装'], 款式: '', 季节: '夏' })).toBe('incomplete');
    expect(rowAnnotation({ 分类: ['女装'], 款式: '外套', 季节: '' })).toBe('incomplete');
  });

  it('三者齐全但拥有形态为空 → 浅黄（noformat）', () => {
    expect(rowAnnotation({ 分类: ['女装'], 款式: '外套', 季节: '夏', 拥有形态: [] })).toBe('noformat');
  });

  it('两者都满足时灰优先于黄（只返回 incomplete）', () => {
    expect(rowAnnotation({ 分类: [], 款式: '', 季节: '', 拥有形态: [] })).toBe('incomplete');
  });

  it('信息齐全且有拥有形态 → 无标注', () => {
    expect(rowAnnotation({ 分类: ['女装'], 款式: '外套', 季节: '夏', 拥有形态: ['电子版'] })).toBeNull();
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
