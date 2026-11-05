/**
 * 信息汇总工作台 · 领域模型类型定义
 *
 * 字段口径对应数据文件的键名（与 PRD 一致，避免映射表与数据文件之间再引入一层编码转换）。
 *
 * ⚠️ v3 变更（相对 v2 的 19 字段）：
 *   · 「拥有电子版」→ 「电子版」，「拥有纸质版」→ 「纸质版」：由布尔改为枚举三态
 *     （有 / 没有 / 不确定），键名与类型一起改（见交付说明 v3「改名口径」一节）
 *   · 删除「关联」与「电子版缺码」两个字段
 *   · 「季节」保持单值枚举（下拉单选），「春秋」为独立选项
 *
 * ⚠️ v4 变更（相对 v3）：
 *   · 删除「回收站 / 软删除」整套机制：记录删除后直接物理删除，不再保留 deletedAt 标记。
 *     旧数据里残留的 deletedAt 字段在加载时被迁移层清洗（见 store/migrations.ts）。
 *   · RecordsFile 不再统计 deletedCount（软删口径随回收站一并移除）。
 *
 * ⚠️ v5 变更（相对 v4）—— R5「拥有形态」字段合并：
 *   · 「电子版」（有/没有/不确定）与「纸质版」（有/没有/不确定）两个枚举单选，
 *     合并为单个多选字段「拥有形态」，选项只有「电子版」「纸质版」两个；
 *     「不确定」态随合并取消（实测 0 条在用，旧值映射为「不选」）。
 *   · 筛选条件同步合并：两个枚举多选 → 一个多选 Filters.拥有形态，
 *     另设保留值「任意拥有」＝拥有形态非空（原本需要 OR 组合才能表达的口径）。
 *   · 列表页默认 8 列（R1）；「形态」是列表页的派生列，不是数据字段。
 *
 * ⚠️ v6.4 变更 —— 推荐 / 计划 的 UI 入口移除（需求 7）：
 *   · 详情页与筛选面板不再展示「推荐」「计划」；编辑表单保留这两个字段（便于手动调整存量数据）。
 *   · Filters 里保留推荐 / 计划 两个键与 matchesFilters 逻辑：旧筛选方案 / 旧 URL 仍能解析，
 *     只是界面不再提供勾选入口。列表可选列里「推荐 / 计划 / 做过」仍可手动勾选展示。
 *   · 「标记」派生列删除（需求 6）：「做过」成为独立两态列（✓ / 留空）。
 */

export type FieldType =
  | 'number' | 'text' | 'enum' | 'multi' | 'boolean' | 'tags' | 'refs' | 'datetime';

export interface FieldDef {
  /** PRD 字段名（如「分类」） */
  key: string;
  /** 数据文件中的 JSON 键名 */
  jsonKey: string;
  type: FieldType;
  label: string;
  required?: boolean;
  readonly?: boolean;
  system?: boolean;
  /** 枚举 / 多选的固定选项集 */
  options?: string[];
  /** 是否允许新增选项（品牌、款式） */
  allowNew?: boolean;
  /** 多值字段是否按固定顺序存储 */
  ordered?: boolean;
  /** 长文本 */
  long?: boolean;
  /** 记录引用是否可多选 */
  multiple?: boolean;
}

export interface Schema {
  schemaVersion: number;
  appName: string;
  generatedAt?: string;
  fields: FieldDef[];
  systemFields: string[];
  targetFieldOrder?: string[];
}

