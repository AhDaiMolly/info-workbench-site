/**
 * v6.3 · 需求 2 字段选项（品牌/款式）store 级行为验证（真实 AppProvider，jsdom）
 *
 * 行为合同：
 *   · 自由输入保存：allowNew 枚举（品牌）的新值可正常写入记录，
 *     写回闸门 validateRecords 不再对 allowNew 字段报「不在选项集内」；
 *   · 新值沉淀：addFieldOption 把新值加入候选，待同步队列记「字段选项」条目，
 *     重复沉淀幂等（不重复记账）；沉淀结果随缓存持久化到 localStorage；
 *   · 选项删除与历史不受影响：removeFieldOption 只把值移出候选，
 *     使用该值的历史记录取值保持原样；restoreFieldOption 可恢复；
 *   · 非 allowNew 枚举（如季节）仍受选项集校验（回归保护）。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { AppProvider, useApp } from '../store/store';
import { STORAGE_KEYS } from '../store/persist';
import { DEFAULT_SCHEMA } from '../schema';
import { validateRecords } from '../store/migrations';
import type { RecordItem } from '../types';

function makeRecord(over: Partial<RecordItem> & { id: number }): RecordItem {
  const { id, ...rest } = over;
  return {
    id,
    名称: `记录-${id}`,
    品牌: '品牌甲',
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

function seedCache(records: RecordItem[], options?: Record<string, { added: string[]; removed: string[] }>): void {
  window.localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify({
    schemaVersion: 5,
    dataVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    schema: DEFAULT_SCHEMA,
    records,
    plans: [],
    plansBaseSha: null,
    plansDataVersion: 1,
    options: options ?? {},
    optionsBaseSha: null,
    optionsDataVersion: 1,
  }));
}

function setup(records: RecordItem[], options?: Record<string, { added: string[]; removed: string[] }>) {
  seedCache(records, options);
  return renderHook(() => useApp(), {
    wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  if (!URL.createObjectURL) {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:stub';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
  }
});

afterEach(() => {
  cleanup();
});

describe('v6.3 · 字段选项：自由输入保存 / 沉淀 / 删除与恢复', () => {
  it('自由输入保存：新品牌值正常写入记录，写回闸门不报「不在选项集内」', () => {
    const { result } = setup([makeRecord({ id: 1 })]);

    let newId: number | null = null;
    act(() => {
      newId = result.current.actions.addRecord({ 名称: '新品晨雾', 品牌: '全新品牌栗栗' });
    });

    expect(newId).not.toBeNull();
    const saved = result.current.records.find((r) => r.id === newId);
    expect(saved?.品牌).toBe('全新品牌栗栗');
    // 写回闸门：allowNew 字段的新值不产生校验问题
    const issues = validateRecords(result.current.records, result.current.schema);
    expect(issues.filter((i) => i.字段 === '品牌')).toHaveLength(0);
  });

  it('回归保护：非 allowNew 枚举（季节）的越界值仍被写回闸门拦截', () => {
    const { result } = setup([makeRecord({ id: 1, 季节: '不存在的季节' })]);
    const issues = validateRecords(result.current.records, result.current.schema);
    expect(issues.some((i) => i.字段 === '季节' && i.问题.includes('不在选项集内'))).toBe(true);
  });

  it('新值沉淀进候选并记账「字段选项」待同步条目；重复沉淀幂等；随缓存持久化', () => {
    const { result } = setup([makeRecord({ id: 1 })]);

    act(() => {
      result.current.actions.addFieldOption('品牌', '新牌子');
    });
    expect(result.current.optionCandidates['品牌']).toContain('新牌子');
    const optionChanges = result.current.pending.filter((c) => c.字段[0] === '字段选项');
    expect(optionChanges.map((c) => c.字段[1])).toEqual(['品牌']);

    // 幂等：重复沉淀同一值 → 不新增待同步条目
    act(() => {
      result.current.actions.addFieldOption('品牌', '新牌子');
    });
    expect(
      result.current.pending.filter((c) => c.字段[0] === '字段选项'),
    ).toHaveLength(1);

    // 沉淀结果随缓存写进 localStorage
    const raw = window.localStorage.getItem(STORAGE_KEYS.cache);
    expect(raw).toBeTruthy();
    const cached = JSON.parse(raw!) as { options?: Record<string, { added: string[] }> };
    expect(cached.options?.['品牌']?.added).toEqual(['新牌子']);
  });

  it('删除选项：候选消失，使用它的历史记录取值原样保留；恢复后候选回来', () => {
    // 品牌甲来自「用户沉淀」（added），品牌乙同记录正在使用
    const { result } = setup(
      [makeRecord({ id: 1, 品牌: '品牌甲' })],
      { 品牌: { added: ['品牌甲'], removed: [] } },
    );
    expect(result.current.optionCandidates['品牌']).toContain('品牌甲');

    act(() => {
      result.current.actions.removeFieldOption('品牌', '品牌甲');
    });
    expect(result.current.optionCandidates['品牌']).not.toContain('品牌甲');
    // 历史记录不受影响
    expect(result.current.records.find((r) => r.id === 1)?.品牌).toBe('品牌甲');
    expect(result.current.pending.some((c) => c.字段[0] === '字段选项')).toBe(true);

    // 恢复：候选重新出现
    act(() => {
      result.current.actions.restoreFieldOption('品牌', '品牌甲');
    });
    expect(result.current.optionCandidates['品牌']).toContain('品牌甲');
  });

  it('内置（schema）选项同样可删除隐藏：记录原值不动，恢复后回到候选', () => {
    // 用远端 schema 风格：给兜底 schema 的品牌字段补上选项集
    const schema = JSON.parse(JSON.stringify(DEFAULT_SCHEMA)) as typeof DEFAULT_SCHEMA;
    const brandField = schema.fields.find((f) => f.jsonKey === '品牌')!;
    brandField.options = ['晨雾', '栗栗'];

    window.localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify({
      schemaVersion: 5,
      dataVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      schema,
      records: [makeRecord({ id: 1, 品牌: '晨雾' })],
      plans: [],
      plansBaseSha: null,
      plansDataVersion: 1,
      options: {},
      optionsBaseSha: null,
      optionsDataVersion: 1,
    }));
    const { result } = renderHook(() => useApp(), {
      wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
    });

    expect(result.current.optionCandidates['品牌']).toEqual(['晨雾', '栗栗']);

    act(() => {
      result.current.actions.removeFieldOption('品牌', '晨雾');
    });
    expect(result.current.optionCandidates['品牌']).toEqual(['栗栗']);
    // 历史记录取值保持
    expect(result.current.records.find((r) => r.id === 1)?.品牌).toBe('晨雾');

    act(() => {
      result.current.actions.restoreFieldOption('品牌', '晨雾');
    });
    // 恢复内置选项后回到 schema 原顺序
    expect(result.current.optionCandidates['品牌']).toEqual(['晨雾', '栗栗']);
  });
});
