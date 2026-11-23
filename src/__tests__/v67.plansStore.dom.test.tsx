/**
 * v6.7 · 清单拖拽重排与新建带成员（真实 store，jsdom）
 *
 * 行为合同：
 *   · reorderPlanList：清单顺序被改写，并按「计划清单」字段记账待同步；
 *   · 顺序没变 / id 集合不一致 → no-op（不产生待同步条目）；
 *   · reorderPlanMembers：清单内成员顺序被改写并记账；成员集合不一致 → no-op；
 *   · createPlanList(name, ids)：新建清单直接带上初始成员。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { AppProvider, useApp } from '../store/store';
import { STORAGE_KEYS } from '../store/persist';
import { DEFAULT_SCHEMA } from '../schema';
import type { PlanItem, RecordItem } from '../types';

function makeRecord(id: number): RecordItem {
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
  } as RecordItem;
}

function makePlan(id: string, name: string, members: number[]): PlanItem {
  return {
    id, 名称: name, 记录ID列表: members,
    创建时间: '2026-11-01T00:00:00.000Z', 更新时间: '2026-11-01T00:00:00.000Z',
  };
}

function setup(records: RecordItem[], plans: PlanItem[]) {
  window.localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify({
    schemaVersion: 5,
    dataVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    schema: DEFAULT_SCHEMA,
    records,
    plans,
    plansBaseSha: null,
    plansDataVersion: 1,
  }));
  return renderHook(() => useApp(), {
    wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
  });
}

const planPending = (pending: { 字段: string[] }[]) =>
  pending.filter((c) => c.字段[0] === '计划清单').map((c) => c.字段[1]);

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

describe('v6.7 · 拖拽重排（真实 store）', () => {
  it('reorderPlanList：清单顺序被改写，并记「计划清单」待同步条目', () => {
    const { result } = setup([makeRecord(1), makeRecord(2)], [makePlan('p1', 'A', [1]), makePlan('p2', 'B', [2])]);

    act(() => {
      result.current.actions.reorderPlanList(['p2', 'p1']);
    });

    expect(result.current.plans.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(planPending(result.current.pending).sort()).toEqual(['p1', 'p2']);
  });

  it('reorderPlanList：顺序未变 → no-op（不产生待同步条目）', () => {
    const { result } = setup([makeRecord(1)], [makePlan('p1', 'A', [1]), makePlan('p2', 'B', [])]);

    act(() => {
      result.current.actions.reorderPlanList(['p1', 'p2']);
    });

    expect(result.current.plans.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(result.current.pending.filter((c) => c.字段[0] === '计划清单')).toHaveLength(0);
  });

  it('reorderPlanList：id 集合不一致 → 原样不动', () => {
    const { result } = setup([makeRecord(1)], [makePlan('p1', 'A', [1]), makePlan('p2', 'B', [])]);

    act(() => {
      result.current.actions.reorderPlanList(['p2']);
    });

    expect(result.current.plans.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(result.current.pending.filter((c) => c.字段[0] === '计划清单')).toHaveLength(0);
  });

  it('reorderPlanMembers：成员顺序被改写并记账', () => {
    const { result } = setup([makeRecord(1), makeRecord(2)], [makePlan('p1', 'A', [1, 2])]);

    act(() => {
      result.current.actions.reorderPlanMembers('p1', [2, 1]);
    });

    expect(result.current.plans[0].记录ID列表).toEqual([2, 1]);
    expect(planPending(result.current.pending)).toEqual(['p1']);
  });

  it('reorderPlanMembers：成员集合不一致（增删成员）→ 原样不动', () => {
    const { result } = setup([makeRecord(1), makeRecord(2)], [makePlan('p1', 'A', [1, 2])]);

    act(() => {
      result.current.actions.reorderPlanMembers('p1', [2, 1, 3]);
    });

    expect(result.current.plans[0].记录ID列表).toEqual([1, 2]);
    expect(result.current.pending.filter((c) => c.字段[0] === '计划清单')).toHaveLength(0);
  });

  it('createPlanList：新建清单直接带上初始成员（只写一次，不产生悬空引用）', () => {
    const { result } = setup([makeRecord(1), makeRecord(2)], []);

    let newId: string | null = null;
    act(() => {
      newId = result.current.actions.createPlanList('2026 夏季', [2, 1, 999]);
    });

    expect(newId).toBe('p1');
    const plan = result.current.plans.find((p) => p.id === newId);
    // 999 指向不存在的记录 → 被过滤；成员顺序保留用户挑选的顺序
    expect(plan?.记录ID列表).toEqual([2, 1]);
    expect(plan?.名称).toBe('2026 夏季');
    expect(planPending(result.current.pending)).toEqual(['p1']);
  });
});
