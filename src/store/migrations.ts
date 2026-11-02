/**
 * 信息汇总工作台 · 结构版本迁移与写回前校验（架构 3.5）
 *
 * 规则：
 *   1. 只向前兼容——schemaVersion 落后时按字段补默认值，不做破坏性转换
 *   2. 迁移函数是纯函数，可单测、可重放、可重复执行（幂等）
 *   3. 写回前校验，不通过则拒绝写回并给出具体字段错误
 *   4. 读到更高 schemaVersion 时进入只读模式，不做降级写入
 *
 * v3（schemaVersion 1 → 2）只做「结构性」迁移：
 *   · 「拥有电子版」（布尔）→「电子版」（枚举三态：有 / 没有 / 不确定）
 *   · 「拥有纸质版」（布尔）→「纸质版」（枚举三态）
 *   · 删除「关联」「电子版缺码」
 *
 * ⚠️ v3 不在页面侧改动「款式」「分类」的取值：
 *   「秋衣秋裤 → 打底衣」「通用 → 女装/男装/童装」属于**内容**迁移，
 *   必须先经用户逐条确认，再由数据仓迁移脚本执行（见 data/tools/migrate-v3.mjs）。
 *
 * v4（schemaVersion 2 → 3）：回收站整体移除
 *   · 旧数据里带 deletedAt 标记的记录 = 已被删除的记录 → 加载时物理移除
 *   · 其余记录清掉 deletedAt 字段（v4 的记录模型不再有软删标记）
 *   · 既有软删记录在加载时会被清掉（不可恢复，属回收站移除的既定语义）；
 *     数据仓侧另有 migrate-v4.mjs 先做归档再写回，避免静默丢弃。
 *
 * v5（schemaVersion 3 → 4）：R5「拥有形态」合并
 *   · 「电子版」「纸质版」两个枚举三态单选 → 单个多选「拥有形态」（选项：电子版 / 纸质版）
 *   · 归一映射（双射、可逆、零丢失）：
 *       有 + 有   → ['电子版', '纸质版']
 *       有 + 没有 → ['电子版']
 *       没有 + 有 → ['纸质版']
 *       没有 + 没有 → []            （皆无）
 *   · 「不确定」态随合并取消（实测 0 条在用）：映射为「不选」（该侧不计入拥有形态），
 *     原值由数据仓侧 migrate-v5.mjs 归档，不静默丢弃
 *   · 旧两键从记录里删除，「拥有形态」缺失时按上面的映射补齐（空数组）
 *   · 页面侧归一是**幂等**的：数据仓尚未迁移时，旧数据也能正常显示（写回由闸门拦住）
 *
 * ⚠️ v4 修复（同步被阻断的根因，见交付说明 v4「根因」一节）：
 *   写回校验**只针对有效记录**：
 *     · 空壳记录（名称为空）不参与校验 —— 这类记录来自最初的表格导入，
 *       不是用户录入的；把它算进必填校验会让同步永久卡死（用户无法自行修复远端文件）。
 *     · 软删记录不参与校验（v4 已无软删，保留判断仅为兼容旧缓存）。
 *   空壳记录不被静默删除，而是被识别出来交给用户一键清理（见 store 的 cleanupShellRecords）。
 */

import type { FieldDef, RecordItem, RecordsFile, Schema } from '../types';
import {
  OWNERSHIP_FORMAT_OPTIONS, OWNERSHIP_TRISTATE_OPTIONS, REMOVED_FIELD_KEYS,
  defaultValueFor, LEGACY_MULTI_VALUES, MERGED_OWNERSHIP_KEYS,
} from '../schema';

export const CURRENT_SCHEMA_VERSION = 4;

/** 旧键 → 新键（布尔改枚举） */
const LEGACY_OWNERSHIP_KEYS: Array<[string, string]> = [
  ['拥有电子版', '电子版'],
  ['拥有纸质版', '纸质版'],
];

/**
 * 把「电子版 / 纸质版」的任意取值归一为枚举三态。
 *   true → 有 ／ false → 没有 ／ '' → ''（未填，保留）／ 其它 → 不确定
 */
export function normalizeOwnershipValue(value: unknown): string {
  if (value === true) return '有';
  if (value === false) return '没有';
  const s = String(value ?? '').trim();
  if (s === '') return '';
  if (OWNERSHIP_TRISTATE_OPTIONS.includes(s)) return s;
  return '不确定';
}

