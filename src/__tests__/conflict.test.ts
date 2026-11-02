import { describe, expect, it } from 'vitest';
import { diffRecords, hasContentDiff, threeWayMerge } from '../sync/conflict';
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
    拥有电子版: false,
    电子版尺码组: [],
    电子版缺码: false,
    拥有纸质版: false,
    纸质版尺码: [],
    推荐: '未评价',
    做过: false,
    想做: '未标记',
    关联: [],
    备注: '',
    创建时间: '2026-01-01T00:00:00.000Z',
    更新时间: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...rest,
  } as RecordItem;
}

const base: RecordItem[] = [
  makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '基线备注', 季节: '夏' }),
  makeRecord({ id: 2, 名称: '款式二', 品牌: '品牌乙', 备注: '保持不变' }),
];

describe('差异计算', () => {
  it('列出变化字段', () => {
    const right = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '改过了', 季节: '夏' })];
    const diffs = diffRecords(base, right);
    expect(diffs.length).toBe(1);
    expect(diffs[0].字段).toBe('备注');
    expect(diffs[0].一侧值).toBe('基线备注');
    expect(diffs[0].另一侧值).toBe('改过了');
  });

  it('远端多出的记录标记为新增', () => {
    const right = [...base, makeRecord({ id: 3, 名称: '新增项' })];
    const diffs = diffRecords(base, right);
    expect(diffs.some((d) => d.字段 === '（新增记录）' && d.记录ID === 3)).toBe(true);
  });
});

describe('三方合并', () => {
  it('只有本地改动 → 取本地', () => {
    const local = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地改', 季节: '夏' }), base[1]];
    const res = threeWayMerge(base, local, base);
    expect(res.conflicts.length).toBe(0);
    expect(res.merged[0].备注).toBe('本地改');
    expect(res.autoMerged).toBe(1);
  });

  it('只有远端改动 → 取远端', () => {
    const remote = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '远端改', 季节: '夏' }), base[1]];
    const res = threeWayMerge(base, base, remote);
    expect(res.conflicts.length).toBe(0);
    expect(res.merged[0].备注).toBe('远端改');
  });

  it('双方改了不同字段 → 自动合并，无冲突', () => {
    // 本地改「备注」，远端改「季节」——字段不重叠，可自动合并
    const local = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地改', 季节: '夏' }), base[1]];
    const remote = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '基线备注', 季节: '冬' }), base[1]];
    const res = threeWayMerge(base, local, remote);
    expect(res.conflicts.length).toBe(0);
    expect(res.merged[0].备注).toBe('本地改');
    expect(res.merged[0].季节).toBe('冬');
    expect(res.autoMerged).toBe(2);
  });

  it('合并不会改写传入的 base / local 记录对象', () => {
    const local = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地改', 季节: '夏' }), base[1]];
    const remote = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '基线备注', 季节: '冬' }), base[1]];
    threeWayMerge(base, local, remote);
    expect(base[0].备注).toBe('基线备注');
    expect(base[0].季节).toBe('夏');
    expect(local[0].季节).toBe('夏');
  });

  it('双方改了同一字段且取值不同 → 真冲突', () => {
    const local = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地改', 季节: '夏' }), base[1]];
    const remote = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '远端改', 季节: '夏' }), base[1]];
    const res = threeWayMerge(base, local, remote);
    expect(res.conflicts.length).toBe(1);
    expect(res.conflicts[0].字段).toBe('备注');
    expect(res.conflicts[0].基线值).toBe('基线备注');
    expect(res.conflicts[0].一侧值).toBe('本地改');
    expect(res.conflicts[0].另一侧值).toBe('远端改');
  });

  it('双方改成相同取值 → 不算冲突', () => {
    const same = '一样的值';
    const local = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: same, 季节: '夏' }), base[1]];
    const remote = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: same, 季节: '夏' }), base[1]];
    const res = threeWayMerge(base, local, remote);
    expect(res.conflicts.length).toBe(0);
  });

  it('本地新增的记录在远端不存在时保留', () => {
    const local = [...base, makeRecord({ id: 3, 名称: '本地新增' })];
    const res = threeWayMerge(base, local, base);
    expect(res.merged.some((r) => r.id === 3)).toBe(true);
  });

  it('远端独有的记录会合入本地（质检 P1-2：不得丢弃远端新增）', () => {
    const remote = [...base, makeRecord({ id: 4, 名称: '远端独有' })];
    const res = threeWayMerge(base, base, remote);
    expect(res.merged.some((r) => r.id === 4)).toBe(true);
    expect(res.addedFromRemote).toContain(4);
  });

  it('远端已删、本地未改动的记录不被复活（质检 P1-3）', () => {
    const local = [...base];
    const remote = [base[0]]; // 远端删掉了 id=2
    const res = threeWayMerge(base, local, remote);
    expect(res.merged.some((r) => r.id === 2)).toBe(false);
    expect(res.removedByRemote).toContain(2);
  });

  it('远端已删、本地改动过 → 报冲突而不是静默丢弃（质检 P1-3）', () => {
    const local = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '基线备注', 季节: '夏' }),
      makeRecord({ id: 2, 名称: '款式二', 品牌: '品牌乙', 备注: '本地改过' })];
    const remote = [base[0]];
    const res = threeWayMerge(base, local, remote);
    expect(res.conflicts.some((c) => c.记录ID === 2 && c.字段 === '（记录删除）')).toBe(true);
    expect(res.merged.some((r) => r.id === 2)).toBe(true);
  });

  it('双方都改了同一字段 → 合并结果保留本地值并报冲突（质检 P1-1）', () => {
    const local = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '本地改', 季节: '夏' }), base[1]];
    const remote = [makeRecord({ id: 1, 名称: '款式一', 品牌: '品牌甲', 备注: '远端改', 季节: '夏' }), base[1]];
    const res = threeWayMerge(base, local, remote);
    expect(res.conflicts.length).toBe(1);
    expect(res.conflicts[0].基线值).toBe('基线备注');
    expect(res.merged[0].备注).toBe('本地改');
  });
});

describe('内容一致性判断（AC-7 未改动不产生新版本）', () => {
  it('完全一致返回 false', () => {
    expect(hasContentDiff(base, base)).toBe(false);
  });

  it('字段不同返回 true', () => {
    const other = [makeRecord({ id: 1, 名称: '改了', 品牌: '品牌甲', 备注: '基线备注', 季节: '夏' }), base[1]];
    expect(hasContentDiff(base, other)).toBe(true);
  });

  it('删除状态不同返回 true', () => {
    const deleted = [{ ...base[0], deletedAt: '2026-05-01T00:00:00.000Z' }, base[1]];
    expect(hasContentDiff(base, deleted)).toBe(true);
  });

  it('条数不同返回 true', () => {
    expect(hasContentDiff(base, [...base, makeRecord({ id: 9 })])).toBe(true);
  });
});
