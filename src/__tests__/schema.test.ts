import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ORDER, DEFAULT_SCHEMA, FIELD_DEFAULTS, OWNERSHIP_OPTIONS, REMOVED_FIELD_KEYS,
  SEASON_OPTIONS, defaultValueFor, mergeSchema, stripLegacyOptions,
} from '../schema';
import type { FieldDef, Schema } from '../types';

/**
 * v3 的 schema 侧规则：
 *   · 已删除字段（电子版缺码 / 关联）不进入 schema
 *   · 旧键（拥有电子版 / 拥有纸质版）由内置 v3 定义接管
 *   · 远端非法字段类型回落为内置类型（历史遗留的 "季节" 类型）
 *   · 旧取值「通用」不再提供
 *   · schemaVersion 以当前代码为准
 */

function remoteField(over: Partial<FieldDef> & { key: string }): FieldDef {
  return { jsonKey: over.key, type: 'text', label: over.key, ...over };
}

describe('内置 schema', () => {
  it('当前结构版本为 3（v4：回收站移除）', () => {
    expect(DEFAULT_SCHEMA.schemaVersion).toBe(3);
  });

  it('不含已删除字段', () => {
    const keys = DEFAULT_SCHEMA.fields.map((f) => f.key);
    for (const k of REMOVED_FIELD_KEYS) expect(keys).not.toContain(k);
  });

  it('不含旧键名，改用电子版 / 纸质版', () => {
    const keys = DEFAULT_SCHEMA.fields.map((f) => f.key);
    expect(keys).toContain('电子版');
    expect(keys).toContain('纸质版');
    expect(keys).not.toContain('拥有电子版');
    expect(keys).not.toContain('拥有纸质版');
  });

  it('季节为枚举单选，选项含「春秋」且不拆分', () => {
    const season = DEFAULT_SCHEMA.fields.find((f) => f.key === '季节')!;
    expect(season.type).toBe('enum');
    expect(season.options).toEqual(SEASON_OPTIONS);
    expect(SEASON_OPTIONS).toContain('春秋');
  });

  it('电子版 / 纸质版 为枚举三态', () => {
    for (const key of ['电子版', '纸质版']) {
      const f = DEFAULT_SCHEMA.fields.find((x) => x.key === key)!;
      expect(f.type).toBe('enum');
      expect(f.options).toEqual(OWNERSHIP_OPTIONS);
      expect(OWNERSHIP_OPTIONS).toEqual(['有', '没有', '不确定']);
    }
  });

  it('分类选项不再含「通用」', () => {
    expect(CATEGORY_ORDER).not.toContain('通用');
    const cat = DEFAULT_SCHEMA.fields.find((f) => f.key === '分类')!;
    expect(cat.options).not.toContain('通用');
  });
});

describe('取值默认', () => {
  it('枚举字段取显式默认值', () => {
    expect(FIELD_DEFAULTS.电子版).toBe('不确定');
    expect(FIELD_DEFAULTS.纸质版).toBe('不确定');
    expect(FIELD_DEFAULTS.教程).toBe('未知');
  });

  it('defaultValueFor 按类型给出默认', () => {
    expect(defaultValueFor({ key: '分类', jsonKey: '分类', type: 'multi', label: '分类' })).toEqual([]);
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

  it('旧键名由内置定义接管（类型不被远端覆盖）', () => {
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
    const e = merged.fields.find((f) => f.key === '电子版')!;
    expect(e.type).toBe('enum');
    expect(e.options).toEqual(OWNERSHIP_OPTIONS);
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
    expect(mergeSchema(DEFAULT_SCHEMA, remote).schemaVersion).toBe(3);
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