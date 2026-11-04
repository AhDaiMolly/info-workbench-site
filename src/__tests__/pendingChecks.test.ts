/**
 * v6.1.1 · 待人工确认清单动态核对规则（store/pendingChecks.ts）
 *
 * 行为合同：
 *   1. 五条核对规则（沿用 v1 迁移工具口径、字段名同步 v6.1 schema）逐条可命中；
 *   2. 用户修复记录后（勾上拥有形态 / 清掉尺码 / 补全名称），对应条目从重算结果中消失；
 *   3. 正常记录不误报；空数据集输出空清单；
 *   4. 条目 key 稳定且唯一（忽略清单按 key 持久化）；
 *   5. 输出按记录 ID 升序，展示顺序稳定。
 */

import { describe, expect, it } from 'vitest';
import { checkKey, checkSummary, computePendingChecks } from '../store/pendingChecks';
import type { RecordItem } from '../types';

function makeRecord(overrides: Partial<RecordItem> & { id: number }): RecordItem {
  return {
    名称: '样本记录',
    品牌: '晨雾',
    分类: ['女装'],
    款式: '外套',
    季节: '春秋',
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
    ...overrides,
  } as RecordItem;
}

describe('v6.1.1 动态核对 · 五条规则逐条命中', () => {
  it('规则 1：拥有形态未勾「电子版」但电子版尺码非空 → 矛盾（v6.1 字段口径措辞）', () => {
    const r = makeRecord({ id: 1, 电子版尺码: ['M', 'L'] });
    const { conflicts, suggestions } = computePendingChecks([r]);
    expect(conflicts).toHaveLength(1);
    expect(suggestions).toHaveLength(0);
    expect(conflicts[0].类型).toBe('勾选与信息矛盾');
    expect(conflicts[0].字段).toBe('电子版尺码');
    expect(conflicts[0].详情).toContain('拥有形态未勾选「电子版」');
    expect(conflicts[0].详情).toContain('M、L');
  });

  it('规则 2：拥有形态未勾「纸质版」但纸质版尺码非空 → 矛盾', () => {
    const r = makeRecord({ id: 2, 纸质版尺码: ['140'] });
    const { conflicts } = computePendingChecks([r]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].字段).toBe('纸质版尺码');
    expect(conflicts[0].详情).toContain('拥有形态未勾选「纸质版」');
  });

  it('规则 3：名称为空 → 关键字段缺失（沿用 v1「编号为空」规则）', () => {
    const r = makeRecord({ id: 3, 名称: '' });
    const { conflicts } = computePendingChecks([r]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].类型).toBe('关键字段缺失');
    expect(conflicts[0].字段).toBe('名称');
  });

  it('规则 4：勾了「电子版」但电子版尺码为空 → 建议补全', () => {
    const r = makeRecord({ id: 4, 拥有形态: ['电子版'] });
    const { conflicts, suggestions } = computePendingChecks([r]);
    expect(conflicts).toHaveLength(0);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].字段).toBe('电子版尺码');
    expect(suggestions[0].详情).toContain('拥有形态勾选了「电子版」');
  });

  it('规则 5：勾了「纸质版」但纸质版尺码为空 → 建议补全', () => {
    const r = makeRecord({ id: 5, 拥有形态: ['纸质版'] });
    const { suggestions } = computePendingChecks([r]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].字段).toBe('纸质版尺码');
  });

  it('同一条记录可同时命中多条（形态与两侧尺码矛盾）', () => {
    const r = makeRecord({ id: 6, 电子版尺码: ['M'], 纸质版尺码: ['150'] });
    const { conflicts } = computePendingChecks([r]);
    expect(conflicts).toHaveLength(2);
    expect(new Set(conflicts.map((c) => c.key)).size).toBe(2);
  });
});

