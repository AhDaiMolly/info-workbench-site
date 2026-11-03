import { describe, expect, it } from 'vitest';
import {
  applyQuery, buildIndexes, computeStats, expandEsizeFilterValues, highlightParts, matchesFilters,
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

const sample: RecordItem[] = [
  makeRecord({
    id: 1, 名称: '棉麻衬衫', 品牌: '品牌甲', 分类: ['女装'], 款式: '衬衣',
    季节: '夏', 教程: '有', 推荐: '推荐', 做过: true, 计划: '在计划中',
    拥有形态: ['电子版'],
    备注: '面料透气，夏天很合适', 更新时间: '2026-03-02T00:00:00.000Z',
  }),
  makeRecord({
    id: 2, 名称: '羊毛外套', 品牌: '品牌乙', 分类: ['女装', '男装'], 款式: '外套',
    季节: '冬', 教程: '无', 拥有形态: ['电子版', '纸质版'], 电子版尺码: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    推荐: '未评价', 计划: '不是现在', 备注: '冬天保暖，含羊毛',
    更新时间: '2026-03-01T00:00:00.000Z',
  }),
  makeRecord({
    id: 3, 名称: '休闲长裤', 品牌: '品牌甲', 分类: ['男装'], 款式: '长裤',
    季节: '春秋', 教程: '未知', 拥有形态: [],
    计划: '不想做', 备注: '普通款',
    更新时间: '2026-02-01T00:00:00.000Z',
  }),
  makeRecord({
    id: 4, 名称: '旧款卫衣', 品牌: '品牌丙', 分类: [], 款式: '卫衣',
    季节: '', 推荐: '不推荐', 做过: false, 计划: '未标记',
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
    expect(stats.计划).toBe(1);
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


/* ------------------------------------------------------------------
 * v6 新增用例：需求 4（拼音排序）与需求 5（编号搜索）
 * ------------------------------------------------------------------ */
describe('v6 · 需求 4 默认按名称拼音升序', () => {
  // 码位序与拼音序不一致的样本：码位序 北<安<广<成<杭；拼音序 安<北<成<广<杭
  const pyRecords: RecordItem[] = [
    makeRecord({ id: 11, 名称: '北风外套' }),
    makeRecord({ id: 12, 名称: '安拉链' }),
    makeRecord({ id: 13, 名称: '广州衬衫' }),
    makeRecord({ id: 14, 名称: '成风长裤' }),
    makeRecord({ id: 15, 名称: '杭州卫衣' }),
  ];

  it('按名称升序时中文按拼音排序（不是按 Unicode 码位）', () => {
    const sorted = sortRecords(pyRecords, { key: '名称', dir: 'asc' });
    expect(sorted.map((r) => r.名称)).toEqual(['安拉链', '北风外套', '成风长裤', '广州衬衫', '杭州卫衣']);
    expect(sorted.map((r) => r.id)).toEqual([12, 11, 14, 13, 15]);
  });

  it('名称降序时拼音序反转', () => {
    const sorted = sortRecords(pyRecords, { key: '名称', dir: 'desc' });
    expect(sorted.map((r) => r.名称)).toEqual(['杭州卫衣', '广州衬衫', '成风长裤', '北风外套', '安拉链']);
  });
});

describe('v6 · 需求 5 搜索支持编号', () => {
  it('纯数字查询命中对应编号的记录', () => {
    expect(searchIds(sample, '3')).toEqual([3]);
    expect(searchIds(sample, '2')).toEqual([2]);
  });

  it('「#编号」写法同样命中', () => {
    expect(searchIds(sample, '#3')).toEqual([3]);
    expect(searchIds(sample, '#1')).toEqual([1]);
  });

  it('不存在的编号查不到', () => {
    expect(searchIds(sample, '#99')).toEqual([]);
    expect(searchIds(sample, '99')).toEqual([]);
  });

  it('不会因编号拼接产生误命中（#3 不应命中「33」）', () => {
    expect(searchIds(sample, '33')).toEqual([]);
    expect(searchIds(sample, '#33')).toEqual([]);
  });

  it('编号与名称混合查询可叠加', () => {
    expect(searchIds(sample, '外套 2')).toEqual([2]);
    expect(searchIds(sample, '外套 3')).toEqual([]);
  });

  it('applyQuery 走编号筛选同样生效', () => {
    const hits = applyQuery(sample, EMPTY_FILTERS, '#2');
    expect(hits.map((r) => r.id)).toEqual([2]);
  });
});


/* ------------------------------------------------------------------
 * v6.1 新增用例：需求 2（计划字段）与需求 3（电子版尺码双轨）
 * ------------------------------------------------------------------ */
describe('v6.1 · 需求 2 计划字段筛选', () => {
  it('按「在计划中」筛选只命中计划中的记录', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 计划: ['在计划中'] }))).map((r) => r.id)).toEqual([1]);
  });

  it('按「不是现在」筛选命中改名后的旧「不确定」记录', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 计划: ['不是现在'] }))).map((r) => r.id)).toEqual([2]);
  });

  it('多选项取并集（在计划中 + 不想做）', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 计划: ['在计划中', '不想做'] }))).map((r) => r.id)).toEqual([1, 3]);
  });

  it('看板完成度口径含全部四个新选项', () => {
    const stats = computeStats(sample);
    expect(stats.completion.map((c) => c.name)).toEqual(['在计划中', '不是现在', '不想做', '未标记']);
    expect(stats.completion.find((c) => c.name === '在计划中')?.value).toBe(1);
    expect(stats.completion.find((c) => c.name === '不是现在')?.value).toBe(1);
    expect(stats.completion.find((c) => c.name === '不想做')?.value).toBe(1);
    expect(stats.completion.find((c) => c.name === '未标记')?.value).toBe(1);
  });
});

