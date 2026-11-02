/**
 * 信息汇总工作台 · 内置兜底字段定义（v3）
 *
 * ⚠️ 安全约束（架构 7.1 / 7.2 第 5 条）：本文件与站点仓内任何文件都不得包含真实记录值。
 * 因此「品牌」「款式」的选项集在兜底 schema 中为空——它们由数据仓的 schema.json 提供，
 * 只有连接数据仓后才会有真实选项。
 *
 * 这里内置的仅是「产品定义型」选项集（分类 / 季节 / 教程 / 推荐 / 想做 / 电子版尺码组 /
 * 电子版 / 纸质版），这些来自需求定义，与具体数据无关，可以安全地出现在公开站点仓中。
 *
 * v3 变更摘要：
 *   · 新增「电子版」「纸质版」两个枚举三态字段（有 / 没有 / 不确定），
 *     取代原「拥有电子版」「拥有纸质版」两个布尔字段
 *   · 删除「关联」「电子版缺码」两个字段
 *   · 「分类」不再内置「通用」（旧值待数据迁移后就消失；迁移前仅做兼容容忍，不再提供选择）
 *   · 「季节」固定为枚举单选（下拉），选项 夏 / 春秋 / 冬（「春秋」保持为独立选项）
 *
 * v4 变更摘要：
 *   · 结构版本 2 → 3：删除软删除字段 deletedAt（回收站整体移除）
 *   · 「名称」仍是必填字段，但**空名称记录不再阻断同步**（见 store/migrations.ts 的
 *     validateRecords 与 isShellRecord）—— 校验只针对有效记录
 */

import type { FieldDef, FieldType, Schema } from './types';

export const APP_NAME = '信息汇总工作台';

/** 合法字段类型（远端 schema 若给出非法类型，按内置类型兜底） */
export const FIELD_TYPES: FieldType[] = [
  'number', 'text', 'enum', 'multi', 'boolean', 'tags', 'refs', 'datetime',
];

/** 分类目标选项集（v3：不含「通用」） */
export const CATEGORY_ORDER = ['女装', '男装', '童装', '婴童'];

/** 尺码组顺序 */
export const SIZE_GROUP_ORDER = ['女士全码', '男士全码', '大小童全码', '仅小童'];

/**
 * v3：电子版 / 纸质版 的枚举三态。
 *
 * 取值口径说明：用户需求原文为「有 / 没有 / 不确定」。
 * 现有 schema 里「拥有电子版」「拥有纸质版」原本是 boolean（实际只有两态），
 * 第三态「不确定」为本次改造新增，目前无历史记录落在该态；
 * 迁移规则为 true → 「有」、false → 「没有」、字段缺失 → 「不确定」。
 *
 * ⚠️ 若要改用「教程」字段的写法（有 / 无 / 未知），只需改这一处常量。
 */
export const OWNERSHIP_OPTIONS = ['有', '没有', '不确定'];

/** v3：季节下拉单选的选项集（由现有数据实际取值归纳；「春秋」保持独立选项） */
export const SEASON_OPTIONS = ['夏', '春秋', '冬'];

/**
 * 已废弃字段：v3 起从 schema、界面、迁移逻辑中彻底移除。
 * 「电子版缺码」的历史取值在数据仓迁移时导出归档，不静默丢弃。
 */
export const REMOVED_FIELD_KEYS = ['电子版缺码', '关联'];

/** 旧键 → 新键的改名映射（v3：键名与类型一起改） */
export const LEGACY_FIELD_ALIAS: Record<string, string> = {
  拥有电子版: '电子版',
  拥有纸质版: '纸质版',
};

/**
 * 旧的多值取值：允许旧数据继续存在（校验不拦截），但不再提供选择入口。
 * 「通用」由数据迁移统一替换为「女装 / 男装 / 童装」，迁移完成后本条即可移除。
 */
export const LEGACY_MULTI_VALUES: Record<string, string[]> = {
  分类: ['通用'],
};

export const DEFAULT_FIELDS: FieldDef[] = [
  { key: '记录ID', jsonKey: 'id', type: 'number', label: '记录ID', readonly: true, system: true },
  { key: '名称', jsonKey: '名称', type: 'text', label: '名称', required: true },
  { key: '品牌', jsonKey: '品牌', type: 'enum', label: '品牌', required: true, options: [], allowNew: true },
  { key: '分类', jsonKey: '分类', type: 'multi', label: '分类', options: CATEGORY_ORDER, ordered: true },
  { key: '款式', jsonKey: '款式', type: 'enum', label: '款式', options: [], allowNew: true },
  { key: '季节', jsonKey: '季节', type: 'enum', label: '季节', options: SEASON_OPTIONS },
  { key: '教程', jsonKey: '教程', type: 'enum', label: '教程', options: ['有', '无', '未知'] },
  { key: '电子版', jsonKey: '电子版', type: 'enum', label: '电子版', options: OWNERSHIP_OPTIONS },
  { key: '电子版尺码组', jsonKey: '电子版尺码组', type: 'multi', label: '电子版尺码组', options: SIZE_GROUP_ORDER, ordered: true },
  { key: '纸质版', jsonKey: '纸质版', type: 'enum', label: '纸质版', options: OWNERSHIP_OPTIONS },
  { key: '纸质版尺码', jsonKey: '纸质版尺码', type: 'tags', label: '纸质版尺码' },
  { key: '推荐', jsonKey: '推荐', type: 'enum', label: '推荐', options: ['推荐', '不推荐', '未评价'] },
  { key: '做过', jsonKey: '做过', type: 'boolean', label: '做过' },
  { key: '想做', jsonKey: '想做', type: 'enum', label: '想做', options: ['想做', '不想做', '不确定', '未标记'] },
  { key: '备注', jsonKey: '备注', type: 'text', label: '备注', long: true },
  { key: '创建时间', jsonKey: '创建时间', type: 'datetime', label: '创建时间', readonly: true, system: true },
  { key: '更新时间', jsonKey: '更新时间', type: 'datetime', label: '更新时间', readonly: true, system: true },
];