describe('v6.1.1 动态核对 · 修复后条目消失', () => {
  it('把「电子版」勾回拥有形态后，对应矛盾条目消失（不再像静态快照那样赖着不走）', () => {
    const broken = makeRecord({ id: 10, 电子版尺码: ['M'] });
    expect(computePendingChecks([broken]).conflicts).toHaveLength(1);

    const fixed = { ...broken, 拥有形态: ['电子版'] };
    expect(computePendingChecks([fixed]).conflicts).toHaveLength(0);
    expect(computePendingChecks([fixed]).suggestions).toHaveLength(0);
  });

  it('清掉占位尺码后，矛盾条目同样消失', () => {
    const broken = makeRecord({ id: 11, 纸质版尺码: ['150'] });
    const fixed = { ...broken, 纸质版尺码: [] };
    expect(computePendingChecks([fixed]).conflicts).toHaveLength(0);
  });

  it('给「名称为空」的记录补全名称后，关键字段缺失条目消失', () => {
    const broken = makeRecord({ id: 12, 名称: '' });
    const fixed = { ...broken, 名称: '补全后的名称' };
    expect(computePendingChecks([fixed]).conflicts).toHaveLength(0);
  });

  it('给勾了电子版的记录补上尺码后，建议补全条目消失', () => {
    const broken = makeRecord({ id: 13, 拥有形态: ['电子版'] });
    const fixed = { ...broken, 电子版尺码: ['M'] };
    expect(computePendingChecks([fixed]).suggestions).toHaveLength(0);
    expect(computePendingChecks([fixed]).conflicts).toHaveLength(0);
  });
});

describe('v6.1.1 动态核对 · 口径与稳定性', () => {
  it('形态与尺码一致的正常记录不产生任何条目', () => {
    const ok = [
      makeRecord({ id: 20, 拥有形态: ['电子版'], 电子版尺码: ['M'] }),
      makeRecord({ id: 21, 拥有形态: ['纸质版'], 纸质版尺码: ['140'] }),
      makeRecord({ id: 22, 拥有形态: ['电子版', '纸质版'], 电子版尺码: ['S'], 纸质版尺码: ['160'] }),
      makeRecord({ id: 23 }),
    ];
    const { conflicts, suggestions } = computePendingChecks(ok);
    expect(conflicts).toHaveLength(0);
    expect(suggestions).toHaveLength(0);
  });

  it('空数据集输出空清单（零条 → 横幅不显示的上游保证）', () => {
    const { conflicts, suggestions } = computePendingChecks([]);
    expect(conflicts).toHaveLength(0);
    expect(suggestions).toHaveLength(0);
  });

  it('条目 key 稳定、唯一，且与字段/记录绑定', () => {
    const r = makeRecord({ id: 30, 电子版尺码: ['M'] });
    const a = computePendingChecks([r]);
    const b = computePendingChecks([JSON.parse(JSON.stringify(r))]);
    expect(a.conflicts[0].key).toBe(b.conflicts[0].key);
    expect(a.conflicts[0].key).toBe(checkKey('勾选与信息矛盾', '电子版尺码', 30));
  });

  it('输出按记录 ID 升序排列，展示顺序稳定', () => {
    const recs = [
      makeRecord({ id: 33, 电子版尺码: ['M'] }),
      makeRecord({ id: 31, 电子版尺码: ['S'] }),
      makeRecord({ id: 32, 纸质版尺码: ['150'] }),
    ];
    const { conflicts } = computePendingChecks(recs);
    expect(conflicts.map((c) => c.记录ID)).toEqual([31, 32, 33]);
  });

  it('checkSummary 生成设置页可读摘要', () => {
    const r = makeRecord({ id: 40, 名称: '晨雾测试款', 电子版尺码: ['M'] });
    const { conflicts } = computePendingChecks([r]);
    expect(checkSummary(conflicts[0])).toBe('#40 矛盾·电子版尺码（晨雾测试款）');
    const s = makeRecord({ id: 41, 名称: '建议补全样本', 拥有形态: ['纸质版'] });
    const { suggestions } = computePendingChecks([s]);
    expect(checkSummary(suggestions[0])).toBe('#41 建议补全·纸质版尺码（建议补全样本）');
  });
});
