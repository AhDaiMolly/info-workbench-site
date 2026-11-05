/**
 * 信息汇总工作台 · 内置兜底字段定义（v3）
 *
 * ⚠️ 安全约束（架构 7.1 / 7.2 第 5 条）：本文件与站点仓内任何文件都不得包含真实记录值。
 * 因此「品牌」「款式」的选项集在兜底 schema 中为空——它们由数据仓的 schema.json 提供，
 * 只有连接数据仓后才会有真实选项。
 *
 * 这里内置的仅是「产品定义型」选项集（分类 / 季节 / 教程 / 推荐 / 计划 /
 * 拥有形态 / 电子版 / 纸质版），这些来自需求定义，与具体数据无关，可以安全地出现在公开站点仓中。
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
 *
 * v5 变更摘要（R5「拥有形态」合并 + R1 列表页精简）：
 *   · 结构版本 3 → 4：「电子版」「纸质版」两个枚举三态单选 → 单个多选「拥有形态」
 *     （选项：电子版 / 纸质版）；「不确定」态取消，旧值映射见 store/migrations.ts
 *   · 远端若仍带旧键（电子版 / 纸质版 / 拥有电子版 / 拥有纸质版），一律不采纳，
 *     由内置的 v5 定义接管 —— 页面侧归一后仍可正常显示，写回闸门会拦住未迁移的数据仓
 *   · 列表默认列改为 8 列（R1）：名称 / 品牌 / 分类 / 款式 / 季节 / 形态 / 教程 / 标记
 *     「形态」「标记」是列表页派生列（由「拥有形态」「计划/做过/推荐」渲染），不是数据字段
 *
 * v6.1 变更摘要（计划字段改名 + 电子版尺码双轨化）：
 *   · 结构版本 4 → 5：「想做」改名「计划」，取值 想做→在计划中、不确定→不是现在
 *     （不想做 / 未标记 保持不变）；「电子版尺码组」（尺码组单选）改为「电子版尺码」
 *     （标签双轨：字母码 XS–4XL + 身高码 100–180，与纸质版尺码同格式）
 *   · 旧键（想做 / 电子版尺码组）一律不采纳，记录里的旧值由 migrate_4_to_5 归一
 *   · 字段顺序：「拥有形态」先于两个尺码字段（先勾形态，再录对应尺码）；
 *     「状态及评价」区顺序 = 做过 → 推荐 → 计划
 */

import type { FieldDef, FieldType, Schema } from './types';

export const APP_NAME = '信息汇总工作台';

/** 合法字段类型（远端 schema 若给出非法类型，按内置类型兜底） */
export const FIELD_TYPES: FieldType[] = [
  'number', 'text', 'enum', 'multi', 'boolean', 'tags', 'refs', 'datetime',
];

/** 分类目标选项集（v3：不含「通用」） */
export const CATEGORY_ORDER = ['女装', '男装', '童装', '婴童'];

/** 旧「尺码组」的固定选项序（v6.1 前）—— v6.1 起「电子版尺码」改为与纸质版一致的标签双轨，此表仅供迁移层兼容旧值 */
export const SIZE_GROUP_ORDER = ['女士全码', '男士全码', '大小童全码', '仅小童'];

/**
 * v3 的枚举三态（有 / 没有 / 不确定）—— v5 合并后**仅供迁移层使用**。
 *
 * 取值口径说明：用户需求原文为「有 / 没有 / 不确定」。
 * 现有 schema 里「拥有电子版」「拥有纸质版」原本是 boolean（实际只有两态），
 * 第三态「不确定」为 v3 改造新增，实测 0 条记录落在该态。
 */
export const OWNERSHIP_TRISTATE_OPTIONS = ['有', '没有', '不确定'];

/**
 * v5（R5）：合并后的「拥有形态」多选选项集。
 *
 * 「拥有形态」＝手上有哪些形态版本，空数组表示「两者皆无」（占记录 92% 以上）。
 */
export const OWNERSHIP_FORMAT_OPTIONS = ['电子版', '纸质版'];

/**
 * v6.5（需求 1）：全站隐藏的字段（仅展示层隐藏，数据一律保留）。
 *
 * 「推荐」「计划」两个字段在界面上不再出现（详情页 / 筛选 / 编辑表单 / 显示列），
 * 但记录里的原值原样保留 —— 编辑表单提交时仍会带上它们，写回数据仓不变。
 */
export const HIDDEN_UI_FIELDS = ['推荐', '计划'];

