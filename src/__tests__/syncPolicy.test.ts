/**
 * 合并链路回归测试（质检 P0-1 / P1-1 / P1-2 / P1-3）
 *
 * 覆盖验收要求的四个场景：
 *   1. 本地有未同步改动时，启动不丢数据
 *   2. 远端新增记录能合入
 *   3. 远端删除不被复活
 *   4. 字段级冲突能被检出
 *
 * 全部为纯函数测试（node 环境，无 DOM 依赖）。
 */

import { describe, expect, it } from 'vitest';
import { decideAutoPull, hasLocalDivergence, planRemoteSync } from '../store/syncPolicy';
import type { PendingChange } from '../store/persist';
import type { RecordItem } from '../types';

/** 虚构占位数据，站点仓内不得出现真实记录值。 */
function makeRecord(over: Partial<RecordItem> & { id: number }): RecordItem {
  const { id, ...rest } = over;
  return {
    id,
    名称: `记录-${over.id}`,
    品牌: '品牌甲',
    分类: [],
    款式: '',
    季节: '',
    教程: '未知',
    拥有形态: [],
    电子版尺码: [],
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

function pendingChange(记录ID: number, 动作: PendingChange['动作'] = '编辑'): PendingChange {
  return {
    id: `${记录ID}-1700000000000`,
    记录ID,
    动作,
    字段: ['备注'],
    时间: '2026-01-02T00:00:00.000Z',
  };
}

/** 基线：两条记录 */
const baseline: RecordItem[] = [
  makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '基线备注', 季节: '夏' }),
  makeRecord({ id: 2, 名称: '款式二', 品牌: '品牌乙', 备注: '另一条' }),
];

/* ------------------- 场景 1：本地有未同步改动时启动不丢数据 ------------------- */

describe('P0-1 · 启动时的自动拉取守卫', () => {
  it('待同步队列非空 → 禁止启动时自动拉取，并给出引导文案', () => {
    const decision = decideAutoPull({
      local: baseline,
      baseline,
      pendingCount: 2,
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('pending-not-empty');
    expect(decision.message).toContain('2 处未同步');
    expect(decision.message).toContain('暂停');
  });

  it('待同步队列为空且本地与基线一致 → 允许自动拉取', () => {
    const decision = decideAutoPull({ local: baseline, baseline, pendingCount: 0 });
    expect(decision.allow).toBe(true);
    expect(decision.reason).toBeNull();
    expect(decision.message).toBeNull();
  });

  it('队列为空但本地已偏离基线 → 仍然禁止自动拉取', () => {
    const local = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地改过', 季节: '夏' }), baseline[1]];
    const decision = decideAutoPull({ local, baseline, pendingCount: 0 });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('local-diverged');
  });

  it('hasLocalDivergence：队列非空即视为有偏离', () => {
    expect(hasLocalDivergence({ local: baseline, baseline, pendingCount: 1 })).toBe(true);
    expect(hasLocalDivergence({ local: baseline, baseline, pendingCount: 0 })).toBe(false);
  });

  it('本地有未同步改动时，拉取远端不会丢掉本地改动', () => {
    const local = [
      makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地未同步的改动', 季节: '夏' }),
      baseline[1],
    ];
    const plan = planRemoteSync({
      local,
      remote: baseline,
      baseline,
      pending: [pendingChange(1)],
    });
    // 本地改动必须还在结果里
    expect(plan.records.find((r) => r.id === 1)?.备注).toBe('本地未同步的改动');
    // 且不能被判成冲突（远端没动同一字段）
    expect(plan.conflicts.length).toBe(0);
  });
});

/* ---------------------- 场景 2：远端新增记录能合入 ---------------------- */

describe('P1-2 · 远端新增记录合入本地', () => {
  it('基线里有、本地与远端都没有的远端新增记录 → 合入并记入 addedFromRemote', () => {
    const remote = [...baseline, makeRecord({ id: 3, 名称: '远端新增' })];
    const plan = planRemoteSync({
      local: baseline,
      remote,
      baseline,
      pending: [],
    });
    expect(plan.records.some((r) => r.id === 3)).toBe(true);
    expect(plan.addedFromRemote).toContain(3);
    // 本地本来就没有未同步改动 → 合并结果与远端一致，可直接采用（fast-forward）
    expect(plan.kind).toBe('fast-forward');
  });

  it('远端新增 + 本地也有未同步改动 → 两者同时保留', () => {
    const local = [
      makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地改动', 季节: '夏' }),
      baseline[1],
    ];
    const remote = [...baseline, makeRecord({ id: 3, 名称: '远端新增' })];
    const plan = planRemoteSync({
      local,
      remote,
      baseline,
      pending: [pendingChange(1)],
    });
    expect(plan.records.some((r) => r.id === 3)).toBe(true);
    expect(plan.records.find((r) => r.id === 1)?.备注).toBe('本地改动');
    expect(plan.conflicts.length).toBe(0);
  });
});

/* ---------------------- 场景 3：远端删除不被复活 ---------------------- */

describe('P1-3 · 远端已删记录不被写回复活', () => {
  it('远端删了、本地没改 → 跟随删除，不复活', () => {
    const remote = [baseline[0]]; // id=2 被远端删除
    const plan = planRemoteSync({
      local: baseline,
      remote,
      baseline,
      pending: [],
    });
    expect(plan.records.some((r) => r.id === 2)).toBe(false);
    expect(plan.removedByRemote).toContain(2);
  });

  it('远端删了、本地改过 → 报冲突，由用户裁决', () => {
    const local = [
      baseline[0],
      makeRecord({ id: 2, 名称: '款式二', 品牌: '品牌乙', 备注: '本地改过' }),
    ];
    const plan = planRemoteSync({
      local,
      remote: [baseline[0]],
      baseline,
      pending: [pendingChange(2)],
    });
    expect(plan.kind).toBe('conflict');
    expect(plan.conflicts.some((c) => c.记录ID === 2)).toBe(true);
  });
});

/* ---------------------- 场景 4：字段级冲突能被检出 ---------------------- */

describe('P1-1 · 字段级冲突检出', () => {
  it('本地与远端改了同一字段 → 检出冲突，并给出基线值', () => {
    const local = [
      makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地改', 季节: '夏' }),
      baseline[1],
    ];
    const remote = [
      makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '远端改', 季节: '夏' }),
      baseline[1],
    ];
    const plan = planRemoteSync({
      local,
      remote,
      baseline,
      pending: [pendingChange(1)],
    });
    expect(plan.kind).toBe('conflict');
    expect(plan.conflicts.length).toBe(1);
    expect(plan.conflicts[0].字段).toBe('备注');
    expect(plan.conflicts[0].基线值).toBe('基线备注');
    expect(plan.conflicts[0].一侧值).toBe('本地改');
    expect(plan.conflicts[0].另一侧值).toBe('远端改');
  });

  it('本地与远端改的是不同字段 → 自动合并，不报冲突', () => {
    const local = [
      makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地改', 季节: '夏' }),
      baseline[1],
    ];
    const remote = [
      makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '基线备注', 季节: '冬' }),
      baseline[1],
    ];
    const plan = planRemoteSync({
      local,
      remote,
      baseline,
      pending: [pendingChange(1)],
    });
    expect(plan.kind).toBe('merge');
    expect(plan.conflicts.length).toBe(0);
    expect(plan.records[0].备注).toBe('本地改');
    expect(plan.records[0].季节).toBe('冬');
  });

  it('用「本地当前值」当基线时冲突检测恒空 —— 这正是 P1-1 的缺陷，不得复现', () => {
    const local = [
      makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地改', 季节: '夏' }),
      baseline[1],
    ];
    const remote = [
      makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '远端改', 季节: '夏' }),
      baseline[1],
    ];
    // 错误基线：把本地当前值当基线 → localChanged 恒为 false → 冲突检测恒空
    const wrong = planRemoteSync({ local, remote, baseline: local, pending: [pendingChange(1)] });
    expect(wrong.conflicts.length).toBe(0);
    // 正确基线：持久化基线快照 → 冲突被检出
    const right = planRemoteSync({ local, remote, baseline, pending: [pendingChange(1)] });
    expect(right.conflicts.length).toBe(1);
  });
});