export interface RecordItem {
  id: number;
  名称: string;
  品牌: string;
  分类: string[];
  款式: string;
  季节: string;
  教程: string;
  /**
   * v6.1（需求 3）：原「电子版尺码组」（尺码组多选）改为与纸质版一致的标签双轨
   * （字母码 XS–4XL + 身高码 100–180 步长 10）。
   * 旧值由迁移层映射（女士全码→字母码全码；大小童全码→身高码全码；其余置空），
   * 旧字符串形态也由迁移层兜底（见 store/migrations.ts）。
   */
  电子版尺码: string[];
  /**
   * v5（R5）：「电子版」+「纸质版」两个枚举单选合并为单个多选字段。
   * 取值只有「电子版」「纸质版」两项；空数组 = 两者皆无（占记录 92% 以上）。
   * 旧数据里的「有 / 没有 / 不确定」三态由迁移层归一（见 store/migrations.ts）。
   */
  拥有形态: string[];
  纸质版尺码: string[];
  推荐: string;
  做过: boolean;
  /**
   * v6.1（需求 2）：原「想做」改名「计划」，取值改名 想做→在计划中、不确定→不是现在
   * （不想做 / 未标记 保持不变）。旧键旧值由迁移层归一（见 store/migrations.ts）。
   */
  计划: string;
  备注: string;
  创建时间: string;
  更新时间: string;
  /**
   * v4：已移除软删除标记。
   * 旧数据残留的 deletedAt 由迁移层清洗；这里刻意不再声明，避免任何新代码再依赖它。
   */
}

export interface RecordsFile {
  schemaVersion: number;
  dataVersion: number;
  updatedAt: string;
  /** 记录总条数（v4：无软删记录，口径 = 实际记录数） */
  recordCount?: number;
  /** 记录总条数（含全部记录） */
  totalCount?: number;
  records: RecordItem[];
}

/* ------------------------------ 计划清单（v6.2） ------------------------------ */

/**
 * v6.2（需求 1）：可自建的计划清单。
 *
 *   · 清单定义与成员关系都存在数据仓的 data/plans.json（独立文件，不动 records.json）；
 *   · 「成员关系」以记录 ID 列表挂在清单上 —— 记录本身不新增任何字段，
 *     删除清单只是删掉清单定义（关联随之消失），绝不删除记录本身；
 *   · 与「状态及评价」里的「计划」枚举（在计划中 / 不是现在 等）完全独立、互不影响；
 *     既有「计划」枚举取值不做任何迁移或合并，由用户自行取舍。
 */
export interface PlanItem {
  /** 清单唯一标识（本地生成，形如 p-xxxx，跨设备不会碰撞） */
  id: string;
  /** 清单名称（如「2026 春季」「给宝宝做的」） */
  名称: string;
  /** 加入本清单的记录 ID 列表（升序去重） */
  记录ID列表: number[];
  创建时间: string;
  更新时间: string;
}

/** 数据仓 data/plans.json 的文件结构 */
export interface PlansFile {
  schemaVersion: number;
  dataVersion: number;
  updatedAt: string;
  totalCount?: number;
  plans: PlanItem[];
}

/* ------------------------------ 字段选项管理（v6.3） ------------------------------ */

/**
 * v6.3（需求 2）：单个受管字段（品牌 / 款式，即 allowNew 枚举）的选项管理状态。
 *
 *   · added   —— 用户手动输入并沉淀下来的新选项（进入录入候选）；
 *   · removed —— 用户从候选里删除的选项（含被隐藏的 schema 内置选项）。
 *                删除只影响后续录入的下拉候选，绝不改动任何历史记录的取值；
 *                removed 里不属于 schema 选项的值可通过「恢复」重新回到候选。
 */
export interface ManagedFieldOptions {
  added: string[];
  removed: string[];
}

/** 全部受管字段的管理状态：键为字段 jsonKey（品牌 / 款式） */
export type FieldOptionsState = Record<string, ManagedFieldOptions>;

/** 数据仓 data/options.json 的文件结构 */
export interface OptionsFile {
  schemaVersion: number;
  dataVersion: number;
  updatedAt: string;
  fields: Record<string, ManagedFieldOptions>;
}

/* ------------------------------ 筛选与搜索 ------------------------------ */

/** 布尔字段的三态筛选：undefined = 不限 */
export type BoolFilter = boolean | undefined;

