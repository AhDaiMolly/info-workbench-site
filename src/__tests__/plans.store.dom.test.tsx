/**
 * v6.2.1 · 需求 2 计划清单成员随新增记录一并写入（真实 store，jsdom）
 *
 * 行为合同：
 *   · addRecord(values, planIds) 在拿到新记录 ID 的同一动作里写入各清单成员关系，
 *     不存在「先落记录、后补成员」的悬空窗口；
 *   · 待同步队列对每份被改动的清单各记一条「计划清单」条目（阻断自动拉取 + 无基线时重建合并归属）；
 *   · 记录创建失败（名称为空）时不写任何成员关系；
 *   · 不存在的清单 ID 被安全忽略，不产生空清单或报错。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { AppProvider, useApp } from '../store/store';
import { STORAGE_KEYS } from '../store/persist';
import { DEFAULT_SCHEMA } from '../schema';
import type { PlanItem, RecordItem } from '../types';

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

function makePlan(id: string, name: string, members: number[]): PlanItem {
  return {
    id, 名称: name, 记录ID列表: members,
    创建时间: '2026-11-01T00:00:00.000Z', 更新时间: '2026-11-01T00:00:00.000Z',
  };
}

function seedCache(records: RecordItem[], plans: PlanItem[]): void {
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
}

function setup(records: RecordItem[], plans: PlanItem[]) {
  seedCache(records, plans);
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

describe('v6.2.1 · addRecord 随保存一并写入清单成员', () => {
  it('勾选的清单随新记录写入：成员 ID = 新记录 ID，且待同步队列记账', () => {
    const { result } = setup([makeRecord({ id: 1 })], [makePlan('p1', '2026 春季', [1]), makePlan('p2', '给宝宝做的', [])]);

    let newId: number | null = null;
    act(() => {
      newId = result.current.actions.addRecord({ 名称: '新记录晨雾' }, ['p1', 'p2']);
    });

    expect(newId).toBe(2);
    expect(result.current.records.some((r) => r.id === 2)).toBe(true);
    const p1 = result.current.plans.find((p) => p.id === 'p1');
    const p2 = result.current.plans.find((p) => p.id === 'p2');
    expect(p1?.记录ID列表).toEqual([1, 2]);
    expect(p2?.记录ID列表).toEqual([2]);
    // 每份被改动的清单各一条「计划清单」待同步条目
    const planChanges = result.current.pending.filter((c) => c.字段[0] === '计划清单');
    expect(planChanges.map((c) => c.字段[1]).sort()).toEqual(['p1', 'p2']);
    // 成员引用都指向真实存在的记录（无悬空引用）
    const ids = new Set(result.current.records.map((r) => r.id));
    for (const plan of result.current.plans) {
      for (const m of plan.记录ID列表) expect(ids.has(m)).toBe(true);
    }
  });

  it('名称为空 → 记录不创建，成员关系零写入', () => {
    const { result } = setup([makeRecord({ id: 1 })], [makePlan('p1', '2026 春季', [1])]);

    let returned: number | null = 99;
    act(() => {
      returned = result.current.actions.addRecord({ 名称: '   ' }, ['p1']);
    });

    expect(returned).toBeNull();
    expect(result.current.records.length).toBe(1);
    expect(result.current.plans[0].记录ID列表).toEqual([1]);
    expect(result.current.pending.filter((c) => c.字段[0] === '计划清单')).toHaveLength(0);
  });

  it('不传或传空数组 → 行为与旧版一致（不动清单）', () => {
    const { result } = setup([makeRecord({ id: 1 })], [makePlan('p1', '2026 春季', [1])]);

    act(() => {
      result.current.actions.addRecord({ 名称: '普通新增' });
    });

    expect(result.current.plans[0].记录ID列表).toEqual([1]);
  });

  it('不存在的清单 ID 被安全忽略，不报错、不产生新清单', () => {
    const { result } = setup([makeRecord({ id: 1 })], [makePlan('p1', '2026 春季', [1])]);

    let newId: number | null = null;
    act(() => {
      newId = result.current.actions.addRecord({ 名称: '新记录晨雾' }, ['p1', 'ghost']);
    });

    expect(newId).toBe(2);
    expect(result.current.plans.map((p) => p.id)).toEqual(['p1']);
    expect(result.current.plans[0].记录ID列表).toEqual([1, 2]);
    expect(result.current.pending.filter((c) => c.字段[1] === 'ghost')).toHaveLength(0);
  });
});

describe('v6.2.1 · 表单外的成员维护路径不回归', () => {
  it('编辑已有记录的成员关系（toggleRecordInPlan）后，本地缓存随 effect 落盘', async () => {
    const { result } = setup([makeRecord({ id: 1 })], [makePlan('p1', '2026 春季', [])]);

    act(() => {
      result.current.actions.toggleRecordInPlan('p1', 1);
    });
    expect(result.current.plans[0].记录ID列表).toEqual([1]);

    // 等待持久化 effect（writeCache 监听 plans 变化）
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const cached = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.cache) || '{}');
    expect(cached.plans?.[0]?.记录ID列表).toEqual([1]);
  });

  it('设置页重命名清单后，表单与详情页读取的是同一份 store 数据', async () => {
    const { result } = setup([makeRecord({ id: 1 })], [makePlan('p1', '2026 春季', [1])]);

    act(() => {
      result.current.actions.renamePlanList('p1', '2026 春夏');
    });
    expect(result.current.plans[0].名称).toBe('2026 春夏');
    expect(result.current.plans[0].记录ID列表).toEqual([1]);
    expect(result.current.plans[0].更新时间 !== '2026-11-01T00:00:00.000Z').toBe(true);
  });
});
