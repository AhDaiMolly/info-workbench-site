/**
 * v6.7 · 计划清单总览页（数据层）
 *
 * 行为合同：
 *   1. reorderPlans：清单之间拖拽重排 —— 集合不变才生效，顺序未变是 no-op（同一引用）；
 *   2. reorderPlanMembers：清单内成员拖拽重排 —— 成员集合不变才生效，顺序未变是 no-op；
 *   3. 顺序是数据：plansEqual 顺序敏感，同步会把顺序变更写回；
 *   4. 三方合并保留顺序：本地动过顺序 → 本地顺序；本地没动 → 采纳远端顺序。
 */

import { describe, expect, it } from 'vitest';
import {
  addRecordToPlan, planPlansSync, plansEqual, reorderPlanMembers, reorderPlans,
} from '../store/plans';
import type { PlanItem } from '../types';

function mkPlan(id: string, name: string, members: number[] = []): PlanItem {
  return {
    id, 名称: name, 记录ID列表: members,
    创建时间: '2026-11-01T00:00:00.000Z', 更新时间: '2026-11-01T00:00:00.000Z',
  };
}

describe('v6.7 · 清单之间的拖拽重排（reorderPlans）', () => {
  it('顺序变更生效：按传入的 id 序列重排', () => {
    const plans = [mkPlan('p1', 'A'), mkPlan('p2', 'B'), mkPlan('p3', 'C')];
    const next = reorderPlans(plans, ['p3', 'p1', 'p2']);
    expect(next.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
    expect(next.map((p) => p.名称)).toEqual(['C', 'A', 'B']);
    // 原始数组不被就地修改
    expect(plans.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('顺序未变 → no-op（返回同一引用，避免触发一次同步）', () => {
    const plans = [mkPlan('p1', 'A'), mkPlan('p2', 'B')];
    expect(reorderPlans(plans, ['p1', 'p2'])).toBe(plans);
  });

  it('id 集合不一致（漏传 / 多传 / 陌生 id）→ 原样返回，不做半截重排', () => {
    const plans = [mkPlan('p1', 'A'), mkPlan('p2', 'B')];
    expect(reorderPlans(plans, ['p1'])).toBe(plans);
    expect(reorderPlans(plans, ['p1', 'p2', 'p3'])).toBe(plans);
    expect(reorderPlans(plans, ['p1', 'pX'])).toBe(plans);
    expect(reorderPlans(plans, [])).toBe(plans);
  });
});

describe('v6.7 · 清单内成员的拖拽重排（reorderPlanMembers）', () => {
  it('顺序变更生效：成员数组按传入顺序重排并刷新更新时间', () => {
    const plans = [mkPlan('p1', 'A', [1, 2, 3])];
    const next = reorderPlanMembers(plans, 'p1', [3, 1, 2]);
    expect(next[0].记录ID列表).toEqual([3, 1, 2]);
    expect(next[0].更新时间 >= plans[0].更新时间).toBe(true);
    expect(plans[0].记录ID列表).toEqual([1, 2, 3]);
  });

  it('顺序未变 → no-op（同一引用）', () => {
    const plans = [mkPlan('p1', 'A', [1, 2])];
    expect(reorderPlanMembers(plans, 'p1', [1, 2])).toBe(plans);
  });

  it('成员集合不一致（增删成员不是重排）→ 原样返回', () => {
    const plans = [mkPlan('p1', 'A', [1, 2])];
    expect(reorderPlanMembers(plans, 'p1', [2, 1, 3])).toBe(plans);
    expect(reorderPlanMembers(plans, 'p1', [2])).toBe(plans);
    expect(reorderPlanMembers(plans, 'p404', [1, 2])).toBe(plans);
  });
});

describe('v6.7 · 顺序即数据：比对与合并', () => {
  it('plansEqual：仅顺序不同即视为不同（同步会写回）', () => {
    const a = [mkPlan('p1', 'A'), mkPlan('p2', 'B')];
    const b = [mkPlan('p2', 'B'), mkPlan('p1', 'A')];
    expect(plansEqual(a, b)).toBe(false);
    expect(plansEqual(a, [mkPlan('p1', 'A'), mkPlan('p2', 'B')])).toBe(true);
  });

  it('三方合并：本地动过清单顺序 → 保留本地顺序', () => {
    const baseline = [mkPlan('p1', 'A'), mkPlan('p2', 'B')];
    const local = reorderPlans(baseline, ['p2', 'p1']);
    const remote = baseline;
    const merged = planPlansSync({ local, remote, baseline, pending: [] });
    expect(merged.plans.map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('三方合并：本地没动顺序 → 采纳远端顺序（其他设备重排能同步过来）', () => {
    const baseline = [mkPlan('p1', 'A'), mkPlan('p2', 'B')];
    const local = baseline;
    const remote = reorderPlans(baseline, ['p2', 'p1']);
    const merged = planPlansSync({ local, remote, baseline, pending: [] });
    expect(merged.plans.map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('三方合并：成员顺序变更按字段级合并 —— 本地改顺序、远端改成员 → 冲突上报并保留本地', () => {
    const baseline = [mkPlan('p1', 'A', [1, 2])];
    const local = reorderPlanMembers(baseline, 'p1', [2, 1]);
    const remote = addRecordToPlan(baseline, 'p1', 3);
    const merged = planPlansSync({ local, remote, baseline, pending: [] });
    expect(merged.conflicts.length).toBeGreaterThan(0);
    expect(merged.plans[0].记录ID列表).toEqual([2, 1]);
  });

  it('无基线重建：本地顺序优先，远端新增清单追加在尾部', () => {
    const local = [mkPlan('p2', 'B'), mkPlan('p1', 'A')];
    const remote = [mkPlan('p1', 'A'), mkPlan('p9', '远端新')];
    // 无基线时以「待同步队列」判定归属：p2 动过 → 本地保留
    const pending = [{
      id: 'p2-x1', 记录ID: 0, 动作: '编辑' as const, 字段: ['计划清单', 'p2'], 时间: '2026-11-02T00:00:00.000Z',
    }];
    const merged = planPlansSync({ local, remote, baseline: null, pending });
    expect(merged.baselineMode).toBe('reconstructed');
    expect(merged.plans.map((p) => p.id)).toEqual(['p2', 'p1', 'p9']);
  });
});