/**
 * v5（R5）：把旧的两个枚举三态归一为「拥有形态」多选。
 *
 * 归一是**双射**（在「有 / 没有」两态口径下）：
 *   有   + 有   → ['电子版', '纸质版']
 *   有   + 没有 → ['电子版']
 *   没有 + 有   → ['纸质版']
 *   没有 + 没有 → []
 * 「不确定」（实测 0 条在用）→ 该侧不选；空串 / 字段缺失 → 该侧不选。
 *
 * 返回值始终按 OWNERSHIP_FORMAT_OPTIONS 的固定顺序，便于逐条比对与幂等校验。
 */
export function normalizeOwnershipFormats(
  electronic: unknown,
  paper: unknown,
): string[] {
  const out: string[] = [];
  if (String(electronic ?? '').trim() === '有') out.push('电子版');
  if (String(paper ?? '').trim() === '有') out.push('纸质版');
  return out;
}

/**
 * schemaVersion 1 → 2：字段改名（布尔 → 枚举三态）+ 删除废弃字段。
 * 纯函数且幂等：对已迁移的数据再执行一次，结果完全不变。
 */
export function migrate_1_to_2(records: RecordItem[], schema: Schema): RecordItem[] {
  return records.map((r) => {
    const out = { ...(r as unknown as Record<string, unknown>) } as Record<string, unknown>;

    for (const [oldKey, newKey] of LEGACY_OWNERSHIP_KEYS) {
      const legacy = out[oldKey];
      const current = out[newKey];
      if (legacy !== undefined) {
        // 旧数据：以旧键为准；新键已存在时以新键为准（幂等）
        out[newKey] = normalizeOwnershipValue(current !== undefined ? current : legacy);
        delete out[oldKey];
      } else if (current !== undefined) {
        out[newKey] = normalizeOwnershipValue(current);
      } else {
        // 两个键都没有 → 第三态
        out[newKey] = '不确定';
      }
    }

    // 删除废弃字段（关联 / 电子版缺码）
    for (const k of REMOVED_FIELD_KEYS) delete out[k];

    // 其余字段按 schema 补默认值（不覆盖已有值）
    for (const f of schema.fields) {
      const key = f.jsonKey;
      if (!(key in out) || out[key] === undefined || out[key] === null) {
        out[key] = defaultValueFor(f);
      }
    }
    return out as unknown as RecordItem;
  });
}

/**
 * schemaVersion 2 → 3：回收站移除。
 *
 *   · 带 deletedAt 标记的记录 = 已被用户删除的记录 → **物理移除**（v4 无回收站可恢复）
 *   · 其余记录清掉 deletedAt 字段
 *
 * 纯函数；幂等（再执行一次不会产生任何变化）。
 * ⚠️ 软删记录是「用户已删除」的数据，物理移除是回收站移除的既定语义；
 *     数据仓侧会先用 migrate-v4.mjs 归档，再写回，避免静默丢弃。
 */
export function migrate_2_to_3(records: RecordItem[], schema: Schema): RecordItem[] {
  const kept: RecordItem[] = [];
  for (const r of records) {
    const rec = r as unknown as Record<string, unknown>;
    const legacyDeletedAt = rec.deletedAt;
    // 已软删的记录：直接移除（v4 无回收站）
    if (legacyDeletedAt !== undefined && legacyDeletedAt !== null && legacyDeletedAt !== '') {
      continue;
    }
    const out = { ...rec } as Record<string, unknown>;
    delete out.deletedAt;
    for (const f of schema.fields) {
      const key = f.jsonKey;
      if (!(key in out) || out[key] === undefined || out[key] === null) {
        out[key] = defaultValueFor(f);
      }
    }
    kept.push(out as unknown as RecordItem);
  }
  return kept;
}

/**
 * schemaVersion 3 → 4：R5「拥有形态」合并。
 *
 *   · 「电子版」= 有 → 拥有形态含「电子版」；其余取值（含「不确定」/缺失）→ 不选
 *   · 「纸质版」= 有 → 拥有形态含「纸质版」；其余取值（含「不确定」/缺失）→ 不选
 *   · 旧两键从记录里删除
 *
 * 纯函数；幂等（已迁移的记录再执行一次不产生任何变化）。
 */
