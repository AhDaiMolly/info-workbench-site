import { describe, expect, it } from 'vitest';
import {
  PLANS_SCHEMA_VERSION, addRecordToPlan, buildPlanMembers, createPlan, deletePlan,
  makePlansFile, nextPlanId, normalizePlans, parsePlansFile, planPlansSync, plansEqual,
  plansHaveContent, prunePlanMembers, removeRecordFromPlan, renamePlan, touchedPlanIds,
} from '../store/plans';
import type { PlanItem } from '../types';
import type { PendingChange } from '../store/persist';

function mkPlan(id: string, name: string, members: number[] = [], 创建时间 = '2026-11-01T00:00:00.000Z'): PlanItem {
  return { id, 名称: name, 记录ID列表: members, 创建时间, 更新时间: 创建时间 };
}

function mkPending(planId: string): PendingChange {
  return {
    id: `${planId}-x1`,
    记录ID: 0,
    动作: '编辑',
    字段: ['计划清单', planId],
    时间: '2026-11-02T00:00:00.000Z',
  };
}

describe('v6.2 · 计划清单：增删改（纯函数）', () => {
  it('创建清单：生成 p1/p2… 确定性 ID，空名拒绝', () => {
    expect(createPlan([], '  ')).toBeNull();
    const first = createPlan([], '2026 春季');
    expect(first?.plan.id).toBe('p1');
    expect(first?.plan.名称).toBe('2026 春季');
    expect(first?.plan.记录ID列表).toEqual([]);
    expect(first?.plans).toHaveLength(1);

    const second = createPlan(first!.plans, '给宝宝做的');
    expect(second?.plan.id).toBe('p2');
    expect(second?.plans).toHaveLength(2);
  });

  it('nextPlanId 只认 p<N> 形态，其他前缀不干扰', () => {
    expect(nextPlanId([mkPlan('plan9', 'a'), mkPlan('p3', 'b')])).toBe('p4');
    expect(nextPlanId([mkPlan('x', 'a'), mkPlan('y', 'b')])).toBe('p1');
  });

  it('重命名：改名生效且更新时间刷新；清单不存在/空名 → 原样', () => {
    const plans = [mkPlan('p1', '旧名')];
    const renamed = renamePlan(plans, 'p1', ' 新名 ');
    expect(renamed[0].名称).toBe('新名');
    expect(renamed[0].更新时间 >= plans[0].更新时间).toBe(true);
    expect(renamePlan(plans, 'p404', 'x')).toBe(plans);
    expect(renamePlan(plans, 'p1', '  ')).toBe(plans);
  });

  it('删除清单：清单消失、记录不受影响（记录数据不在清单侧）', () => {
    const plans = [mkPlan('p1', 'A', [1, 2]), mkPlan('p2', 'B')];
    const next = deletePlan(plans, 'p1');
    expect(next.map((p) => p.id)).toEqual(['p2']);
    expect(deletePlan(plans, 'p404')).toHaveLength(2);
  });
});

describe('v6.2 · 记录加入/移出清单', () => {
  it('加入：成员排序去重；重复加入不产生新引用；清单不存在原样返回', () => {
    const plans = [mkPlan('p1', 'A', [5, 3])];
    const next = addRecordToPlan(plans, 'p1', 4);
    expect(next[0].记录ID列表).toEqual([3, 4, 5]);
    expect(addRecordToPlan(next, 'p1', 4)).toBe(next);
    expect(addRecordToPlan(plans, 'p404', 4)).toBe(plans);
  });

  it('移出：只移除目标成员；不在清单里 → 原样', () => {
    const plans = [mkPlan('p1', 'A', [3, 4, 5]), mkPlan('p2', 'B', [4])];
    const next = removeRecordFromPlan(plans, 'p1', 4);
    expect(next[0].记录ID列表).toEqual([3, 5]);
    expect(next[1].记录ID列表).toEqual([4]);
    expect(removeRecordFromPlan(plans, 'p1', 99)).toBe(plans);
  });

  it('prunePlanMembers：记录删除后清理成员引用；无需清理返回 null', () => {
    const plans = [mkPlan('p1', 'A', [1, 2]), mkPlan('p2', 'B', [2])];
    const next = prunePlanMembers(plans, [2]);
    expect(next?.[0].记录ID列表).toEqual([1]);
    expect(next?.[1].记录ID列表).toEqual([]);
    expect(prunePlanMembers(plans, [99])).toBeNull();
  });

  it('buildPlanMembers：记录 ID → 清单 ID 集合', () => {
    const plans = [mkPlan('p1', 'A', [1, 2]), mkPlan('p2', 'B', [2])];
    const members = buildPlanMembers(plans);
    expect(members.get(1)).toEqual(new Set(['p1']));
    expect(members.get(2)).toEqual(new Set(['p1', 'p2']));
    expect(members.get(3)).toBeUndefined();
  });
});

