import { describe, expect, it } from 'vitest';
import {
  applyQuery, buildIndexes, computeStats, highlightParts, matchesFilters,
  searchIds, sortRecords, tokenize,
} from '../store/selectors';
import { EMPTY_FILTERS } from '../types';
import { OWNERSHIP_ANY } from '../schema';
import type { Filters, RecordItem } from '../types';

/**
 * 说明：本文件使用完全虚构的占位数据（品牌甲/品牌乙 等），
 * 站点仓内不允许出现任何真实记录值（架构 7.1 / 7.2 第 5 条）。
 *
 * v5（R5）：「电子版」「纸质版」两个三态单选 → 单个多选「拥有形态」。
 */

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
    电子版尺码组: [],
    纸质版尺码: [],
    推荐: '未评价',
    做过: false,
    想做: '未标记',
    备注: '',
    创建时间: '2026-01-01T00:00:00.000Z',
    更新时间: '2026-01-01T00:00:00.000Z',
    ...rest,
  } as RecordItem;
}

const sample: RecordItem[] = [
  makeRecord({
    id: 1, 名称: '棉麻衬衫', 品牌: '品牌甲', 分类: ['女装'], 款式: '衬衣',
    季节: '夏', 教程: '有', 推荐: '推荐', 做过: true, 想做: '想做',
    拥有形态: ['电子版'],
    备注: '面料透气，夏天很合适', 更新时间: '2026-03-02T00:00:00.000Z',
  }),
  makeRecord({
    id: 2, 名称: '羊毛外套', 品牌: '品牌乙', 分类: ['女装', '男装'], 款式: '外套',
    季节: '冬', 教程: '无', 拥有形态: ['电子版', '纸质版'], 电子版尺码组: ['女士全码'],
    推荐: '未评价', 想做: '不确定', 备注: '冬天保暖，含羊毛',
    更新时间: '2026-03-01T00:00:00.000Z',
  }),
  makeRecord({
    id: 3, 名称: '休闲长裤', 品牌: '品牌甲', 分类: ['男装'], 款式: '长裤',
    季节: '春秋', 教程: '未知', 拥有形态: [],
    想做: '不想做', 备注: '普通款',
    更新时间: '2026-02-01T00:00:00.000Z',
  }),
  makeRecord({
    id: 4, 名称: '旧款卫衣', 品牌: '品牌丙', 分类: [], 款式: '卫衣',
    季节: '', 推荐: '不推荐', 做过: false, 想做: '未标记',
    拥有形态: [], 备注: '有点旧了',
    更新时间: '2026-01-01T00:00:00.000Z',
  }),
];

function filters(patch: Partial<Filters> = {}): Filters {
  return { ...EMPTY_FILTERS, ...patch };
}

describe('筛选：多条件 AND + 同字段选项级 OR', () => {
  it('单条件按字段精确匹配', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 品牌: ['品牌乙'] }))).map((r) => r.id)).toEqual([2]);
  });

  it('分类为选项级匹配：命中任一选项即返回', () => {
    const hit = sample.filter((r) => matchesFilters(r, filters({ 分类: ['男装'] }))).map((r) => r.id);
    expect(hit).toEqual([2, 3]);
  });

  it('多条件之间取交集（AND）', () => {
    const hit = sample.filter((r) => matchesFilters(r, filters({ 品牌: ['品牌甲'], 分类: ['男装'] }))).map((r) => r.id);
    expect(hit).toEqual([3]);
  });

  it('清空条件后恢复全量', () => {
    expect(applyQuery(sample, filters(), '').length).toBe(4);
  });
});

describe('v5 · R5 拥有形态筛选（单字段多选，语义=包含）', () => {
  it('选「电子版」命中拥有电子版的记录（含双有）', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 拥有形态: ['电子版'] }))).map((r) => r.id)).toEqual([1, 2]);
  });

  it('选「纸质版」只命中双有（样本里 id2 是双有）', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 拥有形态: ['纸质版'] }))).map((r) => r.id)).toEqual([2]);
  });

  it('同时选两种形态 = AND，命中「双有」', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 拥有形态: ['电子版', '纸质版'] }))).map((r) => r.id)).toEqual([2]);
  });

  it('「任意拥有」命中拥有形态非空的记录', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 拥有形态: [OWNERSHIP_ANY] }))).map((r) => r.id)).toEqual([1, 2]);
  });

  it('「任意拥有」+ 具体形态仍按包含语义收敛', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 拥有形态: ['电子版', OWNERSHIP_ANY] }))).map((r) => r.id)).toEqual([1, 2]);
    expect(sample.filter((r) => matchesFilters(r, filters({ 拥有形态: ['纸质版', OWNERSHIP_ANY] }))).map((r) => r.id)).toEqual([2]);
  });

  it('不选任何形态 = 不过滤', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 拥有形态: [] }))).length).toBe(4);
  });
});