/**
 * v5（R5）：筛选保留值「任意拥有」—— 拥有形态非空。
 *
 * 在旧的两个单选模型下「任意拥有」需要跨字段 OR 组合才能表达；
 * 单字段多选一步到位（方案第 4 节第 4 条）。
 */
export const OWNERSHIP_ANY = '任意拥有';

/**
 * v6.5（需求 5）：筛选保留值「均没有」—— 既未勾选电子版、也未勾选纸质版。
 */
export const OWNERSHIP_NONE = '均没有';

/** 筛选器里「拥有形态」的全部可选项（含保留值） */
export const OWNERSHIP_FILTER_OPTIONS = [...OWNERSHIP_FORMAT_OPTIONS, OWNERSHIP_ANY, OWNERSHIP_NONE];

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

/**
 * v6.1（需求 2）：「计划」字段的选项集（由「想做」改名而来）。
 * 改名映射：想做 → 在计划中；不确定 → 不是现在；不想做 / 未标记 保持不变。
 */
export const PLAN_OPTIONS = ['在计划中', '不想做', '不是现在', '未标记'];

/** v6.1（需求 2）：「想做 → 计划」改名时的取值映射（仅改这两项，其余原样保留） */
export const PLAN_VALUE_RENAME: Record<string, string> = {
  想做: '在计划中',
  不确定: '不是现在',
};

export const DEFAULT_FIELDS: FieldDef[] = [
  { key: '记录ID', jsonKey: 'id', type: 'number', label: '记录ID', readonly: true, system: true },
  { key: '名称', jsonKey: '名称', type: 'text', label: '名称', required: true },
  { key: '品牌', jsonKey: '品牌', type: 'enum', label: '品牌', required: true, options: [], allowNew: true },
  { key: '分类', jsonKey: '分类', type: 'multi', label: '分类', options: CATEGORY_ORDER, ordered: true },
  { key: '款式', jsonKey: '款式', type: 'enum', label: '款式', options: [], allowNew: true },
  { key: '季节', jsonKey: '季节', type: 'enum', label: '季节', options: SEASON_OPTIONS },
  // v6.1（需求 1）：「拥有形态」多选排在两个尺码字段之前 —— 先勾形态，再在其下方录入对应尺码
  // v5（R5）：「电子版」+「纸质版」两个枚举单选合并为单个多选字段
  { key: '拥有形态', jsonKey: '拥有形态', type: 'multi', label: '拥有形态', options: OWNERSHIP_FORMAT_OPTIONS, ordered: true },
  // v6.1（需求 3）：「电子版尺码」由尺码组单选改为与纸质版一致的标签双轨（字母码 + 身高码）
  { key: '电子版尺码', jsonKey: '电子版尺码', type: 'tags', label: '电子版尺码' },
  { key: '纸质版尺码', jsonKey: '纸质版尺码', type: 'tags', label: '纸质版尺码' },
  { key: '教程', jsonKey: '教程', type: 'enum', label: '教程', options: ['有', '无', '未知'] },
  // v6.1（需求 2）：「状态及评价」区顺序 = 是否做过 → 推荐 → 计划
  { key: '做过', jsonKey: '做过', type: 'boolean', label: '做过' },
  { key: '推荐', jsonKey: '推荐', type: 'enum', label: '推荐', options: ['推荐', '不推荐', '未评价'] },
  // v6.1（需求 2）：「想做」改名「计划」，选项 想做→在计划中、不确定→不是现在（不想做 / 未标记 保持不变）
  { key: '计划', jsonKey: '计划', type: 'enum', label: '计划', options: PLAN_OPTIONS },
  { key: '备注', jsonKey: '备注', type: 'text', label: '备注', long: true },
  { key: '创建时间', jsonKey: '创建时间', type: 'datetime', label: '创建时间', readonly: true, system: true },
  { key: '更新时间', jsonKey: '更新时间', type: 'datetime', label: '更新时间', readonly: true, system: true },
];

/** v6.1 前旧「电子版尺码组」的完整选项集（供迁移层识别旧值） */
export const LEGACY_ESIZE_GROUP_OPTIONS = ['女士全码', '男士全码', '大小童全码', '仅小童'];

/**
 * v5：被「拥有形态」合并掉的旧键。
 *
 * 远端 schema 若仍带这些键，一律不采纳（由内置的 v5 定义接管）；
 * 页面侧的加载兼容会把旧键归一到「拥有形态」，写回闸门会拦住未迁移的数据仓。
 */
export const MERGED_OWNERSHIP_KEYS = ['电子版', '纸质版'];