export function migrate_3_to_4(records: RecordItem[], schema: Schema): RecordItem[] {
  return records.map((r) => {
    const rec = r as unknown as Record<string, unknown>;
    const out = { ...rec } as Record<string, unknown>;

    const hasOldKeys = MERGED_OWNERSHIP_KEYS.some((k) => k in out);
    const current = out.拥有形态;
    const currentIsArray = Array.isArray(current);

    if (hasOldKeys || !currentIsArray) {
      // 旧键优先归一（数据仓尚未迁移时）；已是新结构且字段缺失 → 按缺省（皆无）处理
      const fromOld = normalizeOwnershipFormats(out.电子版, out.纸质版);
      const fromCurrent = currentIsArray
        ? current.map((v) => String(v)).filter((v) => OWNERSHIP_FORMAT_OPTIONS.includes(v))
        : [];
      const merged = hasOldKeys ? fromOld : fromCurrent;
      out.拥有形态 = OWNERSHIP_FORMAT_OPTIONS.filter((o) => merged.includes(o));
    }

    // 删除被合并掉的旧键
    for (const k of MERGED_OWNERSHIP_KEYS) delete out[k];

    // 其余字段按 schema 补默认值（不覆盖已有值）
    for (const f of schema.fields) {
      const key = f.jsonKey;
      if (!(key in out) || out[key] === undefined || out[key] === null) {
        out[key] = defaultValueFor(f);
      }
    }
    return out as unknown as RecordItem;
  });
}

/**
 * 结构归一（幂等）：无论文件自报的 schemaVersion 是多少，
 * 只要记录里还留着旧键/旧类型，就地修正成当前结构。
 *
 * 作用：旧数据（旧键名、旧布尔字段）加载后不会白屏、不会丢字段，
 * 也保证「数据仓还没迁移」时页面依然可用。
 *
 * v4：顺带清掉软删残留 —— 带 deletedAt 标记的记录直接移除，其余记录删掉该键。
 * v5：顺带把「电子版 / 纸质版」两个旧键归一为「拥有形态」。
 */
export function normalizeToCurrent(records: RecordItem[], schema: Schema): RecordItem[] {
  const needsShapeFix = records.some((r) => {
    const rec = r as unknown as Record<string, unknown>;
    return LEGACY_OWNERSHIP_KEYS.some(([oldKey]) => oldKey in rec)
      || REMOVED_FIELD_KEYS.some((k) => k in rec)
      || 'deletedAt' in rec
      || MERGED_OWNERSHIP_KEYS.some((k) => k in rec);
  });
  if (!needsShapeFix) return records;
  // ⚠️ 顺序：先做「改名」（1 → 2），再做「软删清理」（2 → 3），最后做「形态合并」（3 → 4）。
  // 反过来会踩坑 —— 2 → 3 会先给缺失字段补默认值，把布尔旧值盖成「不确定」，
  // 旧数据里的「拥有电子版: true」就再也还原不回「有」了；
  // 同理 3 → 4 必须排在 1 → 2 之后，否则旧布尔值会被当成「非有」丢掉。
  const renamed = migrate_1_to_2(records, schema);
  const cleaned = migrate_2_to_3(renamed, schema);
  return migrate_3_to_4(cleaned, schema);
}

const MIGRATIONS: Record<number, (records: RecordItem[], schema: Schema) => RecordItem[]> = {
  0: (records, schema) => migrate_1_to_2(records, schema),
  1: migrate_1_to_2,
  2: migrate_2_to_3,
  3: migrate_3_to_4,
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

  // 版本号自报为最新、但记录仍是旧结构时也要修正（幂等）
  const normalized = normalizeToCurrent(records, schema);
  if (normalized !== records) changed = true;
  records = normalized;

  return {
    records,
    schemaVersion: version,
    readOnly: version > CURRENT_SCHEMA_VERSION,
    changed,
  };
}

/**
 * 扫描记录里仍存在的旧字段（v3 已废弃 / 已改名的键；v5 已合并的两个形态键）。
 * 数据仓尚未执行对应迁移时，写回必须先检查这个 —— 否则会把待归档的旧数据悄悄抹掉。
 *
 * v5：命中「电子版」「纸质版」说明数据仓还没做 R5 合并迁移 —— 写回前会被拦住。
 */
