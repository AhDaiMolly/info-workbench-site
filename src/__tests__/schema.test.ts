import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ORDER, DEFAULT_SCHEMA, DEFAULT_VISIBLE_COLUMNS, DERIVED_LIST_COLUMNS, FIELD_DEFAULTS,
  HIDDEN_UI_FIELDS, LEGACY_ESIZE_GROUP_MAP, OWNERSHIP_ANY, OWNERSHIP_FILTER_OPTIONS, OWNERSHIP_FORMAT_OPTIONS,
  OWNERSHIP_NONE, OWNERSHIP_TRISTATE_OPTIONS,
  PAPER_SIZE_HEIGHT_TAGS, PAPER_SIZE_LETTER_TAGS, REMOVED_FIELD_KEYS,
  SEASON_OPTIONS, defaultValueFor, mergeSchema, stripLegacyOptions,
} from '../schema';
import type { FieldDef, Schema } from '../types';

/**
 * v5 的 schema 侧规则：
 *   · 结构版本 3 → 4：「电子版」「纸质版」两个枚举三态合并为单个多选「拥有形态」
 *   · 已删除字段（电子版缺码 / 关联）不进入 schema
 *   · 远端旧键（电子版 / 纸质版 / 拥有电子版 / 拥有纸质版）一律不采纳，由内置 v5 定义接管
 *   · 远端非法字段类型回落为内置类型（历史遗留的 "季节" 类型）
 *   · 旧取值「通用」不再提供
 *   · 列表默认列固定为 8 列（R1）
 */

function remoteField(over: Partial<FieldDef> & { key: string }): FieldDef {
  return { jsonKey: over.key, type: 'text', label: over.key, ...over };
}

describe('内置 schema', () => {
  it('当前结构版本为 5（v6.1：想做改名计划 + 电子版尺码双轨化）', () => {
    expect(DEFAULT_SCHEMA.schemaVersion).toBe(5);
  });

  it('不含已删除字段', () => {
    const keys = DEFAULT_SCHEMA.fields.map((f) => f.key);
    for (const k of REMOVED_FIELD_KEYS) expect(keys).not.toContain(k);
  });

  it('v5：含「拥有形态」多选，不含旧的两个单选键', () => {
    const keys = DEFAULT_SCHEMA.fields.map((f) => f.key);
    expect(keys).toContain('拥有形态');
    expect(keys).not.toContain('电子版');
    expect(keys).not.toContain('纸质版');
    expect(keys).not.toContain('拥有电子版');
    expect(keys).not.toContain('拥有纸质版');
  });

  it('v5：「拥有形态」为多选，选项为 电子版 / 纸质版（取消「不确定」）', () => {
    const f = DEFAULT_SCHEMA.fields.find((x) => x.key === '拥有形态')!;
    expect(f.type).toBe('multi');
    expect(f.options).toEqual(OWNERSHIP_FORMAT_OPTIONS);
    expect(OWNERSHIP_FORMAT_OPTIONS).toEqual(['电子版', '纸质版']);
    expect(OWNERSHIP_FORMAT_OPTIONS).not.toContain('不确定');
  });

  it('v5：旧三态仅供迁移层使用，不进入选项集', () => {
    expect(OWNERSHIP_TRISTATE_OPTIONS).toEqual(['有', '没有', '不确定']);
    const own = DEFAULT_SCHEMA.fields.find((f) => f.key === '拥有形态')!;
    expect(own.options).not.toContain('不确定');
  });

  it('v5：筛选项含保留值「任意拥有」', () => {
    expect(OWNERSHIP_ANY).toBe('任意拥有');
    expect(OWNERSHIP_FILTER_OPTIONS).toContain('电子版');
    expect(OWNERSHIP_FILTER_OPTIONS).toContain('纸质版');
    expect(OWNERSHIP_FILTER_OPTIONS).toContain('任意拥有');
  });

  it('v6.5（需求 5）：筛选项新增保留值「均没有」', () => {
    expect(OWNERSHIP_NONE).toBe('均没有');
    expect(OWNERSHIP_FILTER_OPTIONS).toEqual(['电子版', '纸质版', '任意拥有', '均没有']);
  });

  it('v6.5（需求 1）：全站隐藏字段为「推荐」「计划」', () => {
    expect(HIDDEN_UI_FIELDS).toEqual(['推荐', '计划']);
    // 隐藏只是展示层行为 —— 字段仍在 schema 里，数据原样保留
    const keys = DEFAULT_SCHEMA.fields.map((f) => f.key);
    expect(keys).toContain('推荐');
    expect(keys).toContain('计划');
  });

  it('季节为枚举单选，选项含「春秋」且不拆分', () => {
    const season = DEFAULT_SCHEMA.fields.find((f) => f.key === '季节')!;
    expect(season.type).toBe('enum');
    expect(season.options).toEqual(SEASON_OPTIONS);
    expect(SEASON_OPTIONS).toContain('春秋');
  });

  it('分类选项不再含「通用」', () => {
    expect(CATEGORY_ORDER).not.toContain('通用');
    const cat = DEFAULT_SCHEMA.fields.find((f) => f.key === '分类')!;
    expect(cat.options).not.toContain('通用');
  });
});