describe('v6.2 · plans 数据读写（结构归一与文件格式）', () => {
  it('parsePlansFile：正常 JSON 解析；坏 JSON / 坏结构回退空清单不抛错', () => {
    const file = makePlansFile([mkPlan('p1', 'A', [1])], 3);
    const parsed = parsePlansFile(JSON.stringify(file));
    expect(parsed.plans).toHaveLength(1);
    expect(parsed.dataVersion).toBe(3);

    expect(parsePlansFile('{oops').plans).toEqual([]);
    expect(parsePlansFile('null').plans).toEqual([]);
    expect(parsePlansFile(JSON.stringify({ plans: [{ id: '', 名称: 'x' }, { id: 'p1' }, 'junk'] })).plans).toEqual([]);
    expect(parsePlansFile(JSON.stringify({ plans: [{ id: 'p1', 名称: 'A' }, { id: 'p1', 名称: 'B' }] })).plans).toHaveLength(1);
  });

  it('makePlansFile：结构完整（schemaVersion / dataVersion / totalCount）', () => {
    const file = makePlansFile([mkPlan('p1', 'A')], 0);
    expect(file.schemaVersion).toBe(PLANS_SCHEMA_VERSION);
    expect(file.dataVersion).toBe(1);
    expect(file.totalCount).toBe(1);
    expect(file.updatedAt).toBeTruthy();
  });

  it('normalizePlans：非法成员过滤、去重、按创建时间稳定排序', () => {
    const out = normalizePlans([
      { id: 'p2', 名称: 'B', 记录ID列表: [2, 2, 'x', 0, -1, 3], 创建时间: '2026-11-02T00:00:00.000Z' },
      { id: 'p1', 名称: 'A', 创建时间: '2026-11-01T00:00:00.000Z' },
      { id: 'p1', 名称: 'dup', 创建时间: '2026-11-01T00:00:00.000Z' },
    ]);
    expect(out.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(out[0].名称).toBe('A');
    expect(out[1].记录ID列表).toEqual([2, 3]);
  });

  it('plansEqual：顺序无关按 id 对齐；plansHaveContent', () => {
    expect(plansEqual([mkPlan('p1', 'A', [1])], [mkPlan('p1', 'A', [1])])).toBe(true);
    expect(plansEqual([mkPlan('p1', 'A', [1])], [mkPlan('p1', 'A', [2])])).toBe(false);
    expect(plansEqual([mkPlan('p1', 'A')], [mkPlan('p2', 'A')])).toBe(false);
    expect(plansEqual([], [])).toBe(true);
    expect(plansHaveContent([mkPlan('p1', 'A')])).toBe(true);
    expect(plansHaveContent([])).toBe(false);
  });
});

describe('v6.2 · plans 三方合并（有基线）', () => {
  it('双方改不同字段 → 字段级合并，两个改动都保留', () => {
    const baseline = [mkPlan('p1', '旧名', [1])];
    const local = [renamePlan(baseline, 'p1', '新名')[0]];
    const remote = [addRecordToPlan(baseline, 'p1', 2)[0]];
    const merged = planPlansSync({ local, remote, baseline, pending: [] });
    expect(merged.baselineMode).toBe('persisted');
    expect(merged.conflicts).toHaveLength(0);
    const out = merged.plans.find((p) => p.id === 'p1')!;
    expect(out.名称).toBe('新名');
    expect(out.记录ID列表).toEqual([1, 2]);
  });

  it('双方改同一字段成不同值 → 保留本地并上报冲突', () => {
    const baseline = [mkPlan('p1', '旧名')];
    const local = [renamePlan(baseline, 'p1', '本地名')[0]];
    const remote = [renamePlan(baseline, 'p1', '远端名')[0]];
    const merged = planPlansSync({ local, remote, baseline, pending: [] });
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0].字段).toBe('名称');
    expect(merged.plans[0].名称).toBe('本地名');
  });

  it('本地新建清单 → 保留并计为 addedFromLocal；远端新建 → 合入并计为 addedFromRemote', () => {
    const empty: PlanItem[] = [];
    const local = [mkPlan('p1', '本地新')];
    const mergedA = planPlansSync({ local, remote: empty, baseline: empty, pending: [] });
    expect(mergedA.plans.map((p) => p.id)).toEqual(['p1']);
    expect(mergedA.addedFromLocal).toEqual(['p1']);

    const remote = [mkPlan('p9', '远端新')];
    const mergedB = planPlansSync({ local: empty, remote, baseline: empty, pending: [] });
    expect(mergedB.plans.map((p) => p.id)).toEqual(['p9']);
    expect(mergedB.addedFromRemote).toEqual(['p9']);
  });

  it('远端删除未改动的清单 → 接受删除；本地改过 → 保留并报冲突', () => {
    const baseline = [mkPlan('p1', 'A'), mkPlan('p2', 'B')];
    // 远端删了 p1 和 p2；本地只改过 p2
    const local = [renamePlan(baseline, 'p2', 'B2').find((p) => p.id === 'p2')!];
    const remote: PlanItem[] = [];
    const merged = planPlansSync({ local, remote, baseline, pending: [] });
    expect(merged.plans.map((p) => p.id)).toEqual(['p2']);
    expect(merged.plans[0].名称).toBe('B2');
    expect(merged.conflicts.some((c) => c.计划ID === 'p2' && c.字段 === '（清单删除）')).toBe(true);
  });
});

