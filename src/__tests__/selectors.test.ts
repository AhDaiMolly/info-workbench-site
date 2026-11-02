import { describe, expect, it } from 'vitest';
import {
  applyQuery, buildIndexes, computeStats, highlightParts, matchesFilters,
  searchIds, sortRecords, tokenize,
} from '../store/selectors';
import { EMPTY_FILTERS } from '../types';
import type { Filters, RecordItem } from '../types';

/**
 * 说明：本文件使用完全虚构的占位数据（品牌甲/品牌乙 等），
 * 站点仓内不允许出现任何真实记录值（架构 7.1 / 7.2 第 5 条）。
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

const sample: RecordItem[] = [
  makeRecord({
    id: 1, 名称: '棉麻衬衫', 品牌: '品牌甲', 分类: ['女装'], 款式: '衬衣',
    季节: '夏', 教程: '有', 推荐: '推荐', 做过: true, 想做: '想做',
    备注: '面料透气，夏天很合适', 更新时间: '2026-03-02T00:00:00.000Z',
  }),
  makeRecord({
    id: 2, 名称: '羊毛外套', 品牌: '品牌乙', 分类: ['女装', '男装'], 款式: '外套',
    季节: '冬', 教程: '无', 拥有电子版: true, 电子版尺码组: ['女士全码'],
    推荐: '未评价', 想做: '不确定', 备注: '冬天保暖，含羊毛',
    更新时间: '2026-03-01T00:00:00.000Z',
  }),
  makeRecord({
    id: 3, 名称: '休闲长裤', 品牌: '品牌甲', 分类: ['男装'], 款式: '长裤',
    季节: '春秋', 教程: '未知', 想做: '不想做', 备注: '普通款',
    更新时间: '2026-02-01T00:00:00.000Z',
  }),
  makeRecord({
    id: 4, 名称: '旧款卫衣', 品牌: '品牌丙', 分类: [], 款式: '卫衣',
    季节: '', 推荐: '不推荐', 做过: false, 想做: '未标记', 备注: '有点旧了',
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

  it('布尔三态：不限 / 是 / 否', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 拥有电子版: true }))).map((r) => r.id)).toEqual([2]);
    expect(sample.filter((r) => matchesFilters(r, filters({ 拥有电子版: false }))).map((r) => r.id)).toEqual([1, 3, 4]);
    expect(sample.filter((r) => matchesFilters(r, filters())).length).toBe(4);
  });

  it('清空条件后恢复全量', () => {
    expect(applyQuery(sample, filters(), '').length).toBe(4);
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
    // 「品牌」出现在记录2的品牌字段中，「羊毛」在其备注中 → 同时命中
    expect(searchIds(sample, '品牌 羊毛')).toEqual([2]);
    expect(searchIds(sample, '外套 羊毛')).toEqual([2]);
    // 「男装」在记录3、「衬衫」在记录1，两者无交集
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

  it('KPI 与基础计数一致', () => {
    const stats = computeStats(sample);
    expect(stats.total).toBe(4);
    expect(stats.有教程).toBe(1);
    expect(stats.做过).toBe(1);
    expect(stats.想做).toBe(1);
  });

  it('拥有形态四分类互斥且完备', () => {
    const stats = computeStats(sample);
    const sum = stats.ownership.reduce((s, o) => s + o.value, 0);
    expect(sum).toBe(4);
    expect(stats.ownership.find((o) => o.name === '仅电子版')?.value).toBe(1);
    expect(stats.ownership.find((o) => o.name === '都没有')?.value).toBe(3);
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