describe('全文搜索', () => {
  it('按备注内容命中', () => {
    const ids = searchIds(sample, '羊毛');
    expect(ids).toContain(2);
    expect(ids).not.toContain(3);
  });

  it('按名称命中', () => {
    expect(searchIds(sample, '衬衫')).toEqual([1]);
  });

  it('多关键词取交集', () => {
    expect(searchIds(sample, '品牌 羊毛')).toEqual([2]);
    expect(searchIds(sample, '外套 羊毛')).toEqual([2]);
    expect(searchIds(sample, '男装 衬衫')).toEqual([]);
  });

  it('搜索与筛选叠加生效', () => {
    const out = applyQuery(sample, filters({ 品牌: ['品牌甲'] }), '羊毛');
    expect(out.length).toBe(0);
    const out2 = applyQuery(sample, filters({ 品牌: ['品牌乙'] }), '羊毛');
    expect(out2.map((r) => r.id)).toEqual([2]);
  });

  it('清空搜索恢复筛选结果', () => {
    expect(applyQuery(sample, filters({ 品牌: ['品牌甲'] }), '').length).toBe(2);
  });

  it('分词器对中文生成 1~3 字词元，对拉丁生成整词', () => {
    const tokens = tokenize('Abc 羽绒服');
    expect(tokens).toContain('abc');
    expect(tokens).toContain('羽');
    expect(tokens).toContain('羽绒服');
  });

  it('索引跨字段不误命中（名称尾 + 品牌首拼接）', () => {
    const tricky = [makeRecord({ id: 9, 名称: '测试', 品牌: '备注' })];
    const idx = buildIndexes(tricky);
    expect(searchIds(tricky, '测试备注', idx).length).toBe(0);
  });

  it('v5：拥有形态不进入全文搜索范围（PRD 口径：名称 / 品牌 / 备注）', () => {
    // 拥有形态是可筛选字段，但不属于全文检索字段范围
    expect(searchIds(sample, '纸质版')).toEqual([]);
  });
});

describe('排序', () => {
  it('默认按更新时间倒序', () => {
    const out = sortRecords(sample, { key: '更新时间', dir: 'desc' });
    expect(out.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('按记录 ID 升序', () => {
    expect(sortRecords(sample, { key: 'id', dir: 'asc' }).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('按名称排序使用中文排序规则', () => {
    const out = sortRecords(sample, { key: '名称', dir: 'asc' }).map((r) => r.名称);
    expect(out.length).toBe(4);
    expect(out).toContain('棉麻衬衫');
  });
});

describe('看板统计', () => {
  it('分类按选项级计数（一条命中两个分类即计 2 次）', () => {
    const stats = computeStats(sample);
    const 女装 = stats.category.find((c) => c.name === '女装');
    const 男装 = stats.category.find((c) => c.name === '男装');
    expect(女装?.value).toBe(2);
    expect(男装?.value).toBe(2);
    expect(stats.categoryUncategorized).toBe(1);
  });

  it('KPI 与基础计数一致（v4：不再有「有教程」口径）', () => {
    const stats = computeStats(sample);
    expect(stats.total).toBe(4);
    expect(stats.做过).toBe(1);
    expect(stats.想做).toBe(1);
    expect('有教程' in (stats as unknown as Record<string, unknown>)).toBe(false);
  });

  it('v5：拥有形态分四态且互斥完备（皆无 / 仅电子 / 仅纸质 / 双有）', () => {
    const stats = computeStats(sample);
    expect(stats.ownership.map((o) => o.name)).toEqual(['皆无', '仅电子', '仅纸质', '双有']);
    const sum = stats.ownership.reduce((s, o) => s + o.value, 0);
    expect(sum).toBe(4);
    expect(stats.ownership.find((o) => o.name === '皆无')?.value).toBe(2);
    expect(stats.ownership.find((o) => o.name === '仅电子')?.value).toBe(1);
    expect(stats.ownership.find((o) => o.name === '仅纸质')?.value).toBe(0);
    expect(stats.ownership.find((o) => o.name === '双有')?.value).toBe(1);
    // v5 取消了「待确认」态
    expect(stats.ownership.find((o) => o.name === '待确认')).toBeUndefined();
  });

  it('季节空值计入未填', () => {
    const stats = computeStats(sample);
    expect(stats.seasonBlank).toBe(1);
    expect(stats.season.find((s) => s.name === '冬')?.value).toBe(1);
  });
});

describe('高亮', () => {
  it('按关键词切分命中片段', () => {
    const parts = highlightParts('冬天保暖，含羊毛', '羊毛');
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['羊毛']);
  });

  it('无关键词时返回整段', () => {
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', hit: false }]);
  });
});