export interface Filters {
  品牌: string[];
  分类: string[];
  款式: string[];
  季节: string[];
  教程: string[];
  推荐: string[];
  /** v6.1（需求 2）：原「想做」筛选改为「计划」（URL 参数保持 plan，旧链接不失效） */
  计划: string[];
  /**
   * v6.1（需求 3）：原「电子版尺码组」筛选改为「电子版尺码」标签双轨
   * （URL 参数保持 size）；旧筛选方案里的「女士全码」等取值由 matchesFilters 兼容展开。
   */
  电子版尺码: string[];
  /**
   * v5（R5）：原「电子版」「纸质版」两个枚举多选合并为单个多选。
   * 取值：「电子版」「纸质版」；另设保留值「任意拥有」＝拥有形态非空。
   */
  拥有形态: string[];
  /**
   * v6.2（需求 1）：按计划清单筛选。取值为清单 ID（PlanItem.id），
   * 多选语义 = 命中任一清单即返回（与品牌 / 分类的字段内 OR 一致）。
   * 清单本身的数据不进 Filters，由 AppState.plans 提供（见 store/plans.ts）。
   */
  计划清单: string[];
  做过: BoolFilter;
}

export const EMPTY_FILTERS: Filters = {
  品牌: [],
  分类: [],
  款式: [],
  季节: [],
  教程: [],
  推荐: [],
  计划: [],
  电子版尺码: [],
  拥有形态: [],
  计划清单: [],
  做过: undefined,
};

export type SortKey = 'id' | '名称' | '更新时间' | '品牌';
export type SortDir = 'asc' | 'desc';

export interface SortSpec {
  key: SortKey;
  dir: SortDir;
}

export interface FilterPreset {
  id: string;
  name: string;
  filters: Filters;
  createdAt: string;
}

/* ------------------------------ 同步与冲突 ------------------------------ */

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  /** true = 只在本次会话有效（存 sessionStorage） */
  sessionOnly: boolean;
}

export type ConnectionStatus = 'unconfigured' | 'connecting' | 'connected' | 'invalid' | 'offline';

export interface SyncState {
  /** 远端 blob sha（乐观锁基线） */
  baseSha: string | null;
  dataVersion: number;
  lastSyncedAt: string | null;
  /** 本地未同步的改动条数 */
  dirtyCount: number;
  status: 'idle' | 'syncing' | 'conflict' | 'error' | 'offline';
  message: string | null;
}

/**
 * v6.1.1：待确认清单不再来自数据仓静态文件，而是按当前记录实时核对
 * （见 store/pendingChecks.ts）。key 是条目的稳定键，忽略清单按它持久化。
 */
export interface ConflictEntry {
  key: string;
  类型: string;
  字段: string;
  记录ID: number;
  名称: string;
  详情: string;
  处理建议?: string;
}

export interface SuggestionEntry {
  key: string;
  类型: string;
  字段: string;
  记录ID: number;
  名称: string;
  详情: string;
  处理建议?: string;
}

/* -------------------------------- 视图 -------------------------------- */

export type ViewName = 'list' | 'detail' | 'dashboard' | 'settings' | 'editor';

export interface ColumnPrefs {
  visible: string[];
}

/**
 * v4：同步 / 备份操作日志条目。
 * 每次同步或备份动作写一条，只保留最近 3 条，存浏览器本地（localStorage）。
 */
export interface ActionLogEntry {
  /** 动作发生时间（ISO 字符串） */
  时间: string;
  /** 操作类型：同步写回 / 冲突处理写回 / 从仓库拉取 / 本地备份导出 */
  类型: string;
  /** 结果：成功 / 失败 */
  结果: '成功' | '失败';
  /** 结果说明（失败原因 / 成功摘要） */
  说明: string;
}

export interface UiPrefs {
  columns: string[];
  sort: SortSpec;
  pageSize: number;
  backupIntervalDays: number;
}
