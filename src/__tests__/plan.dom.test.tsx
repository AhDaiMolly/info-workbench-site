/**
 * v6.6 · 需求 1 清单管理视图（真实 store，jsdom）
 *
 * 行为合同：
 *   · 进入 #/plan/<id> 对应视图：展示该清单当前全部记录；
 *   · 「加入清单」把不在清单里的记录加进来，只改清单成员关系（records 一条不动）；
 *   · 「移除出清单」把记录拿出清单，记录本身仍在 records 里；
 *   · 文案明确「移除出清单」而非「删除」；
 *   · 清单不存在时给出兜底提示，不白屏。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { AppProvider, useApp } from '../store/store';
import { STORAGE_KEYS } from '../store/persist';
import { DEFAULT_SCHEMA } from '../schema';
import { PlanView } from '../features/plan/PlanView';
import type { PlanItem, RecordItem } from '../types';

function makeRecord(over: Partial<RecordItem> & { id: number }): RecordItem {
  const { id, ...rest } = over;
  return {
    id,
    名称: `记录-${id}`,
    品牌: `品牌${id}`,
    分类: ['连衣裙'],
    款式: '外套',
    季节: '夏',
    教程: '未知',
    电子版尺码: [],
    拥有形态: ['电子版'],
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
    plansBaseSha: 'sha-stub',
    plansDataVersion: 1,
  }));
}

const records = [
  makeRecord({ id: 1, 名称: '碎花裙-记录' }),
  makeRecord({ id: 2, 名称: '打底衣-记录' }),
  makeRecord({ id: 3, 名称: '西装外套-记录' }),
];

/** 真实 store 里的当前清单（用于断言成员关系） */
function currentPlans(): PlanItem[] {
  let out: PlanItem[] = [];
  const Probe = () => {
    const app = useApp();
    out = app.plans;
    return null;
  };
  render(<AppProvider><Probe /></AppProvider>).unmount();
  return out;
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

describe('v6.6（需求 1）：清单管理视图', () => {
  it('展示清单标题与当前全部记录，文案强调「只调整成员关系」', () => {
    seedCache(records, [makePlan('p1', '2026春季', [1, 3])]);
    render(<AppProvider><PlanView planId="p1" /></AppProvider>);
    expect(screen.getByTestId('iw-plan-title').textContent).toContain('2026春季');
    expect(screen.getByTestId('iw-plan-member-1')).toBeTruthy();
    expect(screen.getByTestId('iw-plan-member-3')).toBeTruthy();
    expect(screen.queryByTestId('iw-plan-member-2')).toBeNull();
    const sub = document.querySelector('.iw-page-sub')?.textContent ?? '';
    expect(sub).toContain('只调整清单成员关系');
  });

  it('「移除出清单」：只改成员关系，记录本身不动', () => {
    seedCache(records, [makePlan('p1', '2026春季', [1, 3])]);
    const { container } = render(<AppProvider><PlanView planId="p1" /></AppProvider>);
    fireEvent.click(screen.getByTestId('iw-plan-remove-1'));
    // 成员 1 已从清单消失
    expect(screen.queryByTestId('iw-plan-member-1')).toBeNull();
    expect(screen.getByTestId('iw-plan-member-3')).toBeTruthy();
    // 记录本身没被动过
    const stateAfter = currentPlans();
    expect(stateAfter[0].记录ID列表).toEqual([3]);
    const cache = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.cache) ?? '{}');
    expect(cache.records.length).toBe(3);
    expect(cache.records.some((r: { id: number }) => r.id === 1)).toBe(true);
    expect(screen.getByText(/记录本身仍在/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/删除记录/);
  });

  it('「加入清单」：从候选列表添加记录（支持搜索定位）', () => {
    seedCache(records, [makePlan('p1', '2026春季', [1])]);
    render(<AppProvider><PlanView planId="p1" /></AppProvider>);
    // 候选不含已在清单里的 1
    expect(screen.queryByTestId('iw-plan-candidate-1')).toBeNull();
    expect(screen.getByTestId('iw-plan-candidate-2')).toBeTruthy();
    // 搜索「西装」精确定位到 3
    fireEvent.change(screen.getByTestId('iw-plan-add-search'), { target: { value: '西装' } });
    expect(screen.queryByTestId('iw-plan-candidate-2')).toBeNull();
    expect(screen.getByTestId('iw-plan-candidate-3')).toBeTruthy();
    fireEvent.click(screen.getByTestId('iw-plan-add-3'));
    expect(screen.getByTestId('iw-plan-member-3')).toBeTruthy();
    expect(screen.queryByTestId('iw-plan-candidate-3')).toBeNull();
    expect(currentPlans()[0].记录ID列表).toEqual([1, 3]);
  });

  it('支持按 #编号 搜索候选', () => {
    seedCache(records, [makePlan('p1', '2026春季', [])]);
    render(<AppProvider><PlanView planId="p1" /></AppProvider>);
    fireEvent.change(screen.getByTestId('iw-plan-add-search'), { target: { value: '#2' } });
    expect(screen.queryByTestId('iw-plan-candidate-1')).toBeNull();
    expect(screen.getByTestId('iw-plan-candidate-2')).toBeTruthy();
  });

  it('清单为空时给出引导文案；清单不存在时兜底不白屏', () => {
    seedCache(records, [makePlan('p1', '2026春季', [])]);
    const { rerender } = render(<AppProvider><PlanView planId="p1" /></AppProvider>);
    expect(screen.getByTestId('iw-plan-members-empty').textContent).toContain('还没有记录');
    rerender(<AppProvider><PlanView planId="p9" /></AppProvider>);
    expect(screen.getByTestId('iw-plan-notfound')).toBeTruthy();
    expect(screen.getByTestId('iw-plan-notfound').textContent).toContain('找不到这份清单');
  });

  it('候选全在清单里时提示「都已经在清单里」', () => {
    seedCache([records[0]], [makePlan('p1', '2026春季', [1])]);
    render(<AppProvider><PlanView planId="p1" /></AppProvider>);
    expect(screen.getByTestId('iw-plan-add-empty').textContent).toContain('都已经在这份清单里');
  });
});