/**
 * v5（R4）：纸质版尺码的录入快捷标签。
 * 字母码 XS–4XL（成衣）；身高码 80–180（童装）。
 * 点选即填，仍可自由补充 —— 历史 40 条记录原样保留，不做数据迁移。
 *
 * v6.2（需求 2）：身高码在原 100–180（步长 10）基础上新增 80、90、155、165 四项，
 * 全部按数值升序排列。只增选项，不改动任何已有记录的取值；
 * 已填的历史标签（含不在快捷集里的自由补充值）依旧原样保留、可正常显示与筛选。
 */
export const PAPER_SIZE_LETTER_TAGS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];
export const PAPER_SIZE_HEIGHT_TAGS = [
  '80', '90', '100', '110', '120', '130', '140', '150', '155', '160', '165', '170', '180',
];

/**
 * v6.1 口径的身高码全集（100–180 步长 10，不含 v6.2 新增项）。
 *
 * 仅供「迁移兼容」使用：旧「电子版尺码组=大小童全码」展开为身高码全集、
 * 旧筛选方案里「大小童全码」的匹配要求，都必须锚定**当时的口径**——
 * 若跟着 PAPER_SIZE_HEIGHT_TAGS 走，v6.2 起「大小童全码」会被要求包含
 * 80/90/155/165，历史筛选方案与旧值迁移结果就会凭空多出四个码。
 */
export const LEGACY_HEIGHT_TAGS_V61 = ['100', '110', '120', '130', '140', '150', '160', '170', '180'];

/**
 * v6.1（需求 3）：旧「电子版尺码组」取值 → 标签双轨的映射（页面侧加载兜底，与数据仓 migrate-v6 同规则）。
 *   女士全码 → 字母码全码（XS–4XL）
 *   大小童全码 → 身高码全码（100–180 步长 10，v6.1 口径，不随 v6.2 新增项膨胀）
 *   男士全码 / 仅小童 / 其他值 → 不映射（置空）
 */
export const LEGACY_ESIZE_GROUP_MAP: Record<string, string[]> = {
  女士全码: [...PAPER_SIZE_LETTER_TAGS],
  大小童全码: [...LEGACY_HEIGHT_TAGS_V61],
};

/**
 * v5（R1）→ v6.5（需求 9）：列表页的派生列。
 *
 * 这些列不是数据字段，而是由已有字段渲染出来的展示列：
 *   · 「电子」「纸质」← 拥有形态（分别按是否勾选电子版 / 纸质版显示 √ / ×）
 * v6.4 起派生列只剩「形态」——原「标记」列已删除；
 * v6.5 把「形态」拆成「电子」「纸质」两列；
 * 「做过」改为直接展示数据字段（打勾 / 留空），不再是派生列。
 */
export const DERIVED_LIST_COLUMNS = ['电子', '纸质'];

/**
 * v6.1（需求 2 / 3）：被改名替换掉的旧键。
 *
 * 远端 schema 或本地缓存若仍带这些键（旧版页面写入的缓存），一律不采纳
 * （由内置的 v6.1 定义接管）；记录里的旧键值由迁移层归一（migrate_4_to_5）。
 */
export const MERGED_V61_KEYS = ['想做', '电子版尺码组'];

/** 当前代码支持的数据结构版本（v6.1 = 计划字段改名 + 电子版尺码双轨化） */
export const DEFAULT_SCHEMA: Schema = {
  schemaVersion: 5,
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
    // v5（R5）：「电子版」「纸质版」已被合并进「拥有形态」，远端旧键一律不采纳
    if (MERGED_OWNERSHIP_KEYS.includes(rf.key)) continue;
    // v6.1：「想做」「电子版尺码组」已被改名（计划 / 电子版尺码），旧键一律不采纳
    if (MERGED_V61_KEYS.includes(rf.key)) continue;

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

/**
 * 列表默认显示的列（v6.5 · 需求 9：「形态」列拆成「电子」「纸质」两列）。
 *
 * 一行回答三个问题：这是什么（名称/品牌/分类/款式/季节）、
 * 我手里有没有（电子 / 纸质）、我的状态（教程 ✓/✗、做过 ✓）。
 * 其余字段（尺码、备注、创建/更新时间）收进详情页；筛选器保留可用字段。
 */
export const DEFAULT_VISIBLE_COLUMNS = [
  '名称', '品牌', '分类', '款式', '季节', '电子', '纸质', '教程', '做过',
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
  计划: '未标记',
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
