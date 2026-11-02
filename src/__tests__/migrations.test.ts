import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION, applyMigrations, migrate_0_to_1, nextRecordId, validateRecords,
} from '../store/migrations';
import { DEFAULT_SCHEMA } from '../schema';
import type { RecordItem, Schema } from '../types';

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

describe('结构版本迁移', () => {
  it('补齐缺失字段的默认值（加法迁移）', () => {
    const partial = { id: 1, 名称: '条目一' } as unknown as RecordItem;
    const out = migrate_0_to_1([partial], DEFAULT_SCHEMA);
    expect(out[0].分类).toEqual([]);
    expect(out[0].纸质版尺码).toEqual([]);
    expect(out[0].关联).toEqual([]);
    expect(out[0].拥有电子版).toBe(false);
    expect(out[0].品牌).toBe('');
    expect(out[0].deletedAt).toBeNull();
    expect(out[0].名称).toBe('条目一');
  });

  it('不覆盖已有取值', () => {
    const rec = makeRecord({ id: 1, 品牌: '品牌乙', 拥有电子版: true });
    const out = migrate_0_to_1([rec], DEFAULT_SCHEMA);
    expect(out[0].品牌).toBe('品牌乙');
    expect(out[0].拥有电子版).toBe(true);
  });

  it('迁移是纯函数：两次执行结果一致', () => {
    const rec = makeRecord({ id: 1 });
    const a = migrate_0_to_1([rec], DEFAULT_SCHEMA);
    const b = migrate_0_to_1([rec], DEFAULT_SCHEMA);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('schemaVersion 0 → 当前版本标记 changed', () => {
    const res = applyMigrations({ schemaVersion: 0, dataVersion: 1, updatedAt: '', records: [makeRecord({ id: 1 })] }, DEFAULT_SCHEMA);
    expect(res.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(res.changed).toBe(true);
    expect(res.readOnly).toBe(false);
  });

  it('已是当前版本则不触发迁移', () => {
    const res = applyMigrations({ schemaVersion: CURRENT_SCHEMA_VERSION, dataVersion: 1, updatedAt: '', records: [] }, DEFAULT_SCHEMA);
    expect(res.changed).toBe(false);
    expect(res.readOnly).toBe(false);
  });

  it('远端版本更高 → 只读模式', () => {
    const res = applyMigrations({ schemaVersion: CURRENT_SCHEMA_VERSION + 1, dataVersion: 1, updatedAt: '', records: [] }, DEFAULT_SCHEMA);
    expect(res.readOnly).toBe(true);
  });
});

describe('写回前校验', () => {
  it('正常数据无问题', () => {
    expect(validateRecords([makeRecord({ id: 1 })], DEFAULT_SCHEMA).length).toBe(0);
  });

  it('必填项为空时报错', () => {
    const issues = validateRecords([makeRecord({ id: 1, 名称: '' })], DEFAULT_SCHEMA);
    expect(issues.length).toBe(1);
    expect(issues[0].字段).toBe('名称');
    expect(issues[0].问题).toContain('必填');
  });

  it('枚举取值不在选项集内时报错', () => {
    const issues = validateRecords([makeRecord({ id: 1, 季节: '雨季' })], DEFAULT_SCHEMA);
    expect(issues.some((i) => i.字段 === '季节')).toBe(true);
  });

  it('多值顺序不符合固定选项序时报错', () => {
    const issues = validateRecords([makeRecord({ id: 1, 分类: ['男装', '女装'] })], DEFAULT_SCHEMA);
    expect(issues.some((i) => i.字段 === '分类' && i.问题.includes('顺序'))).toBe(true);
  });

  it('多值顺序正确时通过', () => {
    const issues = validateRecords([makeRecord({ id: 1, 分类: ['女装', '男装'] })], DEFAULT_SCHEMA);
    expect(issues.length).toBe(0);
  });

  it('关联指向不存在的记录时报错', () => {
    const issues = validateRecords([makeRecord({ id: 1, 关联: [999] })], DEFAULT_SCHEMA);
    expect(issues.some((i) => i.字段 === '关联')).toBe(true);
  });

  it('关联指向存在的记录时通过', () => {
    const recs = [makeRecord({ id: 1, 关联: [2] }), makeRecord({ id: 2 })];
    expect(validateRecords(recs, DEFAULT_SCHEMA).length).toBe(0);
  });

  it('选项集为空时不做枚举校验（品牌/款式选项来自数据仓）', () => {
    const schema: Schema = { ...DEFAULT_SCHEMA };
    const issues = validateRecords([makeRecord({ id: 1, 品牌: '任意值' })], schema);
    expect(issues.length).toBe(0);
  });
});

describe('新记录 ID 分配', () => {
  it('取最大 ID + 1', () => {
    expect(nextRecordId([makeRecord({ id: 1 }), makeRecord({ id: 8 })])).toBe(9);
  });

  it('空集合从 1 开始', () => {
    expect(nextRecordId([])).toBe(1);
  });
});