describe('列表默认列（v6.5 口径）', () => {
  it('默认 9 列：名称 / 品牌 / 分类 / 款式 / 季节 / 电子 / 纸质 / 教程 / 做过', () => {
    expect(DEFAULT_VISIBLE_COLUMNS).toEqual([
      '名称', '品牌', '分类', '款式', '季节', '电子', '纸质', '教程', '做过',
    ]);
    expect(DEFAULT_VISIBLE_COLUMNS.length).toBe(9);
  });

  it('v6.5（需求 9）：派生列由「形态」拆成「电子」「纸质」两列', () => {
    expect(DERIVED_LIST_COLUMNS).toEqual(['电子', '纸质']);
    const keys = DEFAULT_SCHEMA.fields.map((f) => f.key);
    expect(keys).not.toContain('形态');
    expect(keys).not.toContain('标记');
    expect(keys).toContain('做过');
  });

  it('v6.5（需求 1）：默认列里不再有「推荐」「计划」', () => {
    expect(DEFAULT_VISIBLE_COLUMNS).not.toContain('推荐');
    expect(DEFAULT_VISIBLE_COLUMNS).not.toContain('计划');
  });

  it('R3：尺码与备注收进详情页，不在默认列里', () => {
    expect(DEFAULT_VISIBLE_COLUMNS).not.toContain('电子版尺码');
    expect(DEFAULT_VISIBLE_COLUMNS).not.toContain('纸质版尺码');
    expect(DEFAULT_VISIBLE_COLUMNS).not.toContain('备注');
    // 但字段仍在 schema 中（详情页 / 筛选 / 导出仍然可用）
    const keys = DEFAULT_SCHEMA.fields.map((f) => f.key);
    expect(keys).toContain('电子版尺码');
    expect(keys).toContain('纸质版尺码');
    expect(keys).toContain('备注');
  });
});

describe('v5 · R4 纸质版尺码快捷标签', () => {
  it('字母码 XS–4XL', () => {
    expect(PAPER_SIZE_LETTER_TAGS).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
  });

  it('身高码 v6.2 新增 80/90/155/165，共 13 项且严格升序', () => {
    expect(PAPER_SIZE_HEIGHT_TAGS).toEqual([
      '80', '90', '100', '110', '120', '130', '140', '150', '155', '160', '165', '170', '180',
    ]);
    for (let i = 1; i < PAPER_SIZE_HEIGHT_TAGS.length; i += 1) {
      expect(Number(PAPER_SIZE_HEIGHT_TAGS[i]) - Number(PAPER_SIZE_HEIGHT_TAGS[i - 1])).toBeGreaterThan(0);
    }
  });

  it('旧「大小童全码」展开仍钉在 v6.1 的 9 个身高码，不纳入新码', () => {
    const group = LEGACY_ESIZE_GROUP_MAP['大小童全码'];
    expect(group).toBeDefined();
    expect(group).toEqual(['100', '110', '120', '130', '140', '150', '160', '170', '180']);
    expect(group).not.toContain('80');
    expect(group).not.toContain('90');
    expect(group).not.toContain('155');
    expect(group).not.toContain('165');
  });
});

describe('取值默认', () => {
  it('枚举字段取显式默认值（旧的两个单选键不再有默认值）', () => {
    expect(FIELD_DEFAULTS.教程).toBe('未知');
    expect(FIELD_DEFAULTS.推荐).toBe('未评价');
    // v6.1：「想做」改名「计划」，默认值仍是「未标记」
    expect(FIELD_DEFAULTS.计划).toBe('未标记');
    expect(FIELD_DEFAULTS.电子版).toBeUndefined();
    expect(FIELD_DEFAULTS.纸质版).toBeUndefined();
  });

  it('defaultValueFor 按类型给出默认', () => {
    expect(defaultValueFor({ key: '分类', jsonKey: '分类', type: 'multi', label: '分类' })).toEqual([]);
    expect(defaultValueFor({ key: '拥有形态', jsonKey: '拥有形态', type: 'multi', label: '拥有形态' })).toEqual([]);
    expect(defaultValueFor({ key: '纸质版尺码', jsonKey: '纸质版尺码', type: 'tags', label: '纸质版尺码' })).toEqual([]);
    expect(defaultValueFor({ key: '做过', jsonKey: '做过', type: 'boolean', label: '做过' })).toBe(false);
    expect(defaultValueFor({ key: '记录ID', jsonKey: 'id', type: 'number', label: '记录ID' })).toBe(0);
    expect(defaultValueFor({ key: '季节', jsonKey: '季节', type: 'enum', label: '季节' })).toBe('');
  });

  it('季节等无显式默认的枚举不会被默认成最后一个选项', () => {
    expect(defaultValueFor({ key: '季节', jsonKey: '季节', type: 'enum', label: '季节' })).not.toBe('冬');
  });
});