describe('v6.1 · 需求 3 电子版尺码双轨筛选', () => {
  it('按字母码标签命中电子版尺码含该标签的记录', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 电子版尺码: ['XS'] }))).map((r) => r.id)).toEqual([2]);
    expect(sample.filter((r) => matchesFilters(r, filters({ 电子版尺码: ['100'] }))).map((r) => r.id)).toEqual([]);
  });

  it('多标签 AND 语义：必须同时包含', () => {
    expect(sample.filter((r) => matchesFilters(r, filters({ 电子版尺码: ['XS', 'M'] }))).map((r) => r.id)).toEqual([2]);
    expect(sample.filter((r) => matchesFilters(r, filters({ 电子版尺码: ['XS', '100'] }))).map((r) => r.id)).toEqual([]);
  });

  it('身高码标签可独立筛选', () => {
    const tall = [makeRecord({ id: 21, 名称: '儿童连衣裙', 电子版尺码: ['110', '120'] })];
    expect(tall.filter((r) => matchesFilters(r, filters({ 电子版尺码: ['110'] }))).map((r) => r.id)).toEqual([21]);
  });
});

describe('v6.1 · 需求 3 旧尺码组筛选值扩展（expandEsizeFilterValues）', () => {
  it('「女士全码」扩展为全部字母码（记录必须含全部字母码才命中）', () => {
    expect(expandEsizeFilterValues(['女士全码'])).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
    // id2 拥有全部字母码 → 命中；只有部分字母码 → 不命中
    expect(sample.filter((r) => matchesFilters(r, filters({ 电子版尺码: ['女士全码'] }))).map((r) => r.id)).toEqual([2]);
    const partial = [makeRecord({ id: 22, 名称: '部分尺码', 电子版尺码: ['XS', 'M'] })];
    expect(partial.filter((r) => matchesFilters(r, filters({ 电子版尺码: ['女士全码'] }))).length).toBe(0);
  });

  it('「大小童全码」扩展为全部身高码', () => {
    expect(expandEsizeFilterValues(['大小童全码'])).toEqual(['100', '110', '120', '130', '140', '150', '160', '170', '180']);
    const kids = [makeRecord({ id: 23, 名称: '童装套装', 电子版尺码: ['100', '110', '120', '130', '140', '150', '160', '170', '180'] })];
    expect(kids.filter((r) => matchesFilters(r, filters({ 电子版尺码: ['大小童全码'] }))).map((r) => r.id)).toEqual([23]);
  });

  it('「男士全码」「仅小童」映射为永不命中的哨兵（迁移时这两类被置空）', () => {
    const out = expandEsizeFilterValues(['男士全码', '仅小童']);
    expect(out.every((v) => !['XS', '100'].includes(v))).toBe(true);
    const any = [makeRecord({ id: 24, 名称: '任意记录' })];
    expect(any.filter((r) => matchesFilters(r, filters({ 电子版尺码: ['男士全码'] }))).length).toBe(0);
    expect(any.filter((r) => matchesFilters(r, filters({ 电子版尺码: ['仅小童'] }))).length).toBe(0);
  });

  it('普通标签原样透传，重复值去重', () => {
    expect(expandEsizeFilterValues(['XS', 'XS', '110'])).toEqual(['XS', '110']);
  });

  it('旧预设值与新标签可混用（并集去重）', () => {
    const out = expandEsizeFilterValues(['女士全码', 'XS']);
    expect(out.filter((v) => v === 'XS').length).toBe(1);
    expect(out).toContain('4XL');
  });
});
