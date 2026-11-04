/**
 * v6.3 · 需求 2 字段选项管理（品牌 / 款式）纯函数单测
 *
 * 行为合同：
 *   · effectiveOptions：候选 = (schema 选项 ∪ added) − removed；schema 序在前、added 按沉淀顺序追加
 *   · addOptionValue：新值进 added（去重、去空白）；已在候选里 → 原样返回同一引用
 *   · removeOptionValue：从 added 摘除 + 进 removed（隐藏 schema 内置选项同理）；已在 removed → 同一引用
 *   · restoreOptionValue：从 removed 摘除；非 schema 选项重新回到 added
 *   · 删除 / 恢复绝不触碰任何记录取值（纯状态操作，与 records 无关）
 *   · 同步合并：基线三方（集合语义 union/drop）；无基线按待同步队列归属
 */

import { describe, expect, it } from 'vitest';
import {
  addOptionValue,
  effectiveOptions,
  makeOptionsFile,
  managedFieldKeys,
  mergeOptionsSync,
  normalizeOptionsState,
  optionsStateEqual,
  parseOptionsFile,
  removeOptionValue,
  restoreOptionValue,
} from '../store/options';
import type { PendingChange } from '../store/persist';
import { DEFAULT_SCHEMA } from '../schema';
import type { FieldOptionsState, ManagedFieldOptions } from '../types';

const st = (added: string[], removed: string[] = []): ManagedFieldOptions => ({ added, removed });
const state = (fields: Record<string, ManagedFieldOptions>): FieldOptionsState => fields;

describe('normalizeOptionsState', () => {
  it('丢弃非对象 / 非字段条目，字符串去空白去重', () => {
    const out = normalizeOptionsState({
      品牌: { added: ['  甲 ', '甲', ''], removed: [42 as unknown as string, '乙'] },
      非法字段: 'not-an-object',
    } as unknown as FieldOptionsState);
    expect(out).toEqual(state({ 品牌: st(['甲'], ['乙']) }));
    expect(normalizeOptionsState(null)).toEqual({});
    expect(normalizeOptionsState('x' as unknown as FieldOptionsState)).toEqual({});
  });
});

describe('effectiveOptions', () => {
  it('候选 = (schema ∪ added) − removed，schema 序在前', () => {
    expect(effectiveOptions(['晨雾', '青云'], st(['新牌子', '新牌子2'], ['青云'])))
      .toEqual(['晨雾', '新牌子', '新牌子2']);
  });
  it('无管理状态时原样返回 schema 选项', () => {
    expect(effectiveOptions(['晨雾'], undefined)).toEqual(['晨雾']);
    expect(effectiveOptions(undefined, st(['新牌子']))).toEqual(['新牌子']);
  });
});

describe('addOptionValue / removeOptionValue / restoreOptionValue', () => {
  it('新值沉淀进 added；已在候选（schema 选项）→ 不产生新引用', () => {
    const s0 = state({ 品牌: st([]) });
    const s1 = addOptionValue(s0, '品牌', '新牌子', false);
    expect(s1.品牌.added).toEqual(['新牌子']);
    expect(addOptionValue(s1, '品牌', '新牌子', false)).toBe(s1); // 幂等：同一引用
    expect(addOptionValue(s0, '品牌', '晨雾', true)).toBe(s0); // 已是 schema 候选 → no-op
  });
  it('删除：从 added 摘除并进 removed（含内置选项的隐藏）；幂等', () => {
    const s0 = state({ 品牌: st(['新牌子'], ['旧隐藏']) });
    const s1 = removeOptionValue(s0, '品牌', '新牌子');
    expect(s1.品牌.added).toEqual([]);
    expect(s1.品牌.removed).toEqual(['旧隐藏', '新牌子']);
    expect(removeOptionValue(s1, '品牌', '新牌子')).toBe(s1);
    const s2 = removeOptionValue(s0, '品牌', '晨雾');
    expect(s2.品牌.removed).toContain('晨雾'); // 内置选项同样可隐藏
  });
  it('恢复：非 schema 选项回到 added；schema 选项仅解除隐藏', () => {
    const s0 = state({ 品牌: st(['另牌子'], ['新牌子', '晨雾']) });
    const s1 = restoreOptionValue(s0, '品牌', '新牌子', false);
    expect(s1.品牌.added).toEqual(['另牌子', '新牌子']);
    expect(s1.品牌.removed).toEqual(['晨雾']);
    const s2 = restoreOptionValue(s0, '品牌', '晨雾', true);
    expect(s2.品牌.added).toEqual(['另牌子']);
    expect(s2.品牌.removed).toEqual(['新牌子']);
    expect(restoreOptionValue(s0, '品牌', '不存在', false)).toBe(s0);
  });
  it('未管理的字段被安全忽略（空值 / 空白值不沉淀）', () => {
    const s0 = state({});
    expect(addOptionValue(s0, '品牌', '   ', false)).toBe(s0);
    expect(removeOptionValue(s0, '品牌', ' ')).toBe(s0);
  });
});