describe('远端 schema 合并', () => {
  it('远端为空时返回内置 schema', () => {
    expect(mergeSchema(DEFAULT_SCHEMA, null)).toBe(DEFAULT_SCHEMA);
  });

  it('已删除字段不进入合并结果', () => {
    const remote: Partial<Schema> = {
      fields: [
        remoteField({ key: '电子版缺码', type: 'boolean' }),
        remoteField({ key: '关联', type: 'refs' }),
      ],
    };
    const merged = mergeSchema(DEFAULT_SCHEMA, remote);
    const keys = merged.fields.map((f) => f.key);
    expect(keys).not.toContain('电子版缺码');
    expect(keys).not.toContain('关联');
  });

  it('v5：远端旧键（拥有电子版 / 拥有纸质版）由内置定义接管', () => {
    const remote: Partial<Schema> = {
      fields: [
        remoteField({ key: '拥有电子版', type: 'boolean' }),
        remoteField({ key: '拥有纸质版', type: 'boolean' }),
      ],
    };
    const merged = mergeSchema(DEFAULT_SCHEMA, remote);
    const keys = merged.fields.map((f) => f.key);
    expect(keys).not.toContain('拥有电子版');
    expect(keys).not.toContain('拥有纸质版');
    const own = merged.fields.find((f) => f.key === '拥有形态')!;
    expect(own.type).toBe('multi');
    expect(own.options).toEqual(OWNERSHIP_FORMAT_OPTIONS);
  });

  it('v5：远端仍带「电子版 / 纸质版」旧键时一律不采纳（合并字段集唯一）', () => {
    const remote: Partial<Schema> = {
      fields: [
        remoteField({ key: '电子版', type: 'enum', options: ['有', '没有', '不确定'] }),
        remoteField({ key: '纸质版', type: 'enum', options: ['有', '没有', '不确定'] }),
      ],
    };
    const merged = mergeSchema(DEFAULT_SCHEMA, remote);
    const keys = merged.fields.map((f) => f.key);
    expect(keys).not.toContain('电子版');
    expect(keys).not.toContain('纸质版');
    expect(keys.filter((k) => k === '拥有形态').length).toBe(1);
  });

  it('远端非法类型回落到内置类型（历史遗留的 "季节"）', () => {
    const remote: Partial<Schema> = {
      fields: [remoteField({ key: '季节', type: '季节' as never })],
    };
    const merged = mergeSchema(DEFAULT_SCHEMA, remote);
    expect(merged.fields.find((f) => f.key === '季节')!.type).toBe('enum');
  });

  it('远端选项集覆盖内置（品牌 / 款式）', () => {
    const remote: Partial<Schema> = {
      fields: [remoteField({ key: '品牌', type: 'enum', options: ['品牌甲', '品牌乙'] })],
    };
    const merged = mergeSchema(DEFAULT_SCHEMA, remote);
    expect(merged.fields.find((f) => f.key === '品牌')!.options).toEqual(['品牌甲', '品牌乙']);
  });

  it('远端新增字段被追加', () => {
    const remote: Partial<Schema> = {
      fields: [remoteField({ key: '自定义字段', type: 'text' })],
    };
    const merged = mergeSchema(DEFAULT_SCHEMA, remote);
    expect(merged.fields.map((f) => f.key)).toContain('自定义字段');
  });

  it('schemaVersion 以当前代码为准（不被远端写低）', () => {
    const remote: Partial<Schema> = { schemaVersion: 1, fields: [remoteField({ key: '名称' })] };
    expect(mergeSchema(DEFAULT_SCHEMA, remote).schemaVersion).toBe(5);
  });

  it('远端 schemaVersion 更高时也不采纳（避免把版本号写低）', () => {
    const remote: Partial<Schema> = { schemaVersion: 99, fields: [remoteField({ key: '名称' })] };
    expect(mergeSchema(DEFAULT_SCHEMA, remote).schemaVersion).toBe(DEFAULT_SCHEMA.schemaVersion);
  });
});

describe('旧取值剔除', () => {
  it('分类的「通用」被剔除', () => {
    expect(stripLegacyOptions('分类', ['女装', '通用', '男装'])).toEqual(['女装', '男装']);
  });

  it('其它字段不受影响', () => {
    expect(stripLegacyOptions('品牌', ['通用'])).toEqual(['通用']);
  });
});
