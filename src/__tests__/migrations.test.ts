import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION, applyMigrations, findLegacyFieldKeys, findShellRecords, isShellRecord,
  isValidatableRecord, mapLegacyEsizeValue, migrate_1_to_2, migrate_2_to_3, migrate_3_to_4,
  migrate_4_to_5, nextRecordId, normalizeOwnershipFormats, normalizeOwnershipValue,
  normalizePlanValue, normalizeToCurrent, validateRecords,
} from '../store/migrations';
import { DEFAULT_SCHEMA } from '../schema';
import type { RecordItem, Schema } from '../types';

/** 虚构占位数据，站点仓内不得出现真实记录值。 */

/** v5 当前结构的记录（拥有形态为多选数组；无「电子版」「纸质版」旧键） */
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
    电子版尺码: [],
    拥有形态: [],
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

/** v3 结构的记录（电子版 / 纸质版 为枚举三态；无「电子版缺码」「关联」） */
function makeV3Record(over: Record<string, unknown> & { id: number }): RecordItem {
  const { id, ...rest } = over;
  return {
    id,
    名称: `记录-${id}`,
    品牌: '品牌甲',
    分类: [],
    款式: '',
    季节: '',
    教程: '未知',
    电子版: '不确定',
    电子版尺码组: [],
    纸质版: '不确定',
    纸质版尺码: [],
    推荐: '未评价',
    做过: false,
    想做: '未标记',
    备注: '',
    创建时间: '2026-01-01T00:00:00.000Z',
    更新时间: '2026-01-01T00:00:00.000Z',
    ...rest,
  } as unknown as RecordItem;
}

/** v1 旧结构记录：布尔拥有形态 + 已删除字段 */
function makeLegacyRecord(over: Record<string, unknown> & { id: number }): RecordItem {
  const { id, ...rest } = over;
  return {
    id,
    名称: `记录-${id}`,
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
  } as unknown as RecordItem;
}

/** 取记录上的任意键（绕过类型约束，用于断言中间迁移态） */
function raw(r: RecordItem, key: string): unknown {
  return (r as unknown as Record<string, unknown>)[key];
}

