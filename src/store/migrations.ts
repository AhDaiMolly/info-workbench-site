/**
 * 信息汇总工作台 · 结构版本迁移与写回前校验（架构 3.5）
 *
 * 规则：
 *   1. 只向前兼容——schemaVersion 落后时按字段补默认值，不做破坏性转换
 *   2. 只做加法迁移——只新增字段/选项，禁止重命名或删除既有字段
 *   3. 迁移函数是纯函数，可单测、可重放
 *   4. 写回前校验，不通过则拒绝写回并给出具体字段错误
 *   5. 读到更高 schemaVersion 时进入只读模式，不做降级写入
 */

import type { FieldDef, RecordItem, RecordsFile, Schema } from '../types';

export const CURRENT_SCHEMA_VERSION = 1;

/** 补齐后的默认值（新增字段的默认状态） */
function defaultsFor(field: FieldDef): unknown {
  switch (field.type) {
    case 'multi':
    case 'tags':
    case 'refs':
      return [];
    case 'boolean':
      return false;
    case 'number':
      return 0;
    default:
      return '';
  }
}

/**
 * schemaVersion 0 → 1：补齐 19 个目标字段的缺省值。
 * 纯函数：相同输入必得相同输出。
 */
export function migrate_0_to_1(records: RecordItem[], schema: Schema): RecordItem[] {
  return records.map((r) => {
    const out = { ...r } as RecordItem & Record<string, unknown>;
    for (const f of schema.fields) {
      const key = f.jsonKey;
      if (!(key in out) || out[key] === undefined || out[key] === null) {
        (out as Record<string, unknown>)[key] = defaultsFor(f);
      }
    }
    if (out.deletedAt === undefined) out.deletedAt = null;
    return out;
  });
}

const MIGRATIONS: Record<number, (records: RecordItem[], schema: Schema) => RecordItem[]> = {
  0: migrate_0_to_1,
};

export interface MigrationResult {
  records: RecordItem[];
  schemaVersion: number;
  /** true = 远端版本高于当前代码，应进入只读模式 */
  readOnly: boolean;
  changed: boolean;
}

/** 按 schemaVersion 依次执行迁移步 */
export function applyMigrations(file: RecordsFile, schema: Schema): MigrationResult {
  let version = Number(file.schemaVersion ?? 0);
  let records = file.records ?? [];
  let changed = false;

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      version += 1;
      changed = true;
      continue;
    }
    records = step(records, schema);
    version += 1;
    changed = true;
  }

  return {
    records,
    schemaVersion: version,
    readOnly: version > CURRENT_SCHEMA_VERSION,
    changed,
  };
}

/* ------------------------------ 写回前校验 ------------------------------ */

export interface ValidationIssue {
  记录ID: number;
  字段: string;
  问题: string;
}

/**
 * 写回前校验：必填、枚举合法性、多值顺序、引用完整性。
 * 返回问题清单（空数组 = 通过）。
 */
export function validateRecords(records: RecordItem[], schema: Schema): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map<number, RecordItem>();
  for (const r of records) byId.set(r.id, r);

  for (const r of records) {
    for (const f of schema.fields) {
      const key = f.jsonKey;
      const value = (r as unknown as Record<string, unknown>)[key];

      if (f.required) {
        const empty = value === undefined || value === null || value === ''
          || (Array.isArray(value) && value.length === 0);
        if (empty) {
          issues.push({ 记录ID: r.id, 字段: f.label, 问题: '必填项不能为空' });
          continue;
        }
      }

      if (f.type === 'enum' && value !== '' && value !== undefined && value !== null) {
        const opts = f.options ?? [];
        if (opts.length && !opts.includes(String(value))) {
          issues.push({ 记录ID: r.id, 字段: f.label, 问题: `取值「${String(value)}」不在选项集内` });
        }
      }

      if (f.type === 'multi' && Array.isArray(value) && f.ordered && f.options?.length) {
        const order = f.options;
        const positions = value.map((v) => order.indexOf(String(v)));
        if (positions.some((p) => p < 0)) {
          issues.push({ 记录ID: r.id, 字段: f.label, 问题: '包含不在选项集内的取值' });
        } else {
          for (let i = 1; i < positions.length; i += 1) {
            if (positions[i] < positions[i - 1]) {
              issues.push({ 记录ID: r.id, 字段: f.label, 问题: '多值顺序未按固定选项序排列' });
              break;
            }
          }
        }
      }

      if (f.type === 'refs' && Array.isArray(value)) {
        for (const ref of value) {
          const refId = typeof ref === 'number' ? ref : Number(ref);
          if (!Number.isFinite(refId) || !byId.has(refId)) {
            issues.push({ 记录ID: r.id, 字段: f.label, 问题: `关联指向不存在的记录 #${String(ref)}` });
          }
        }
      }
    }
  }
  return issues;
}

/** 新记录 ID：取当前最大值 + 1 */
export function nextRecordId(records: RecordItem[]): number {
  return records.reduce((max, r) => Math.max(max, r.id), 0) + 1;
}