describe('v6.2 · plans 合并（无基线：按待同步队列归属重建）', () => {
  it('动过的清单本地优先；没动过的跟随远端（含远端删除）', () => {
    const local = [mkPlan('p1', '本地版', [1]), mkPlan('p2', '本地未动')];
    const remote = [mkPlan('p1', '远端版', [2])];
    const pending = [mkPending('p1')];
    const merged = planPlansSync({ local, remote, baseline: null, pending });
    expect(merged.baselineMode).toBe('reconstructed');
    // p1 动过 → 本地优先（内容不同也直接用本地，不阻断）
    expect(merged.plans.find((p) => p.id === 'p1')?.记录ID列表).toEqual([1]);
    // p2 没动过但远端没有 → 跟随远端删除
    expect(merged.plans.find((p) => p.id === 'p2')).toBeUndefined();
  });

  it('本地删除（动过且本地没有）→ 不复活', () => {
    const remote = [mkPlan('p1', '远端还在')];
    const merged = planPlansSync({ local: [], remote, baseline: null, pending: [mkPending('p1')] });
    expect(merged.plans).toEqual([]);
  });

  it('touchedPlanIds：只认字段[0]=计划清单 且 字段[1] 为非空字符串', () => {
    const pending: PendingChange[] = [
      mkPending('p1'),
      { id: 'r1', 记录ID: 7, 动作: '编辑', 字段: ['名称'], 时间: '2026-11-02T00:00:00.000Z' },
      { id: 'r2', 记录ID: 0, 动作: '编辑', 字段: ['计划清单', ''], 时间: '2026-11-02T00:00:00.000Z' },
    ];
    expect(touchedPlanIds(pending)).toEqual(new Set(['p1']));
  });
});