/* ------------------ 其它：fast-forward 与基线缺失兜底 ------------------ */

describe('同步计划 · fast-forward 与基线缺失兜底', () => {
  it('本地与远端完全一致 → fast-forward（基线可前移）', () => {
    const plan = planRemoteSync({
      local: baseline,
      remote: baseline,
      baseline,
      pending: [],
    });
    expect(plan.kind).toBe('fast-forward');
    expect(plan.conflicts.length).toBe(0);
  });

  it('无基线快照且无待同步改动 → 以远端为准', () => {
    const remote = [...baseline, makeRecord({ id: 3, 名称: '远端新增' })];
    const plan = planRemoteSync({
      local: baseline,
      remote,
      baseline: null,
      pending: [],
    });
    expect(plan.kind).toBe('fast-forward');
    expect(plan.baselineMode).toBe('reconstructed');
    expect(plan.records.some((r) => r.id === 3)).toBe(true);
  });

  it('无基线快照但本地有未同步改动 → 差异暴露成冲突，不静默覆盖', () => {
    const local = [
      makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地改', 季节: '夏' }),
      baseline[1],
    ];
    const remote = [
      makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '远端改', 季节: '夏' }),
      baseline[1],
    ];
    const plan = planRemoteSync({
      local,
      remote,
      baseline: null,
      pending: [pendingChange(1)],
    });
    expect(plan.kind).toBe('conflict');
    expect(plan.conflicts.length).toBe(1);
  });

  it('无基线快照、本地新增的记录 → 保留本地，不丢', () => {
    const local = [...baseline, makeRecord({ id: 7, 名称: '本地新增' })];
    const plan = planRemoteSync({
      local,
      remote: baseline,
      baseline: null,
      pending: [pendingChange(7, '新增')],
    });
    expect(plan.records.some((r) => r.id === 7)).toBe(true);
    expect(plan.addedFromLocal).toContain(7);
  });
});
