/**
 * v6.5 单元级回归：搜索子串命中 / 尺码合并筛选 / 拥有形态「均没有」/ 尺码选项管理
 */

import { describe, expect, it } from 'vitest';
import { filterRecords, searchIds } from '../store/selectors';
import { effectiveSizeGroups, effectiveSizeTags, managedOptionKeys, SIZE_MANAGED_KEYS } from '../store/options';
import { DEFAULT_SCHEMA } from '../schema';
import { EMPTY_FILTERS } from '../types';
import type { Filters, RecordItem } from '../types';

function rec(over: Partial<RecordItem> & { id: number }): RecordItem {
  const { id, ...rest } = over;
  return {
    id,
    名称: `记录-${id}`,
    品牌: '',
    分类: [],
    款式: '',
    季节: '',
    教程: '未知',
    电子版尺码: [],
    拥有形态: [],
    纸质版尺码: [],
    推荐: '未评价',
    做过: false,
    计划: '未标记',
    备注: '',
    创建时间: '2026-01-01T00:00:00.000Z',
    更新时间: '2026-01-01T00:00:00.000Z',
    ...rest,
  } as RecordItem;
}

const filters = (over: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...over }) as Filters;

describe('v6.5（需求 6）：搜索按子串匹配', () => {
  const records = [
    rec({ id: 1, 名称: '896文艺套装-上衣' }),
    rec({ id: 2, 名称: '其他款式的名称' }),
  ];

  it('搜「89」命中「896文艺套装-上衣」（此前整词查表搜不到）', () => {
    expect(searchIds(records, '89')).toEqual([1]);
  });

  it('搜「文艺套装」「896」「套装-上衣」等子串均命中', () => {
    expect(searchIds(records, '文艺套装')).toEqual([1]);
    expect(searchIds(records, '896')).toEqual([1]);
    expect(searchIds(records, '套装-上衣')).toEqual([1]);
  });

  it('搜空串返回全部记录（点 × 清空后恢复完整列表）', () => {
    expect(searchIds(records, '')).toEqual([1, 2]);
    expect(searchIds(records, '   ')).toEqual([1, 2]);
  });

  it('多段关键词取交集：每段都要命中', () => {
    expect(searchIds(records, '89 文艺')).toEqual([1]);
    expect(searchIds(records, '89 其他')).toEqual([]);
  });

  it('「#编号」精确匹配编号，不因子串误命中（#1 不命中 #12 / #150）', () => {
    const idRecords = [
      rec({ id: 1, 名称: '甲' }),
      rec({ id: 12, 名称: '乙' }),
      rec({ id: 150, 名称: '丙' }),
    ];
    expect(searchIds(idRecords, '#1')).toEqual([1]);
    expect(searchIds(idRecords, '#12')).toEqual([12]);
    expect(searchIds(idRecords, '#150')).toEqual([150]);
    expect(searchIds(idRecords, '#15')).toEqual([]);
  });
});

describe('v6.5（需求 4）：尺码筛选命中「电子版 或 纸质版」', () => {
  const records = [
    rec({ id: 1, 名称: '电子版M', 拥有形态: ['电子版'], 电子版尺码: ['M'] }),
    rec({ id: 2, 名称: '纸质版M', 拥有形态: ['纸质版'], 纸质版尺码: ['M'] }),
    rec({ id: 3, 名称: '电子版L', 拥有形态: ['电子版'], 电子版尺码: ['L'] }),
  ];

  it('选中 M 时，电子版命中与纸质版命中都算命中', () => {
    const hit = filterRecords(records, filters({ 电子版尺码: ['M'] }));
    expect(hit.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it('选中 L 只命中电子版那条', () => {
    expect(filterRecords(records, filters({ 电子版尺码: ['L'] })).map((r) => r.id)).toEqual([3]);
  });

  it('选中不存在的码 → 无命中', () => {
    expect(filterRecords(records, filters({ 电子版尺码: ['XXL'] }))).toHaveLength(0);
  });
});

describe('v6.5（需求 5）：拥有形态「均没有」', () => {
  const records = [
    rec({ id: 1, 名称: '都没勾', 拥有形态: [] }),
    rec({ id: 2, 名称: '只有电子', 拥有形态: ['电子版'] }),
    rec({ id: 3, 名称: '两种都有', 拥有形态: ['电子版', '纸质版'] }),
  ];

  it('「均没有」只命中两种形态都没勾的记录', () => {
    expect(filterRecords(records, filters({ 拥有形态: ['均没有'] })).map((r) => r.id)).toEqual([1]);
  });

  it('「任意拥有」命中所有非空形态的记录', () => {
    expect(filterRecords(records, filters({ 拥有形态: ['任意拥有'] })).map((r) => r.id)).toEqual([2, 3]);
  });

  it('「电子版」只命中勾了电子版的记录', () => {
    expect(filterRecords(records, filters({ 拥有形态: ['电子版'] })).map((r) => r.id)).toEqual([2, 3]);
  });
});

describe('v6.5（需求 3）：尺码选项管理（内置基础候选 + 新增 / 删除）', () => {
  it('受管字段包含两个尺码字段', () => {
    expect(SIZE_MANAGED_KEYS).toEqual(['电子版尺码', '纸质版尺码']);
    expect(managedOptionKeys(DEFAULT_SCHEMA)).toEqual(['品牌', '款式', '电子版尺码', '纸质版尺码']);
  });

  it('默认候选 = 字母码 + 身高码（分组给出）', () => {
    const g = effectiveSizeGroups(undefined);
    expect(g.letters).toContain('M');
    expect(g.heights).toContain('165');
    expect(effectiveSizeTags(undefined)).toEqual([...g.letters, ...g.heights]);
  });

  it('新增数字值归身高码组并按数值升序；新增非数字值追加到字母码组末尾', () => {
    const g = effectiveSizeGroups({ added: ['95', '5XL'], removed: [] });
    expect(g.heights).toContain('95');
    expect(g.heights.indexOf('95')).toBeGreaterThan(g.heights.indexOf('90'));
    expect(g.letters[g.letters.length - 1]).toBe('5XL');
  });

  it('删除只影响候选，不影响其它分组', () => {
    const g = effectiveSizeGroups({ added: [], removed: ['M'] });
    expect(g.letters).not.toContain('M');
    expect(g.letters).toContain('S');
    expect(g.heights).toContain('100');
  });
});