/** 当前代码支持的数据结构版本（v4 = 移除软删除 / 回收站） */
export const DEFAULT_SCHEMA: Schema = {
  schemaVersion: 3,
  appName: APP_NAME,
  fields: DEFAULT_FIELDS,
  systemFields: ['id', '创建时间', '更新时间'],
};

/** 类型兜底：远端给出非法类型（如历史遗留的 "季节"）时退回内置类型 */
function normalizeType(remoteType: unknown, fallback: FieldType | undefined): FieldType {
  if (typeof remoteType === 'string' && (FIELD_TYPES as string[]).includes(remoteType)) {
    return remoteType as FieldType;
  }
  return fallback ?? 'text';
}

/** 从选项集里剔除「只容忍、不再提供」的旧取值 */
export function stripLegacyOptions(fieldKey: string, options: string[] | undefined): string[] | undefined {
  if (!options) return undefined;
  const legacy = LEGACY_MULTI_VALUES[fieldKey] ?? [];
  if (!legacy.length) return options;
  return options.filter((o) => !legacy.includes(o));
}

/**
 * 合并远端 schema 与内置 schema：
 *   · 远端提供真实选项集（品牌 / 款式），内置提供字段结构与兜底选项
 *   · 远端新增字段会被追加（只做加法迁移，不改既有字段）
 *   · v3：远端若仍带旧键（拥有电子版 / 拥有纸质版 / 电子版缺码 / 关联），一律不采纳，
 *     由内置的 v3 定义接管；远端给出非法字段类型时退回内置类型
 *   · v3：schemaVersion 始终取内置（当前代码支持的版本），避免写回时把版本号写低
 */
export function mergeSchema(base: Schema, remote: Partial<Schema> | null | undefined): Schema {
  if (!remote || !Array.isArray(remote.fields) || remote.fields.length === 0) return base;
  const byKey = new Map(base.fields.map((f) => [f.key, f]));
  for (const rf of remote.fields) {
    if (!rf || typeof rf.key !== 'string') continue;
    // 已废弃字段：不再进入 schema
    if (REMOVED_FIELD_KEYS.includes(rf.key)) continue;
    // 旧键改名：内置的新键定义优先（类型/选项与旧字段不同，不能被远端覆盖）
    if (rf.key in LEGACY_FIELD_ALIAS) continue;

    const existing = byKey.get(rf.key);
    if (existing) {
      byKey.set(rf.key, {
        ...existing,
        ...rf,
        type: normalizeType(rf.type, existing.type),
        options: stripLegacyOptions(rf.key, rf.options ?? existing.options) ?? existing.options,
      });
    } else {
      byKey.set(rf.key, {
        ...rf,
        type: normalizeType(rf.type, undefined),
        options: stripLegacyOptions(rf.key, rf.options),
      });
    }
  }
  return {
    ...base,
    ...remote,
    appName: base.appName,
    // 版本号以当前代码为准（写回数据文件时写当前版本）
    schemaVersion: base.schemaVersion,
    fields: [...byKey.values()],
    systemFields: remote.systemFields ?? base.systemFields,
  };
}

/** 列表默认显示的列（PRD 第 5.3 节） */
export const DEFAULT_VISIBLE_COLUMNS = [
  '名称', '品牌', '分类', '款式', '季节', '教程', '推荐', '做过', '想做',
];

/**
 * 枚举字段的「空值」默认值（v3 新增）。
 *
 * 背景：v2 的新增记录逻辑把枚举字段默认成「最后一个选项」，
 * 改字段后会导致「季节」新建即「冬」、「分类」之类的取值不可控。
 * v3 改为逐字段显式声明默认值，未声明的枚举字段默认为空串（由用户选择）。
 */
export const FIELD_DEFAULTS: Record<string, string> = {
  教程: '未知',
  推荐: '未评价',
  想做: '未标记',
  电子版: '不确定',
  纸质版: '不确定',
};

/**
 * 取某个字段的新建默认值（迁移补齐缺失值、新建记录初始化共用同一口径）。
 * 多值 / 标签 / 引用类返回空数组，布尔返回 false，数字返回 0，其余返回空串。
 */
export function defaultValueFor(field: FieldDef): unknown {
  const explicit = FIELD_DEFAULTS[field.key];
  if (explicit !== undefined) return explicit;
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
