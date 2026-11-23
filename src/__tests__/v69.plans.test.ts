/**
 * v6.9 · 计划清单纯函数（需求 2 / 需求 5）
 *
 *   · addRecordsToPlan：挑选页批量加入 —— 已在清单里的自动跳过、尾部追加、no-op 返回同一引用；
 *   · moveRecordToPlan：迁移语义 —— 加入目标清单并从当前清单移出、单次引用变更。
 */

import { describe, expect, it } from 'vitest';
import { addRecordsToPlan, moveRecordToPlan, plansEqual } from '../store/plans';
import type { PlanItem } from '../types';

function plan(id: string, name: string, members: number[]): PlanItem {
  return {
    id, 名称: name, 记录ID列表: members,
    创建时间: '2026-11-01T00:00:00.000Z', 更新时间: '2026-11-01T00:00:00.000Z',
  };
}

describe('v6.9（需求 2）· addRecordsToPlan：批量加入清单', () => {
  it('批量加入：新记录尾部追加，保留既有成员顺序', () => {
    const base = [plan('p1', '春季', [1, 2]), plan('p2', '夏季', [5])];
    const out = addRecordsToPlan(base, 'p1', [7, 3]);
    expect(out[0].记录ID列表).toEqual([1, 2, 7, 3]);
    expect(out[1]).toBe(base[1]); // 其它清单引用不变
  });

  it('已在清单里的记录自动跳过（不重复加入）', () => {
    const base = [plan('p1', '春季', [1, 2])];
    const out = addRecordsToPlan(base, 'p1', [2, 9]);
    expect(out[0].记录ID列表).toEqual([1, 2, 9]);
  });

  it('全部已在清单 / 空列表 → 原样返回同一引用（no-op 不产生新状态）', () => {
    const base = [plan('p1', '春季', [1, 2])];
    expect(addRecordsToPlan(base, 'p1', [1, 2])).toBe(base);
    expect(addRecordsToPlan(base, 'p1', [])).toBe(base);
  });

  it('目标清单不存在 → 原样返回同一引用', () => {
    const base = [plan('p1', '春季', [1])];
    expect(addRecordsToPlan(base, 'pX', [2])).toBe(base);
  });

  it('更新时间被刷新，且 plansEqual 判定内容变化（会触发同步写回）', () => {
    const base = [plan('p1', '春季', [1])];
    const out = addRecordsToPlan(base, 'p1', [2]);
    expect(plansEqual(base, out)).toBe(false);
    expect(new Date(out[0].更新时间).getTime()).toBeGreaterThanOrEqual(new Date(base[0].更新时间).getTime());
  });
});

describe('v6.9（需求 5）· moveRecordToPlan：迁移（加入目标并从当前移出）', () => {
  it('迁移语义：记录出现在目标清单尾部，同时从源清单消失', () => {
    const base = [plan('p1', '春季', [1, 2]), plan('p2', '夏季', [5])];
    const out = moveRecordToPlan(base, 'p1', 'p2', 2);
    expect(out[0].记录ID列表).toEqual([1]);
    expect(out[1].记录ID列表).toEqual([5, 2]);
  });

  it('其它清单引用不变；两份清单在单次调用里一起变更', () => {
    const base = [plan('p1', '春季', [1, 2]), plan('p2', '夏季', [5]), plan('p3', '秋', [8])];
    const out = moveRecordToPlan(base, 'p1', 'p2', 2);
    expect(out[2]).toBe(base[2]);
    expect(out[0]).not.toBe(base[0]);
    expect(out[1]).not.toBe(base[1]);
  });

  it('源 = 目标 / 记录不在源清单 / 任一清单不存在 → 原样返回同一引用', () => {
    const base = [plan('p1', '春季', [1, 2]), plan('p2', '夏季', [5])];
    expect(moveRecordToPlan(base, 'p1', 'p1', 1)).toBe(base);
    expect(moveRecordToPlan(base, 'p2', 'p1', 1)).toBe(base); // 1 不在 p2
    expect(moveRecordToPlan(base, 'pX', 'p1', 1)).toBe(base);
    expect(moveRecordToPlan(base, 'p1', 'pX', 1)).toBe(base);
  });

  it('记录已在目标清单（弹层已排除，防御路径）→ 只完成从当前清单移出', () => {
    const base = [plan('p1', '春季', [1, 2]), plan('p2', '夏季', [2])];
    const out = moveRecordToPlan(base, 'p1', 'p2', 2);
    expect(out[0].记录ID列表).toEqual([1]);
    expect(out[1].记录ID列表).toEqual([2]); // 不重复追加
  });
});