describe('parseOptionsFile / makeOptionsFile / optionsStateEqual', () => {
  it('解析 + 组装往返一致；坏 JSON 回退空状态', () => {
    const file = makeOptionsFile(state({ 品牌: st(['新牌子']) }), 3);
    expect(file.dataVersion).toBe(3);
    const parsed = parseOptionsFile(JSON.stringify(file));
    expect(parsed.state).toEqual(state({ 品牌: st(['新牌子']) }));
    expect(parsed.dataVersion).toBe(3);
    expect(parseOptionsFile('not json').state).toEqual({});
  });
  it('相等比较与字段顺序无关', () => {
    const a = state({ 品牌: st(['甲']), 款式: st([], ['乙']) });
    const b = state({ 款式: st([], ['乙']), 品牌: st(['甲']) });
    expect(optionsStateEqual(a, b)).toBe(true);
    expect(optionsStateEqual(a, state({ 品牌: st(['甲', '丙']) }))).toBe(false);
  });
});

describe('managedFieldKeys', () => {
  it('受管字段 = allowNew 的枚举字段（品牌 / 款式）', () => {
    expect(managedFieldKeys(DEFAULT_SCHEMA)).toEqual(['品牌', '款式']);
  });
});

describe('mergeOptionsSync', () => {
  const change = (fieldKey: string): PendingChange => ({
    id: `x-${fieldKey}`,
    记录ID: 0,
    动作: '编辑',
    字段: ['字段选项', fieldKey],
    时间: '2026-01-01T00:00:00.000Z',
  });

  it('有基线：集合三方合并（一侧新增 ∪，一侧删除 −）', () => {
    const base = state({ 品牌: st(['甲']) });
    const local = state({ 品牌: st(['甲', '乙']) }); // 本地新增 乙
    const remote = state({ 品牌: st([]) }); // 远端删除 甲
    const res = mergeOptionsSync({ local, remote, baseline: base, pending: [] });
    expect(res.state.品牌).toEqual(st(['乙'])); // 双方改动都保留，无冲突
    expect(res.baselineMode).toBe('persisted');
  });

  it('有基线：远端新值合入本地', () => {
    const base = state({ 品牌: st([]) });
    const local = state({ 品牌: st([]) });
    const remote = state({ 品牌: st(['远端新牌子'], ['晨雾']) });
    const res = mergeOptionsSync({ local, remote, baseline: base, pending: [] });
    expect(res.state.品牌).toEqual(st(['远端新牌子'], ['晨雾']));
  });

  it('空对象也是合法基线（区别于 null）', () => {
    const res = mergeOptionsSync({
      local: state({ 品牌: st(['乙']) }),
      remote: state({}),
      baseline: {}, // 上次同步时远端就是空 → 已持久化的合法基线
      pending: [change('品牌')],
    });
    expect(res.state.品牌.added).toEqual(['乙']);
    expect(res.baselineMode).toBe('persisted');
  });

  it('无基线：动过的字段保留本地意图，未动的跟随远端', () => {
    const local = state({ 品牌: st(['本地新'], ['旧隐藏']), 款式: st(['本地款式']) });
    const remote = state({ 品牌: st(['远端新']), 款式: st([], ['远端隐藏']) });
    const res = mergeOptionsSync({ local, remote, baseline: null, pending: [change('品牌')] });
    expect(res.state.品牌).toEqual(st(['本地新'], ['旧隐藏'])); // 动过 → 本地优先
    expect(res.state.款式).toEqual(st([], ['远端隐藏'])); // 没动 → 跟远端
    expect(res.baselineMode).toBe('reconstructed');
  });
});