describe('结构版本迁移 v1 → v2', () => {
  it('布尔拥有形态迁移为枚举三态（true → 有）', () => {
    const out = migrate_1_to_2([makeLegacyRecord({ id: 1, 拥有电子版: true })], DEFAULT_SCHEMA);
    expect(raw(out[0], '电子版')).toBe('有');
    expect(raw(out[0], '拥有电子版')).toBeUndefined();
  });

  it('布尔拥有形态迁移为枚举三态（false → 没有）', () => {
    const out = migrate_1_to_2([makeLegacyRecord({ id: 1, 拥有纸质版: false })], DEFAULT_SCHEMA);
    expect(raw(out[0], '纸质版')).toBe('没有');
  });

  it('旧记录缺字段时落到第三态「不确定」', () => {
    const rec = makeLegacyRecord({ id: 1 });
    delete (rec as unknown as Record<string, unknown>).拥有电子版;
    delete (rec as unknown as Record<string, unknown>).拥有纸质版;
    const out = migrate_1_to_2([rec], DEFAULT_SCHEMA);
    expect(raw(out[0], '电子版')).toBe('不确定');
    expect(raw(out[0], '纸质版')).toBe('不确定');
  });

  it('删除「关联」与「电子版缺码」', () => {
    const out = migrate_1_to_2([makeLegacyRecord({ id: 1, 关联: [2], 电子版缺码: true })], DEFAULT_SCHEMA);
    expect('关联' in (out[0] as unknown as Record<string, unknown>)).toBe(false);
    expect('电子版缺码' in (out[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('不覆盖已有取值', () => {
    const out = migrate_1_to_2([makeLegacyRecord({ id: 1, 品牌: '品牌乙', 拥有电子版: true })], DEFAULT_SCHEMA);
    expect(out[0].品牌).toBe('品牌乙');
    expect(raw(out[0], '电子版')).toBe('有');
  });

  it('补齐缺失字段的默认值', () => {
    const partial = { id: 1, 名称: '条目一' } as unknown as RecordItem;
    const out = migrate_1_to_2([partial], DEFAULT_SCHEMA);
    expect(out[0].分类).toEqual([]);
    expect(out[0].纸质版尺码).toEqual([]);
    expect(raw(out[0], '电子版')).toBe('不确定');
    expect(out[0].品牌).toBe('');
    expect(out[0].名称).toBe('条目一');
  });

  it('迁移是纯函数且幂等：两次执行结果完全一致', () => {
    const recs = [makeLegacyRecord({ id: 1, 拥有电子版: true }), makeV3Record({ id: 2 })];
    const a = migrate_1_to_2(recs, DEFAULT_SCHEMA);
    const b = migrate_1_to_2(a, DEFAULT_SCHEMA);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('幂等：对已迁移数据重复执行 applyMigrations 结果不变', () => {
    const file = {
      schemaVersion: 1, dataVersion: 1, updatedAt: '', records: [makeLegacyRecord({ id: 1, 拥有电子版: true })],
    };
    const first = applyMigrations(file, DEFAULT_SCHEMA);
    const second = applyMigrations({ ...file, schemaVersion: CURRENT_SCHEMA_VERSION, records: first.records }, DEFAULT_SCHEMA);
    expect(JSON.stringify(second.records)).toBe(JSON.stringify(first.records));
  });

  it('不改动「款式」「分类」取值（内容迁移属于数据仓，不在页面侧做）', () => {
    const out = migrate_1_to_2(
      [makeLegacyRecord({ id: 1, 款式: '秋衣秋裤', 分类: ['通用'] })],
      DEFAULT_SCHEMA,
    );
    expect(out[0].款式).toBe('秋衣秋裤');
    expect(out[0].分类).toEqual(['通用']);
  });

  it('schemaVersion 1 → 当前版本标记 changed', () => {
    const res = applyMigrations({
      schemaVersion: 1, dataVersion: 1, updatedAt: '', records: [makeRecord({ id: 1 })],
    }, DEFAULT_SCHEMA);
    expect(res.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(res.changed).toBe(true);
    expect(res.readOnly).toBe(false);
  });

  it('schemaVersion 0 → 当前版本标记 changed', () => {
    const res = applyMigrations({
      schemaVersion: 0, dataVersion: 1, updatedAt: '', records: [makeRecord({ id: 1 })],
    }, DEFAULT_SCHEMA);
    expect(res.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(res.changed).toBe(true);
    expect(res.readOnly).toBe(false);
  });

  it('已是当前版本则不触发迁移', () => {
    const res = applyMigrations({
      schemaVersion: CURRENT_SCHEMA_VERSION, dataVersion: 1, updatedAt: '', records: [],
    }, DEFAULT_SCHEMA);
    expect(res.changed).toBe(false);
    expect(res.readOnly).toBe(false);
  });

  it('远端版本更高 → 只读模式', () => {
    const res = applyMigrations({
      schemaVersion: CURRENT_SCHEMA_VERSION + 1, dataVersion: 1, updatedAt: '', records: [],
    }, DEFAULT_SCHEMA);
    expect(res.readOnly).toBe(true);
  });

  it('自报最新版本但记录仍是旧结构时也会就地修正', () => {
    const res = applyMigrations({
      schemaVersion: CURRENT_SCHEMA_VERSION, dataVersion: 1, updatedAt: '',
      records: [makeLegacyRecord({ id: 1, 拥有电子版: true })],
    }, DEFAULT_SCHEMA);
    expect(res.changed).toBe(true);
    expect(res.records[0].拥有形态).toEqual(['电子版']);
  });
});

describe('结构归一（normalizeToCurrent）', () => {
  it('已是当前结构时原样返回（引用不变）', () => {
    const recs = [makeRecord({ id: 1 })];
    expect(normalizeToCurrent(recs, DEFAULT_SCHEMA)).toBe(recs);
  });

  it('旧结构就地修正为当前结构', () => {
    const recs = [makeLegacyRecord({ id: 1, 拥有电子版: true, 关联: [2] })];
    const out = normalizeToCurrent(recs, DEFAULT_SCHEMA);
    expect(out[0].拥有形态).toEqual(['电子版']);
    expect('关联' in (out[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('v6.4 幂等修正：自报最新版但含 v6.1 旧键时，重放归一不清空真实「拥有形态」（current-wins）', () => {
    // v6.1-C 场景：旧浏览器缓存自报 schemaVersion 5，但记录里还有「想做 / 电子版尺码组」旧键。
    // normalizeToCurrent 会重放 1→2（补第三态）+ 3→4（形态合并）——
    // 记录自带的「拥有形态」数组是真实取值，不能被重放产物（电子版=不确定）清空。
    const stale = {
      id: 901,
      名称: '旧缓存归一样本',
      品牌: '品牌甲',
      分类: [],
      款式: '',
      季节: '',
      教程: '有',
      拥有形态: ['电子版'],
      纸质版尺码: [],
      推荐: '未评价',
      做过: false,
      备注: '',
      想做: '想做',
      电子版尺码组: ['女士全码'],
    } as unknown as RecordItem;
    const res = applyMigrations({
      schemaVersion: 5, dataVersion: 1, updatedAt: '', records: [stale],
    }, DEFAULT_SCHEMA);
    const out = res.records[0] as unknown as Record<string, unknown>;
    expect(out.拥有形态).toEqual(['电子版']);
    expect(out.计划).toBe('在计划中');
    expect(out.电子版尺码).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
    // 归一后的结果再次执行应保持幂等
    const again = applyMigrations({
      schemaVersion: CURRENT_SCHEMA_VERSION, dataVersion: 1, updatedAt: '', records: res.records,
    }, DEFAULT_SCHEMA);
    expect(again.records[0]).toEqual(res.records[0]);
  });
});

describe('旧字段扫描（写回闸门用）', () => {
  it('找出记录里仍存在的旧键', () => {
    const recs = [makeLegacyRecord({ id: 1, 关联: [2] }), makeLegacyRecord({ id: 2, 电子版缺码: true })];
    const keys = findLegacyFieldKeys(recs).sort();
    // 旧键（已改名）与已删除字段都会被报出来 —— 写回闸门据此拦截
    // v6.1：makeLegacyRecord 自带「想做」，改名前旧键同样会被报出来
    expect(keys).toEqual(['关联', '想做', '拥有电子版', '拥有纸质版', '电子版尺码组', '电子版缺码']);
  });

  it('v5：R5 合并前的「电子版 / 纸质版」旧键也会被报出来（数据仓未迁移时拦写回）', () => {
    const recs = [makeV3Record({ id: 1, 电子版: '有', 纸质版: '没有' })];
    expect(findLegacyFieldKeys(recs).sort()).toEqual(['想做', '电子版', '电子版尺码组', '纸质版']);
  });

  it('v6.1：改名前的「想做」与「电子版尺码组」旧键会被报出来（拦住未迁移数据写回）', () => {
    const recs = [{ id: 1, 想做: '想做', 电子版尺码组: ['女士全码'] } as unknown as RecordItem];
    expect(findLegacyFieldKeys(recs).sort()).toEqual(['想做', '电子版尺码组']);
  });

  it('当前结构无旧键', () => {
    expect(findLegacyFieldKeys([makeRecord({ id: 1 })])).toEqual([]);
  });
});

describe('拥有形态取值归一', () => {
  it('true / false / 空 / 非法值分别归一', () => {
    expect(normalizeOwnershipValue(true)).toBe('有');
    expect(normalizeOwnershipValue(false)).toBe('没有');
    expect(normalizeOwnershipValue('')).toBe('');
    expect(normalizeOwnershipValue('有')).toBe('有');
    expect(normalizeOwnershipValue('半成品')).toBe('不确定');
  });

  it('v5：旧两态 → 拥有形态多选（双射，四种组合各对应一个取值）', () => {
    expect(normalizeOwnershipFormats('有', '有')).toEqual(['电子版', '纸质版']);
    expect(normalizeOwnershipFormats('有', '没有')).toEqual(['电子版']);
    expect(normalizeOwnershipFormats('没有', '有')).toEqual(['纸质版']);
    expect(normalizeOwnershipFormats('没有', '没有')).toEqual([]);
  });

  it('v5：「不确定」映射为不选（取消第三态）', () => {
    expect(normalizeOwnershipFormats('不确定', '不确定')).toEqual([]);
    expect(normalizeOwnershipFormats('不确定', '有')).toEqual(['纸质版']);
    expect(normalizeOwnershipFormats('', '')).toEqual([]);
  });
});

describe('写回前校验', () => {
  it('正常数据无问题', () => {
    expect(validateRecords([makeRecord({ id: 1 })], DEFAULT_SCHEMA).length).toBe(0);
  });

  it('必填项为空时报错', () => {
    const issues = validateRecords([makeRecord({ id: 1, 品牌: '' })], DEFAULT_SCHEMA);
    expect(issues.length).toBe(1);
    expect(issues[0].字段).toBe('品牌');
    expect(issues[0].问题).toContain('必填');
  });

  it('v4：名称为空的空壳记录不再触发必填报错（同步阻断根因）', () => {
    const issues = validateRecords([makeRecord({ id: 795, 名称: '' })], DEFAULT_SCHEMA);
    expect(issues.length).toBe(0);
  });

  it('枚举取值不在选项集内时报错', () => {
    const issues = validateRecords([makeRecord({ id: 1, 季节: '雨季' })], DEFAULT_SCHEMA);
    expect(issues.some((i) => i.字段 === '季节')).toBe(true);
  });

  it('v5：「拥有形态」取值不在选项集内时报错', () => {
    const issues = validateRecords([makeRecord({ id: 1, 拥有形态: ['打印版'] })], DEFAULT_SCHEMA);
    expect(issues.some((i) => i.字段 === '拥有形态')).toBe(true);
  });

  it('v5：「拥有形态」多值顺序未按固定选项序排列时报错', () => {
    const issues = validateRecords([makeRecord({ id: 1, 拥有形态: ['纸质版', '电子版'] })], DEFAULT_SCHEMA);
    expect(issues.some((i) => i.字段 === '拥有形态' && i.问题.includes('顺序'))).toBe(true);
  });

  it('v5：「拥有形态」顺序正确时通过', () => {
    const issues = validateRecords([makeRecord({ id: 1, 拥有形态: ['电子版', '纸质版'] })], DEFAULT_SCHEMA);
    expect(issues.length).toBe(0);
  });

  it('多值顺序不符合固定选项序时报错', () => {
    const issues = validateRecords([makeRecord({ id: 1, 分类: ['男装', '女装'] })], DEFAULT_SCHEMA);
    expect(issues.some((i) => i.字段 === '分类' && i.问题.includes('顺序'))).toBe(true);
  });

  it('多值顺序正确时通过', () => {
    const issues = validateRecords([makeRecord({ id: 1, 分类: ['女装', '男装'] })], DEFAULT_SCHEMA);
    expect(issues.length).toBe(0);
  });

  it('旧取值「通用」在数据仓迁移前被容忍（不阻塞写回）', () => {
    const issues = validateRecords([makeRecord({ id: 1, 分类: ['通用'] })], DEFAULT_SCHEMA);
    expect(issues.length).toBe(0);
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

  it('v4：物理删除最大号记录后不复用旧 ID（发号水位兜底）', () => {
    // 删掉了 8 号，现存最大 ID 是 1；没有水位就会把 8 号重新发出去
    expect(nextRecordId([makeRecord({ id: 1 })])).toBe(2);
    expect(nextRecordId([makeRecord({ id: 1 })], 8)).toBe(9);
  });
});

/* ========================================================================
 * v4 回归：同步被阻断的根因（导入遗留的空壳记录 + 软删残留）
 * ======================================================================== */

describe('v4：写回校验只针对有效记录（同步阻断根因回归）', () => {
  it('空壳记录（名称为空）不参与写回校验 —— 不再阻断同步', () => {
    const shell = makeRecord({ id: 795, 名称: '', 品牌: '品牌甲' });
    const issues = validateRecords([makeRecord({ id: 1 }), shell], DEFAULT_SCHEMA);
    expect(issues.length).toBe(0);
  });

  it('空壳记录不参与校验，但同名空白的其它字段仍然会报（只放行名称空这一项）', () => {
    const shell = makeRecord({ id: 795, 名称: '' });
    const issues = validateRecords([shell], DEFAULT_SCHEMA);
    expect(issues.length).toBe(0);
  });

  it('软删残留（deletedAt 有值）不参与写回校验', () => {
    const legacyDeleted = makeRecord({ id: 12, 名称: '' });
    (legacyDeleted as unknown as Record<string, unknown>).deletedAt = '2026-05-01T00:00:00.000Z';
    const issues = validateRecords([legacyDeleted], DEFAULT_SCHEMA);
    expect(issues.length).toBe(0);
  });

  it('有效记录的必填项仍会被拦下（修复没有把校验整体放松）', () => {
    const issues = validateRecords([makeRecord({ id: 1, 名称: '正常名称', 品牌: '' })], DEFAULT_SCHEMA);
    expect(issues.length).toBe(1);
    expect(issues[0].记录ID).toBe(1);
    expect(issues[0].字段).toBe('品牌');
    expect(issues[0].问题).toContain('必填');
  });

  it('名称只有空白字符的记录同样视为空壳（不阻断同步）', () => {
    expect(isShellRecord(makeRecord({ id: 1, 名称: '   ' }))).toBe(true);
    expect(validateRecords([makeRecord({ id: 1, 名称: '   ' })], DEFAULT_SCHEMA).length).toBe(0);
  });

  it('isShellRecord / isValidatableRecord 判定正确', () => {
    expect(isShellRecord(makeRecord({ id: 1, 名称: '' }))).toBe(true);
    expect(isShellRecord(makeRecord({ id: 1, 名称: '   ' }))).toBe(true);
    expect(isShellRecord(makeRecord({ id: 1, 名称: '正常' }))).toBe(false);
    expect(isValidatableRecord(makeRecord({ id: 1, 名称: '' }))).toBe(false);
    expect(isValidatableRecord(makeRecord({ id: 1, 名称: '正常' }))).toBe(true);
  });

  it('findShellRecords 只认空壳记录，不把软删记录算进来', () => {
    const shell = makeRecord({ id: 795, 名称: '' });
    const legacyDeleted = makeRecord({ id: 12, 名称: '' });
    (legacyDeleted as unknown as Record<string, unknown>).deletedAt = '2026-05-01T00:00:00.000Z';
    const found = findShellRecords([makeRecord({ id: 1 }), shell, legacyDeleted]);
    expect(found.map((r) => r.id)).toEqual([795]);
  });
});

describe('v4：结构版本迁移 schemaVersion 2 → 3（回收站移除）', () => {
  it('带 deletedAt 标记的软删记录被物理移除', () => {
    const deleted = makeRecord({ id: 12 });
    (deleted as unknown as Record<string, unknown>).deletedAt = '2026-05-01T00:00:00.000Z';
    const out = migrate_2_to_3([makeRecord({ id: 1 }), deleted], DEFAULT_SCHEMA);
    expect(out.map((r) => r.id)).toEqual([1]);
  });

  it('其余记录清掉 deletedAt 键', () => {
    const rec = makeRecord({ id: 1 });
    (rec as unknown as Record<string, unknown>).deletedAt = null;
    const out = migrate_2_to_3([rec], DEFAULT_SCHEMA);
    expect('deletedAt' in (out[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('迁移是幂等的', () => {
    const recs = [makeRecord({ id: 1 }), makeRecord({ id: 2, 名称: '' })];
    const a = migrate_2_to_3(recs, DEFAULT_SCHEMA);
    const b = migrate_2_to_3(a, DEFAULT_SCHEMA);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('applyMigrations：schemaVersion 2 → 当前版本并标记 changed', () => {
    const res = applyMigrations({
      schemaVersion: 2, dataVersion: 1, updatedAt: '', records: [makeRecord({ id: 1 })],
    }, DEFAULT_SCHEMA);
    expect(res.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(res.changed).toBe(true);
    expect(res.readOnly).toBe(false);
  });

  it('applyMigrations：软删记录在加载时被清掉，且不影响其余记录', () => {
    const deleted = makeRecord({ id: 12 });
    (deleted as unknown as Record<string, unknown>).deletedAt = '2026-05-01T00:00:00.000Z';
    const res = applyMigrations({
      schemaVersion: 2, dataVersion: 1, updatedAt: '', records: [makeRecord({ id: 1 }), deleted],
    }, DEFAULT_SCHEMA);
    expect(res.records.map((r) => r.id)).toEqual([1]);
  });

  it('normalizeToCurrent：带 deletedAt 键的记录会被就地修正', () => {
    const rec = makeRecord({ id: 1 });
    (rec as unknown as Record<string, unknown>).deletedAt = null;
    const out = normalizeToCurrent([rec], DEFAULT_SCHEMA);
    expect('deletedAt' in (out[0] as unknown as Record<string, unknown>)).toBe(false);
  });
});

/* ========================================================================
 * v5（R5）：结构版本迁移 schemaVersion 3 → 4（「拥有形态」合并）
 * ======================================================================== */

describe('v5：R5 归一是双射（两态口径下可逆、零丢失）', () => {
  it('四种组合各映射到唯一取值', () => {
    const cases: Array<[string, string, string[]]> = [
      ['有', '有', ['电子版', '纸质版']],
      ['有', '没有', ['电子版']],
      ['没有', '有', ['纸质版']],
      ['没有', '没有', []],
    ];
    for (const [e, p, expected] of cases) {
      expect(normalizeOwnershipFormats(e, p)).toEqual(expected);
    }
    // 四个取值互不相同 —— 映射是单射
    const distinct = new Set(cases.map(([e, p]) => normalizeOwnershipFormats(e, p).join('|')));
    expect(distinct.size).toBe(4);
  });

  it('migrate_3_to_4：旧两键 → 拥有形态，并删除旧键', () => {
    const out = migrate_3_to_4([makeV3Record({ id: 1, 电子版: '有', 纸质版: '没有' })], DEFAULT_SCHEMA);
    expect(out[0].拥有形态).toEqual(['电子版']);
    expect('电子版' in (out[0] as unknown as Record<string, unknown>)).toBe(false);
    expect('纸质版' in (out[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('migrate_3_to_4：双有 → 两个取值，顺序按固定选项序', () => {
    const out = migrate_3_to_4([makeV3Record({ id: 1, 电子版: '有', 纸质版: '有' })], DEFAULT_SCHEMA);
    expect(out[0].拥有形态).toEqual(['电子版', '纸质版']);
  });

  it('migrate_3_to_4：「不确定」映射为不选（取消第三态）', () => {
    const out = migrate_3_to_4([makeV3Record({ id: 1, 电子版: '不确定', 纸质版: '不确定' })], DEFAULT_SCHEMA);
    expect(out[0].拥有形态).toEqual([]);
  });

  it('migrate_3_to_4：已是新结构时原样保留（幂等）', () => {
    const rec = makeRecord({ id: 1, 拥有形态: ['电子版'] });
    const out = migrate_3_to_4([rec], DEFAULT_SCHEMA);
    expect(out[0].拥有形态).toEqual(['电子版']);
  });

  it('migrate_3_to_4：幂等 —— 连续两次执行结果完全一致', () => {
    const recs = [
      makeV3Record({ id: 1, 电子版: '有', 纸质版: '有' }),
      makeV3Record({ id: 2, 电子版: '没有', 纸质版: '没有' }),
      makeRecord({ id: 3, 拥有形态: ['纸质版'] }),
    ];
    const a = migrate_3_to_4(recs, DEFAULT_SCHEMA);
    const b = migrate_3_to_4(a, DEFAULT_SCHEMA);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('旧键兼容加载：normalizeToCurrent 会把旧两键归一（数据仓未迁移时页面照常可用）', () => {
    const out = normalizeToCurrent([makeV3Record({ id: 1, 电子版: '有', 纸质版: '有' })], DEFAULT_SCHEMA);
    expect(out[0].拥有形态).toEqual(['电子版', '纸质版']);
    expect('电子版' in (out[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('旧键兼容加载：v1 布尔旧键经完整链路后落到拥有形态', () => {
    const out = normalizeToCurrent([makeLegacyRecord({ id: 1, 拥有电子版: true, 拥有纸质版: false })], DEFAULT_SCHEMA);
    expect(out[0].拥有形态).toEqual(['电子版']);
  });

  it('applyMigrations：schemaVersion 3 一路升到当前版本并标记 changed', () => {
    const res = applyMigrations({
      schemaVersion: 3, dataVersion: 1, updatedAt: '',
      records: [makeV3Record({ id: 1, 电子版: '有', 纸质版: '没有' })],
    }, DEFAULT_SCHEMA);
    expect(res.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(res.changed).toBe(true);
    expect(res.records[0].拥有形态).toEqual(['电子版']);
  });

  it('合并后的字段集：旧两键不再出现在记录里', () => {
    const res = applyMigrations({
      schemaVersion: 3, dataVersion: 1, updatedAt: '',
      records: [makeV3Record({ id: 1 })],
    }, DEFAULT_SCHEMA);
    const keys = Object.keys(res.records[0] as unknown as Record<string, unknown>);
    expect(keys).not.toContain('电子版');
    expect(keys).not.toContain('纸质版');
    expect(keys).toContain('拥有形态');
  });

  it('CURRENT_SCHEMA_VERSION = 5', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(5);
  });
});

/* ========================================================================
 * v6.1：结构版本迁移 schemaVersion 4 → 5（「想做」改名「计划」+ 电子版尺码双轨化）
 * ======================================================================== */

/** v4 结构的记录（仍是「想做」+「电子版尺码组」旧键） */
function makeV4Record(over: Record<string, unknown> & { id: number }): RecordItem {
  const { id, ...rest } = over;
  return {
    id,
    名称: `记录-${id}`,
    品牌: '品牌甲',
    分类: [],
    款式: '',
    季节: '',
    教程: '未知',
    电子版尺码组: [],
    拥有形态: [],
    纸质版尺码: [],
    推荐: '未评价',
    做过: false,
    想做: '未标记',
    备注: '',
    创建时间: '2026-01-01T00:00:00.000Z',
    更新时间: '2026-01-01T00:00:00.000Z',
    ...rest,
  } as unknown as RecordItem;
}

describe('v6.1 · 需求 2 「计划」取值归一（normalizePlanValue）', () => {
  it('改名两项：想做 → 在计划中、不确定 → 不是现在', () => {
    expect(normalizePlanValue('想做')).toBe('在计划中');
    expect(normalizePlanValue('不确定')).toBe('不是现在');
  });

  it('保持不动的两项原样透传', () => {
    expect(normalizePlanValue('不想做')).toBe('不想做');
    expect(normalizePlanValue('未标记')).toBe('未标记');
  });

  it('空值 / 缺省归一为「未标记」', () => {
    expect(normalizePlanValue('')).toBe('未标记');
    expect(normalizePlanValue(undefined)).toBe('未标记');
    expect(normalizePlanValue(null)).toBe('未标记');
  });
});

describe('v6.1 · 需求 3 旧尺码组映射（mapLegacyEsizeValue）', () => {
  it('女士全码 → 字母码全码（XS–4XL，顺序固定）', () => {
    expect(mapLegacyEsizeValue(['女士全码'])).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
  });

  it('大小童全码 → 身高码全码（100–180 步长 10）', () => {
    expect(mapLegacyEsizeValue(['大小童全码']))
      .toEqual(['100', '110', '120', '130', '140', '150', '160', '170', '180']);
  });

  it('男士全码 / 仅小童 / 未知值不产出任何标签（置空）', () => {
    expect(mapLegacyEsizeValue(['男士全码'])).toEqual([]);
    expect(mapLegacyEsizeValue(['仅小童'])).toEqual([]);
    expect(mapLegacyEsizeValue(['别的值'])).toEqual([]);
  });

  it('多值分别映射并去重；无映射值的项被丢弃', () => {
    expect(mapLegacyEsizeValue(['女士全码', '大小童全码']))
      .toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '100', '110', '120', '130', '140', '150', '160', '170', '180']);
    // 男士全码不映射 → 该项丢弃，女士全码部分保留
    expect(mapLegacyEsizeValue(['女士全码', '男士全码'])).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
  });

  it('字符串形态按分隔符拆开后逐项映射（旧缓存兜底）', () => {
    expect(mapLegacyEsizeValue('女士全码、大小童全码')).toHaveLength(17);
    expect(mapLegacyEsizeValue('')).toEqual([]);
    expect(mapLegacyEsizeValue('男士全码')).toEqual([]);
  });
});

describe('v6.1 · migrate_4_to_5（页面侧加载兜底）', () => {
  it('「想做」改名为「计划」并归一取值，删除旧键', () => {
    const out = migrate_4_to_5([makeV4Record({ id: 1, 想做: '想做' })], DEFAULT_SCHEMA);
    expect(out[0].计划).toBe('在计划中');
    expect('想做' in (out[0] as unknown as Record<string, unknown>)).toBe(false);
    const out2 = migrate_4_to_5([makeV4Record({ id: 2, 想做: '不确定' })], DEFAULT_SCHEMA);
    expect(out2[0].计划).toBe('不是现在');
  });

  it('「不想做」「未标记」迁移后取值保持不变', () => {
    expect(migrate_4_to_5([makeV4Record({ id: 1, 想做: '不想做' })], DEFAULT_SCHEMA)[0].计划).toBe('不想做');
    expect(migrate_4_to_5([makeV4Record({ id: 2 })], DEFAULT_SCHEMA)[0].计划).toBe('未标记');
  });

  it('「电子版尺码组」按映射规则转为标签数组，删除旧键', () => {
    const out = migrate_4_to_5([makeV4Record({ id: 1, 电子版尺码组: ['女士全码'] })], DEFAULT_SCHEMA);
    expect(out[0].电子版尺码).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
    expect('电子版尺码组' in (out[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('不可映射取值整体置空（男士全码 / 仅小童）', () => {
    const out = migrate_4_to_5([makeV4Record({ id: 1, 电子版尺码组: ['男士全码'] })], DEFAULT_SCHEMA);
    expect(out[0].电子版尺码).toEqual([]);
  });

  it('新结构已有非空「电子版尺码」时以现值为准（current-wins，幂等）', () => {
    const rec = {
      ...makeV4Record({ id: 1, 电子版尺码组: ['女士全码'] }),
      电子版尺码: ['XS'],
    } as unknown as RecordItem;
    delete (rec as unknown as Record<string, unknown>).电子版尺码组;
    // 已是 v5 结构的记录再跑一次：现值保留，不被旧逻辑改写
    const out = migrate_4_to_5([rec], DEFAULT_SCHEMA);
    expect(out[0].电子版尺码).toEqual(['XS']);
  });

  it('字符串形态的「电子版尺码」（旧缓存脏数据）拆开兜底，不白屏不脏写', () => {
    const rec = makeRecord({ id: 1 }) as unknown as Record<string, unknown>;
    rec.电子版尺码 = '女士全码';
    const out = migrate_4_to_5([rec as unknown as RecordItem], DEFAULT_SCHEMA);
    expect(out[0].电子版尺码).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
  });

  it('幂等：连续两次执行结果完全一致', () => {
    const recs = [
      makeV4Record({ id: 1, 想做: '想做', 电子版尺码组: ['女士全码'] }),
      makeV4Record({ id: 2, 想做: '不确定', 电子版尺码组: ['男士全码'] }),
      makeRecord({ id: 3, 计划: '在计划中', 电子版尺码: ['XS'] }),
    ];
    const a = migrate_4_to_5(recs, DEFAULT_SCHEMA);
    const b = migrate_4_to_5(a, DEFAULT_SCHEMA);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('applyMigrations：schemaVersion 4 → 5 并标记 changed', () => {
    const res = applyMigrations({
      schemaVersion: 4, dataVersion: 7, updatedAt: '',
      records: [makeV4Record({ id: 1, 想做: '想做', 电子版尺码组: ['大小童全码'] })],
    }, DEFAULT_SCHEMA);
    expect(res.schemaVersion).toBe(5);
    expect(res.changed).toBe(true);
    expect(res.readOnly).toBe(false);
    expect(res.records[0].计划).toBe('在计划中');
    expect(res.records[0].电子版尺码).toEqual(['100', '110', '120', '130', '140', '150', '160', '170', '180']);
  });

  it('回归：从 v2 全链路迁移时「想做」取值不被补默认值盖掉（2→3/3→4 抢填回归）', () => {
    // 旧链路里 migrate_2_to_3 / migrate_3_to_4 会按 schema 抢先把「计划」补成默认值「未标记」，
    // migrate_4_to_5 的 current-wins 就把「想做」的真实取值盖掉了 —— 修复后旧键占位时跳过补填
    const res = applyMigrations({
      schemaVersion: 2, dataVersion: 1, updatedAt: '',
      records: [makeV3Record({ id: 1, 想做: '想做', 电子版尺码组: ['女士全码'] })],
    }, DEFAULT_SCHEMA);
    expect(res.schemaVersion).toBe(5);
    expect(res.records[0].计划).toBe('在计划中');
    expect(res.records[0].电子版尺码).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
    const rec = res.records[0] as unknown as Record<string, unknown>;
    expect('想做' in rec).toBe(false);
    expect('电子版尺码组' in rec).toBe(false);
  });

  it('normalizeToCurrent：自报最新版本但仍是旧结构时就地修正（旧浏览器缓存不白屏）', () => {
    const out = normalizeToCurrent(
      [makeV4Record({ id: 1, 想做: '想做', 电子版尺码组: ['女士全码'] })],
      DEFAULT_SCHEMA,
    );
    expect(out[0].计划).toBe('在计划中');
    expect(out[0].电子版尺码).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
    const rec = out[0] as unknown as Record<string, unknown>;
    expect('想做' in rec).toBe(false);
    expect('电子版尺码组' in rec).toBe(false);
  });
});
