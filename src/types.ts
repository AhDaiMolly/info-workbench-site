/**
 * 信息汇总工作台 · 领域模型类型定义
 *
 * 字段口径严格对应 PRD 第 4.2 节的 19 个目标字段（数据文件中的键名与 PRD 一致，
 * 避免映射表与数据文件之间再引入一层编码转换）。
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
  拥有电子版: boolean;
  电子版尺码组: string[];
  电子版缺码: boolean;
  拥有纸质版: boolean;
  纸质版尺码: string[];
  推荐: string;
  做过: boolean;
  想做: string;
  关联: Array<number | string>;
  备注: string;
  创建时间: string;
  更新时间: string;
  deletedAt: string | null;
}

export interface RecordsFile {
  schemaVersion: number;
  dataVersion: number;
  updatedAt: string;
  /** 未删除（可见）记录条数 —— 口径不含软删记录 */
  recordCount?: number;
  /** 软删（回收站）记录条数 */
  deletedCount?: number;
  /** 记录总条数（含软删） */
  totalCount?: number;
  records: RecordItem[];
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
  想做: string[];
  电子版尺码组: string[];
  拥有电子版: BoolFilter;
  拥有纸质版: BoolFilter;
  电子版缺码: BoolFilter;
  做过: BoolFilter;
}

export const EMPTY_FILTERS: Filters = {
  品牌: [],
  分类: [],
  款式: [],
  季节: [],
  教程: [],
  推荐: [],
  想做: [],
  电子版尺码组: [],
  拥有电子版: undefined,
  拥有纸质版: undefined,
  电子版缺码: undefined,
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

export interface ConflictEntry {
  类型: string;
  字段: string;
  记录ID: number;
  名称: string;
  详情: string;
  原始值?: Record<string, string>;
  处理建议?: string;
}

export interface SuggestionEntry {
  类型: string;
  字段: string;
  记录ID: number;
  名称: string;
  详情: string;
  处理建议?: string;
}

export interface PendingConflictsFile {
  schemaVersion: number;
  appName: string;
  generatedAt: string;
  说明?: string;
  conflicts: ConflictEntry[];
  suggestions: SuggestionEntry[];
}

/* -------------------------------- 视图 -------------------------------- */

export type ViewName = 'list' | 'detail' | 'dashboard' | 'settings' | 'trash' | 'editor';

export interface ColumnPrefs {
  visible: string[];
}

export interface UiPrefs {
  columns: string[];
  sort: SortSpec;
  pageSize: number;
  backupIntervalDays: number;
}