export function findLegacyFieldKeys(records: RecordItem[]): string[] {
  const hits = new Set<string>();
  for (const r of records) {
    const rec = r as unknown as Record<string, unknown>;
    for (const [oldKey] of LEGACY_OWNERSHIP_KEYS) if (oldKey in rec) hits.add(oldKey);
    for (const k of MERGED_OWNERSHIP_KEYS) if (k in rec) hits.add(k);
    for (const k of REMOVED_FIELD_KEYS) if (k in rec) hits.add(k);
  }
  return [...hits];
}

/* ------------------------------ 写回前校验 ------------------------------ */

export interface ValidationIssue {
  记录ID: number;
  字段: string;
  问题: string;
}

/* --------------------------- 有效记录 / 空壳记录 --------------------------- */

/**
 * 空壳记录：名称为空的记录。
 *
 * 来源：最初的表格导入里存在「只填了品牌、名称留空」的行（如 795 号记录）。
 * 这类记录不是用户录入的，用户在界面上也从未见过它。
 *
 * ⚠️ v4 之前，validateRecords 会把它算进必填校验 → 同步被永久阻断，
 *    而用户既无法在界面上修复它，也无法删除它（它没有名称，也无从定位）。
 *    v4 起：空壳记录不参与写回校验，改为识别出来交给用户一键清理。
 */
export function isShellRecord(r: RecordItem): boolean {
  return String(r.名称 ?? '').trim() === '';
}

/** 软删残留（v3 及更早的数据里带 deletedAt 标记） */
export function isLegacyDeleted(r: RecordItem): boolean {
  const legacy = (r as unknown as Record<string, unknown>).deletedAt;
  return legacy !== undefined && legacy !== null && legacy !== '';
}

/**
 * 参与写回校验的记录 = 「有效记录」。
 *
 * 排除两类：
 *   · 空壳记录（名称为空）—— 导入遗留，用户无法自行修复，不该阻断同步
 *   · 软删记录 —— v4 已移除回收站；旧缓存里的残留不参与校验
 */
export function isValidatableRecord(r: RecordItem): boolean {
  if (isLegacyDeleted(r)) return false;
  return !isShellRecord(r);
}

/** 找出全部空壳记录（供界面提示与一键清理使用） */
export function findShellRecords(records: RecordItem[]): RecordItem[] {
  return records.filter((r) => !isLegacyDeleted(r) && isShellRecord(r));
}

/**
 * 写回前校验：必填、枚举合法性、多值顺序。
 * v3：不再有「引用（refs）」字段，关联完整性校验随之移除。
 * v4：**只校验有效记录**（排除空壳记录与软删残留），返回问题清单（空数组 = 通过）。
 */
export function validateRecords(records: RecordItem[], schema: Schema): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const r of records) {
    // v4：空壳记录 / 软删残留不参与校验（否则同步会被无法修复的脏数据永久卡死）
    if (!isValidatableRecord(r)) continue;
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
        // 旧取值（如「通用」）只做兼容容忍，不参与顺序判定，也不报错
        const legacy = LEGACY_MULTI_VALUES[f.key] ?? [];
        const unknown = value.filter((v) => !order.includes(String(v)) && !legacy.includes(String(v)));
        if (unknown.length) {
          issues.push({ 记录ID: r.id, 字段: f.label, 问题: '包含不在选项集内的取值' });
        } else {
          const positions = value
            .filter((v) => order.includes(String(v)))
            .map((v) => order.indexOf(String(v)));
          for (let i = 1; i < positions.length; i += 1) {
            if (positions[i] < positions[i - 1]) {
              issues.push({ 记录ID: r.id, 字段: f.label, 问题: '多值顺序未按固定选项序排列' });
              break;
            }
          }
        }
      }
    }
  }
  return issues;
}

/**
 * 新记录 ID：取「当前所有记录 ID」与「历史发号水位」的较大者 + 1。
 *
 * v4：v3 之前只取记录里的最大 ID。回收站移除后记录被物理删除，
 * 若只看现存记录，删掉最大号记录后新记录会**复用旧 ID**，
 * 与同步基线里的历史记录撞号（三方合并时会被判成「同一记录被改」）。
 * 因此引入持久化的发号水位（store/persist.ts 的 lastIssuedId），保证 ID 只增不复用。
 */
export function nextRecordId(records: RecordItem[], lastIssuedId = 0): number {
  const maxInRecords = records.reduce((max, r) => Math.max(max, r.id), 0);
  return Math.max(maxInRecords, lastIssuedId) + 1;
}
