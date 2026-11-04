/**
 * 信息汇总工作台 · 应用状态（useReducer + Context，架构 2.3 / 2.5）
 *
 * 内存 store 是唯一真源；localStorage 只做缓存与离线暂存（架构 ADR-004）。
 * 令牌不进入本 store：只在发起 API 请求的瞬间从 localStorage/sessionStorage 读取。
 */

import {
  createContext, useContext, useEffect, useMemo, useReducer, useRef, useState,
  type ReactNode,
} from 'react';
import type {
  ActionLogEntry, ConflictEntry, ConnectionStatus, FieldOptionsState, Filters, PlanItem, RecordItem, Schema, SortSpec, SuggestionEntry,
} from '../types';
import { EMPTY_FILTERS } from '../types';
import { DEFAULT_SCHEMA, mergeSchema } from '../schema';
import { buildIndexes, type Indexes } from './selectors';
import {
  applyMigrations, findLegacyFieldKeys, findShellRecords, nextRecordId, normalizeToCurrent, validateRecords,
} from './migrations';
import { computePendingChecks, checkSummary, type IgnoredCheckEntry } from './pendingChecks';
import {
  appendActionLog, clearConfig, readActionLog, readBaseline, readCache, readConfigMeta, readIgnoredChecks,
  readLastIssuedId, readOptionsBaseline, readPending, readPlansBaseline, readPrefs, readSettings, readToken,
  writeBaseline, writeCache, writeConfig, writeIgnoredChecks, writeLastIssuedId, writeOptionsBaseline, writePending,
  writePlansBaseline, writePrefs, writeSettings,
  type ConfigMeta, type PendingChange, type WriteOutcome,
} from './persist';
import {
  addRecordToPlan, buildPlanMembers, createPlan as createPlanList, deletePlan as deletePlanList,
  makePlansFile, normalizePlans, parsePlansFile, planPlansSync, plansEqual, prunePlanMembers,
  removeRecordFromPlan, renamePlan as renamePlanList,
} from './plans';
import {
  addOptionValue, effectiveOptions as effectiveOptionsFor, makeOptionsFile, mergeOptionsSync,
  normalizeOptionsState, optionsStateEqual, parseOptionsFile, removeOptionValue, restoreOptionValue,
} from './options';
import { GithubClient, GithubError, parseRepoUrl } from '../sync/github';
import { hasContentDiff, type FieldDiff } from '../sync/conflict';
import { decideAutoPull, planRemoteSync } from './syncPolicy';
import { downloadJson, downloadXlsx, buildStatsRows } from '../export/exporters';
import { applyQuery, computeStats, sortRecords } from './selectors';

export const DATA_FILE_PATH = 'data/records.json';
export const SCHEMA_FILE_PATH = 'data/schema.json';
export const AUDIT_FILE_PATH = 'data/migration-audit.json';
/** v6.2（需求 1）：计划清单独立文件，随同步写回数据仓 */
export const PLANS_FILE_PATH = 'data/plans.json';
/** v6.3（需求 2）：字段选项管理独立文件（品牌 / 款式的沉淀与删除），随同步写回数据仓 */
export const OPTIONS_FILE_PATH = 'data/options.json';

/**
 * v4：回收站整体移除，记录数口径 = 实际记录数（不再有「未删除 / 已删除」之分）。
 */
export function countActive(records: RecordItem[]): number {
  return records.length;
}

/** 本地存储写入失败时给用户的提示（质检 P2-3） */
export function storageErrorNotice(outcome: WriteOutcome, what: string): string | null {
  if (outcome === 'ok') return null;
  return outcome === 'quota'
    ? `浏览器本地存储已满，${what}没能保存到本机缓存。请到「设置」导出本地副本，或清理浏览器存储后再试。`
    : `浏览器本地存储写入失败，${what}没能保存到本机缓存。请到「设置」导出本地副本，避免数据只留在内存里。`;
}

export interface AppState {
  records: RecordItem[];
  schema: Schema;
  indexes: Indexes;
  filters: Filters;
  query: string;
  sort: SortSpec;
  visibleColumns: string[];
  page: number;
  pageSize: number;
  presets: Array<{ id: string; name: string; filters: Filters; createdAt: string }>;
  /**
   * v6.1.1：待确认清单改为按当前记录实时核对（store/pendingChecks.ts），
   * conflicts / suggestions 由 Provider 派生后挂进 Context，不再是 AppState 的静态字段。
   */
  /** v6.1.1：用户选择「忽略」的待确认项（浏览器本地持久化，设置页可查看与恢复） */
  ignoredChecks: IgnoredCheckEntry[];
  /**
   * v6.2（需求 1）：计划清单（自建清单，成员关系存在清单一侧）。
   * 与「状态及评价」里的「计划」枚举完全独立 —— 已有数据零迁移。
   */
  plans: PlanItem[];
  /** v6.2：plans.json 的远端 sha（null = 远端尚无该文件，首次写回时创建） */
  plansBaseSha: string | null;
  /** v6.2：plans.json 的数据版本 */
  plansDataVersion: number;
  /**
   * v6.3（需求 2）：品牌 / 款式的字段选项管理状态（沉淀 added / 删除 removed）。
   * 只影响后续录入的下拉候选，与任何记录取值无关。
   */
  options: FieldOptionsState;
  /** v6.3：options.json 的远端 sha（null = 远端尚无该文件，首次写回时创建） */
  optionsBaseSha: string | null;
  /** v6.3：options.json 的数据版本 */
  optionsDataVersion: number;
  config: ConfigMeta | null;
  connection: ConnectionStatus;
  baseSha: string | null;
  dataVersion: number;
  lastSyncedAt: string | null;
  pending: PendingChange[];
  backupIntervalDays: number;
  /** v4：同步 / 备份操作日志（只保留最近 3 条，新的在前） */
  actionLog: ActionLogEntry[];
  /** v4：记录 ID 发号水位（物理删除后 ID 不复用） */
  lastIssuedId: number;
  syncStatus: 'idle' | 'syncing' | 'conflict' | 'error' | 'offline';
  syncMessage: string | null;
  /** 冲突详情（远端 vs 本地） */
  conflictDetail: { diffs: FieldDiff[]; remoteRecords: RecordItem[]; remoteSha: string } | null;
  readOnlyReason: string | null;
  notice: string | null;
  /**
   * 启动时因本地存在未同步改动而暂停的自动拉取（质检 P0-1）。
   * 为 true 时页面顶部显示引导横幅，绝不自动覆盖本地记录。
   */
  autoPullBlocked: boolean;
  autoPullBlockMessage: string | null;
}

type Action =
  | { type: 'SET_FILTERS'; filters: Filters }
  | { type: 'SET_QUERY'; query: string }
  | { type: 'SET_SORT'; sort: SortSpec }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'SET_COLUMNS'; columns: string[] }
  | { type: 'SET_PAGE_SIZE'; size: number }
  | { type: 'SET_PRESETS'; presets: AppState['presets'] }
  | { type: 'SET_RECORDS'; records: RecordItem[]; baseSha?: string | null; dataVersion?: number; updatedAt?: string; keepPending?: boolean }
  | { type: 'SET_SCHEMA'; schema: Schema }
  /** v6.1.1：已忽略的待确认项整体替换（读取 / 忽略 / 恢复都走它） */
  | { type: 'SET_IGNORED_CHECKS'; entries: IgnoredCheckEntry[] }
  /** v6.2：计划清单整体替换（本地增删改 / 远端拉取合并 / 写回对齐都走它）；changes 随之入待同步队列 */
  | { type: 'SET_PLANS'; plans: PlanItem[]; baseSha?: string | null; dataVersion?: number; changes?: PendingChange[] }
  /** v6.3：字段选项管理状态整体替换（本地沉淀删除 / 远端拉取合并 / 写回对齐都走它）；changes 随之入待同步队列 */
  | { type: 'SET_OPTIONS'; options: FieldOptionsState; baseSha?: string | null; dataVersion?: number; changes?: PendingChange[] }
  | { type: 'SET_CONFIG'; config: ConfigMeta | null }
  | { type: 'SET_CONNECTION'; status: ConnectionStatus }
  | { type: 'SET_SYNC'; status: AppState['syncStatus']; message?: string | null }
  | { type: 'SET_CONFLICT_DETAIL'; detail: AppState['conflictDetail'] }
  | { type: 'SET_PENDING'; pending: PendingChange[] }
  | { type: 'SET_BACKUP_INTERVAL'; days: number }
  | { type: 'SET_ACTION_LOG'; entries: ActionLogEntry[] }
  | { type: 'SET_LAST_ISSUED_ID'; id: number }
  | { type: 'SET_NOTICE'; notice: string | null }
  | { type: 'SET_AUTO_PULL_BLOCK'; blocked: boolean; message: string | null }
  | { type: 'UPSERT_RECORD'; record: RecordItem; change: PendingChange }
  /** v4：回收站移除 —— 删除即物理删除 */
  | { type: 'DELETE_RECORD'; id: number; change: PendingChange }
  /** v4：一键清理「名称为空」的导入遗留空壳记录 */
  | { type: 'CLEANUP_SHELL'; ids: number[]; changes: PendingChange[] };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_FILTERS':
      return { ...state, filters: action.filters, page: 1 };
    case 'SET_QUERY':
      return { ...state, query: action.query, page: 1 };
    case 'SET_SORT':
      return { ...state, sort: action.sort, page: 1 };
    case 'SET_PAGE':
      return { ...state, page: Math.max(1, action.page) };
    case 'SET_COLUMNS':
      return { ...state, visibleColumns: action.columns };
    case 'SET_PAGE_SIZE':
      return { ...state, pageSize: action.size, page: 1 };
    case 'SET_PRESETS':
      return { ...state, presets: action.presets };
    case 'SET_RECORDS': {
      // v4：拉回远端数据后，发号水位至少不低于远端最大 ID（防止删记录后复用旧号）
      const maxId = action.records.reduce((m, r) => Math.max(m, r.id), 0);
      return {
        ...state,
        records: action.records,
        indexes: buildIndexes(action.records),
        baseSha: action.baseSha !== undefined ? action.baseSha : state.baseSha,
        dataVersion: action.dataVersion ?? state.dataVersion,
        lastSyncedAt: action.updatedAt ?? state.lastSyncedAt,
        lastIssuedId: Math.max(state.lastIssuedId, maxId),
        // 合并场景必须保留未同步队列：清空它等于抹掉用户还没写回的改动（质检 P0-1）
        pending: action.keepPending ? state.pending : [],
        syncStatus: 'idle',
        syncMessage: null,
      };
    }
    case 'SET_SCHEMA':
      return { ...state, schema: action.schema };
    case 'SET_IGNORED_CHECKS':
      return { ...state, ignoredChecks: action.entries };
    case 'SET_PLANS':
      return {
        ...state,
        plans: action.plans,
        // 本地增删改带 changes（进待同步队列）；远端拉取/写回对齐不带（不动队列）
        pending: action.changes ? [...state.pending, ...action.changes] : state.pending,
        plansBaseSha: action.baseSha !== undefined ? action.baseSha : state.plansBaseSha,
        plansDataVersion: action.dataVersion ?? state.plansDataVersion,
      };
    case 'SET_OPTIONS':
      return {
        ...state,
        options: action.options,
        // 本地沉淀 / 删除带 changes（进待同步队列）；远端拉取/写回对齐不带（不动队列）
        pending: action.changes ? [...state.pending, ...action.changes] : state.pending,
        optionsBaseSha: action.baseSha !== undefined ? action.baseSha : state.optionsBaseSha,
        optionsDataVersion: action.dataVersion ?? state.optionsDataVersion,
      };
    case 'SET_CONFIG':
      return { ...state, config: action.config };
    case 'SET_CONNECTION':
      return { ...state, connection: action.status };
    case 'SET_SYNC':
      return { ...state, syncStatus: action.status, syncMessage: action.message ?? null };
    case 'SET_CONFLICT_DETAIL':
      return { ...state, conflictDetail: action.detail };
    case 'SET_PENDING':
      return { ...state, pending: action.pending };
    case 'SET_BACKUP_INTERVAL':
      return { ...state, backupIntervalDays: action.days };
    case 'SET_ACTION_LOG':
      return { ...state, actionLog: action.entries };
    case 'SET_LAST_ISSUED_ID':
      return { ...state, lastIssuedId: Math.max(state.lastIssuedId, action.id) };
    case 'SET_NOTICE':
      return { ...state, notice: action.notice };
    case 'SET_AUTO_PULL_BLOCK':
      return { ...state, autoPullBlocked: action.blocked, autoPullBlockMessage: action.message };
    case 'UPSERT_RECORD': {
      const idx = state.records.findIndex((r) => r.id === action.record.id);
      const records = idx >= 0
        ? state.records.map((r) => (r.id === action.record.id ? action.record : r))
        : [...state.records, action.record];
      return {
        ...state,
        records,
        indexes: buildIndexes(records),
        pending: [...state.pending, action.change],
      };
    }
    case 'DELETE_RECORD': {
      // v4：回收站移除 —— 删除即物理删除，记录直接移出集合
      const records = state.records.filter((r) => r.id !== action.id);
      return {
        ...state,
        records,
        indexes: buildIndexes(records),
        pending: [...state.pending, action.change],
      };
    }
    case 'CLEANUP_SHELL': {
      // v4：清理「名称为空」的导入遗留空壳记录（用户一键触发）
      const drop = new Set(action.ids);
      const records = state.records.filter((r) => !drop.has(r.id));
      return {
        ...state,
        records,
        indexes: buildIndexes(records),
        pending: [...state.pending, ...action.changes],
      };
    }
    default:
      return state;
  }
}

/* -------------------------------- 初始化 -------------------------------- */

function initState(): AppState {
  const prefs = readPrefs();
  const settings = readSettings();
  const cache = readCache();
  const pending = readPending();
  const config = readConfigMeta();

  const schema = mergeSchema(DEFAULT_SCHEMA, cache?.schema ?? undefined);

  // v6.1：持久化基线快照可能还是迁移前的旧结构（「想做」/「电子版尺码组」旧键、
  // 字符串型电子版尺码）。与本地已迁移记录做三方合并前必须先归一化到当前结构，
  // 否则基线与 local 逐字段不等，会被误判成「本地已分叉」。
  const baseline = normalizeToCurrent(readBaseline() ?? [], schema);

  // v3：本地缓存里的记录可能还是旧结构（旧键名 / 布尔拥有形态 / 已删除字段），
  // 启动时就地迁移 —— 新版页面读旧数据不白屏、不丢字段。
  const cached = cache?.records ?? [];
  const rawRecords = applyMigrations(
    { schemaVersion: cache?.schemaVersion ?? 1, dataVersion: cache?.dataVersion ?? 1, updatedAt: '', records: cached },
    schema,
  ).records;
  const pendingChanges = pending.changes ?? [];
  const actionLog = readActionLog();
  const lastIssuedId = Math.max(
    readLastIssuedId(),
    rawRecords.reduce((m, r) => Math.max(m, r.id), 0),
  );

  // 质检 P0-1：启动时就判断本地有没有未同步改动，决定要不要自动拉取
  const autoPull = decideAutoPull({
    local: rawRecords,
    baseline,
    pendingCount: pendingChanges.length,
  });

  return {
    records: rawRecords,
    schema,
    indexes: buildIndexes(rawRecords),
    filters: { ...EMPTY_FILTERS },
    query: '',
    sort: prefs.sort ?? { key: '名称', dir: 'asc' },
    visibleColumns: prefs.columns && prefs.columns.length ? prefs.columns : [],
    page: 1,
    pageSize: prefs.pageSize ?? 50,
    presets: prefs.presets ?? [],
    ignoredChecks: readIgnoredChecks(),
    // v6.2：计划清单走本地缓存（远端拉取 / 本地写入时更新）
    plans: normalizePlans(cache?.plans),
    plansBaseSha: cache?.plansBaseSha ?? null,
    plansDataVersion: cache?.plansDataVersion ?? 1,
    // v6.3：字段选项管理状态走本地缓存（远端拉取 / 本地写入时更新）
    options: normalizeOptionsState(cache?.options),
    optionsBaseSha: cache?.optionsBaseSha ?? null,
    optionsDataVersion: cache?.optionsDataVersion ?? 1,
    config,
    connection: 'unconfigured',
    baseSha: cache?.baseSha ?? null,
    dataVersion: cache?.dataVersion ?? 1,
    lastSyncedAt: cache?.lastSyncedAt ?? null,
    pending: pendingChanges,
    backupIntervalDays: settings.backupIntervalDays ?? 7,
    actionLog,
    lastIssuedId,
    syncStatus: 'idle',
    syncMessage: null,
    conflictDetail: null,
    readOnlyReason: null,
    notice: null,
    autoPullBlocked: !autoPull.allow,
    autoPullBlockMessage: autoPull.message,
  };
}

/* ------------------------------- Context ------------------------------- */

export interface AppActions {
  setFilters: (filters: Filters) => void;
  toggleFilter: (key: keyof Filters, value: string | boolean) => void;
  clearFilters: () => void;
  setQuery: (query: string) => void;
  setSort: (sort: SortSpec) => void;
  setPage: (page: number) => void;
  setColumns: (columns: string[]) => void;
  setPageSize: (size: number) => void;
  savePreset: (name: string) => void;
  deletePreset: (id: string) => void;
  addRecord: (values: Partial<RecordItem>, planIds?: string[]) => number | null;
  updateRecord: (id: number, values: Partial<RecordItem>) => void;
  /** v4：删除即物理删除（无回收站） */
  deleteRecord: (id: number) => void;
  /** v4：一键清理「名称为空」的导入遗留空壳记录，返回清理条数 */
  cleanupShellRecords: () => number;
  /** v6.1.1：忽略一条待确认项（持久化到浏览器本地，设置页可查看与恢复） */
  ignoreCheckItem: (item: ConflictEntry | SuggestionEntry) => void;
  /** v6.1.1：忽略当前全部待确认项 */
  ignoreAllChecks: () => void;
  /** v6.1.1：恢复一条被忽略的待确认项（重新出现在横幅里） */
  restoreIgnoredCheck: (key: string) => void;
  /** v6.1.1：恢复全部被忽略的待确认项 */
  restoreAllIgnoredChecks: () => void;
  /** v6.2（需求 1）：新建计划清单，成功返回清单 ID，名称为空返回 null */
  createPlanList: (name: string) => string | null;
  /** v6.2（需求 1）：重命名计划清单 */
  renamePlanList: (planId: string, name: string) => void;
  /** v6.2（需求 1）：删除计划清单 —— 只解除记录关联，不删除任何记录 */
  deletePlanList: (planId: string) => void;
  /** v6.2（需求 1）：把记录加入/移出计划清单（按当前成员关系自动取反） */
  toggleRecordInPlan: (planId: string, recordId: number) => void;
  /** v6.3（需求 2）：沉淀一个新的品牌 / 款式选项（手动输入保存成功后自动调用；已在候选里为幂等 no-op） */
  addFieldOption: (fieldKey: string, value: string) => void;
  /** v6.3（需求 2）：从候选里删除一个选项（历史记录原值保留不受影响） */
  removeFieldOption: (fieldKey: string, value: string) => void;
  /** v6.3（需求 2）：恢复一个被删除的选项（重新出现在候选里） */
  restoreFieldOption: (fieldKey: string, value: string) => void;
  saveConfig: (input: { repoUrl: string; branch: string; token: string; sessionOnly: boolean }) => Promise<boolean>;
  clearConfigAction: () => void;
  testConnection: () => Promise<boolean>;
  pull: (silent?: boolean) => Promise<boolean>;
  syncNow: () => Promise<boolean>;
  resolveSyncConflict: (choice: 'local' | 'remote' | 'merge') => Promise<boolean>;
  closeConflict: () => void;
  exportJson: (scope: 'all' | 'filtered') => void;
  exportXlsx: (scope: 'all' | 'filtered') => void;
  setBackupInterval: (days: number) => void;
  dismissNotice: () => void;
}

const AppContext = createContext<
  (AppState & {
    /** v6.1.1：待确认清单由 Provider 按当前记录实时核对派生（store/pendingChecks.ts） */
    conflicts: ConflictEntry[];
    suggestions: SuggestionEntry[];
    /** v6.2：记录 ID → 所在计划清单 ID 集合（Provider 派生，筛选/详情共用） */
    planMembers: Map<number, Set<string>>;
    /** v6.3：受管字段（品牌/款式）的录入候选（schema 选项 ∪ 沉淀 − 删除，Provider 派生） */
    optionCandidates: Record<string, string[]>;
    actions: AppActions;
  }) | null
>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  /* -------- 持久化：偏好 / 设置 / 数据缓存 -------- */
  useEffect(() => {
    writePrefs({
      columns: state.visibleColumns,
      sort: state.sort,
      pageSize: state.pageSize,
      presets: state.presets,
    });
  }, [state.visibleColumns, state.sort, state.pageSize, state.presets]);

  useEffect(() => {
    writeSettings({ backupIntervalDays: state.backupIntervalDays });
  }, [state.backupIntervalDays]);

  useEffect(() => {
    if (!state.records.length) return;
    const outcome = writeCache({
      schemaVersion: state.schema.schemaVersion,
      dataVersion: state.dataVersion,
      updatedAt: new Date().toISOString(),
      records: state.records,
      schema: state.schema,
      baseSha: state.baseSha,
      lastSyncedAt: state.lastSyncedAt,
      // v6.2：计划清单随数据缓存一并落本地（刷新/重开后保持一致）
      plans: state.plans,
      plansBaseSha: state.plansBaseSha,
      plansDataVersion: state.plansDataVersion,
      // v6.3：字段选项管理状态随数据缓存一并落本地
      options: state.options,
      optionsBaseSha: state.optionsBaseSha,
      optionsDataVersion: state.optionsDataVersion,
    });
    // 质检 P2-3：本地存储写失败（配额超限）必须让用户知道，不能静默失败
    const message = storageErrorNotice(outcome, '最新数据');
    if (message) dispatch({ type: 'SET_NOTICE', notice: message });
  }, [state.records, state.schema, state.baseSha, state.dataVersion, state.lastSyncedAt, state.plans, state.plansBaseSha, state.plansDataVersion, state.options, state.optionsBaseSha, state.optionsDataVersion]);

  useEffect(() => {
    const outcome = writePending({ baseSha: state.baseSha, changes: state.pending });
    const message = storageErrorNotice(outcome, '离线暂存队列');
    if (message) dispatch({ type: 'SET_NOTICE', notice: message });
  }, [state.pending, state.baseSha]);

  // v4：发号水位持久化 —— 物理删除记录后，新记录不复用旧 ID
  useEffect(() => {
    if (state.lastIssuedId > 0) writeLastIssuedId(state.lastIssuedId);
  }, [state.lastIssuedId]);

  /* -------- 派生数据 -------- */
  const actions = useMemo<AppActions>(() => {
    const current = () => stateRef.current;

    const toggleFilter = (key: keyof Filters, value: string | boolean) => {
      const f = current().filters;
      if (typeof value === 'boolean') {
        dispatch({ type: 'SET_FILTERS', filters: { ...f, [key]: f[key] === value ? undefined : value } as Filters });
        return;
      }
      const list = (f[key] as string[]) ?? [];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      dispatch({ type: 'SET_FILTERS', filters: { ...f, [key]: next } as Filters });
    };

    /**
     * v4：操作日志落盘（只保留最近 3 条）。
     * 同步 / 备份的每一次动作都记一条：时间、类型、结果（失败带原因）。
     */
    const recordAction = (类型: string, 结果: '成功' | '失败', 说明: string) => {
      const entry: ActionLogEntry = { 时间: new Date().toISOString(), 类型, 结果, 说明 };
      const entries = appendActionLog(entry);
      dispatch({ type: 'SET_ACTION_LOG', entries });
    };

    const addRecord = (values: Partial<RecordItem>, planIds?: string[]): number | null => {
      const st = current();
      // v4 修复（同步阻断根因之二）：任何入口都不允许产生「名称为空」的记录。
      // 名称是必填项；为空直接拒绝创建，绝不静默落一条空壳记录。
      const name = String(values.名称 ?? '').trim();
      if (!name) {
        dispatch({ type: 'SET_NOTICE', notice: '「名称」为必填项，未创建这条记录。' });
        return null;
      }
      const now = new Date().toISOString();
      const id = nextRecordId(st.records, st.lastIssuedId);
      // v5（R5）：「电子版」「纸质版」合并为「拥有形态」多选，新建默认为空数组（皆无）
      const base: RecordItem = {
        id,
        名称: name, 品牌: '', 分类: [], 款式: '', 季节: '', 教程: '未知',
        电子版尺码: [],
        拥有形态: [], 纸质版尺码: [], 推荐: '未评价', 做过: false,
        计划: '未标记', 备注: '',
        创建时间: now, 更新时间: now,
      } as RecordItem;
      // 名称以校验过的值为准（调用方传进来的空白/未 trim 值一律丢弃）
      const record = { ...base, ...values, 名称: name } as RecordItem;
      dispatch({
        type: 'UPSERT_RECORD',
        record,
        change: {
          id: `${id}-${Date.now()}`,
          记录ID: id,
          动作: '新增',
          字段: Object.keys(values),
          时间: now,
        },
      });
      dispatch({ type: 'SET_LAST_ISSUED_ID', id });
      writeLastIssuedId(id);
      // v6.2.1（需求 2）：新增表单里勾选的计划清单随保存一并写入 —— 新记录此刻才拿到 ID，
      // 成员关系在同一动作里落盘，绝不出现「先写记录、后补成员」的悬空窗口。
      if (planIds && planIds.length) {
        let plans = st.plans;
        const affected: string[] = [];
        for (const pid of planIds) {
          const next = addRecordToPlan(plans, pid, id);
          if (next !== plans) { affected.push(pid); plans = next; }
        }
        if (affected.length) {
          dispatch({ type: 'SET_PLANS', plans, changes: affected.map((p) => planChange(p, '编辑')) });
        }
      }
      return id;
    };

    const updateRecord = (id: number, values: Partial<RecordItem>) => {
      const st = current();
      const prev = st.records.find((r) => r.id === id);
      if (!prev) return;
      // v4 修复：不允许把「名称」改成空 —— 否则一条有效记录会被降级成空壳记录
      if ('名称' in values && !String(values.名称 ?? '').trim()) {
        dispatch({ type: 'SET_NOTICE', notice: '「名称」为必填项，未保存这次修改。' });
        return;
      }
      const changedFields = Object.keys(values).filter((k) => {
        const a = (prev as unknown as Record<string, unknown>)[k];
        const b = (values as unknown as Record<string, unknown>)[k];
        return JSON.stringify(a) !== JSON.stringify(b);
      });
      if (!changedFields.length) return; // 未改动不产生新版本（AC-7）
      const now = new Date().toISOString();
      dispatch({
        type: 'UPSERT_RECORD',
        record: { ...prev, ...values, 更新时间: now },
        change: {
          id: `${id}-${Date.now()}`,
          记录ID: id,
          动作: '编辑',
          字段: changedFields,
          时间: now,
        },
      });
    };

    const deleteRecord = (id: number) => {
      const st = current();
      if (!st.records.some((r) => r.id === id)) return;
      const now = new Date().toISOString();
      // v4：删除即物理删除（回收站已移除），没有恢复入口
      dispatch({
        type: 'DELETE_RECORD',
        id,
        change: { id: `${id}-${Date.now()}`, 记录ID: id, 动作: '删除', 字段: [], 时间: now },
      });
      // v6.2：顺带清理各计划清单里对这条记录的成员引用（清单本身不受影响）
      const cleaned = prunePlanMembers(st.plans, [id]);
      if (cleaned) {
        const affected = st.plans.filter((p) => p.记录ID列表.includes(id));
        dispatch({ type: 'SET_PLANS', plans: cleaned, changes: affected.map((p) => planChange(p.id, '编辑')) });
      }
    };

    /**
     * v4：一键清理「名称为空」的导入遗留空壳记录（如 795 号记录）。
     * 这些记录来自最初的表格导入，不是用户录入的；清理后随下一次同步写回远端。
     */
    const cleanupShellRecords = (): number => {
      const st = current();
      const shells = findShellRecords(st.records);
      if (!shells.length) {
        dispatch({ type: 'SET_NOTICE', notice: '没有需要清理的空壳记录。' });
        return 0;
      }
      const now = new Date().toISOString();
      dispatch({
        type: 'CLEANUP_SHELL',
        ids: shells.map((r) => r.id),
        changes: shells.map((r) => ({
          id: `${r.id}-${Date.now()}`,
          记录ID: r.id,
          动作: '删除' as const,
          字段: [],
          时间: now,
        })),
      });
      // v6.2：被清理的空壳记录同样从计划清单成员里剔除
      const cleanedPlans = prunePlanMembers(st.plans, shells.map((r) => r.id));
      if (cleanedPlans) {
        const affected = st.plans.filter((p) => shells.some((r) => p.记录ID列表.includes(r.id)));
        dispatch({ type: 'SET_PLANS', plans: cleanedPlans, changes: affected.map((p) => planChange(p.id, '编辑')) });
      }
      dispatch({
        type: 'SET_NOTICE',
        notice: `已清理 ${shells.length} 条名称为空的导入遗留记录，下次同步会写回仓库。`,
      });
      return shells.length;
    };

    /* -------- v6.1.1：待确认清单的忽略 / 恢复（浏览器本地持久化） -------- */
    const setIgnoredChecks = (entries: IgnoredCheckEntry[]) => {
      dispatch({ type: 'SET_IGNORED_CHECKS', entries });
      // 与发号水位同一持久化模式：动作里直接写本地存储，写失败要给用户提示（质检 P2-3）
      const outcome = writeIgnoredChecks(entries);
      const message = storageErrorNotice(outcome, '已忽略的待确认项');
      if (message) dispatch({ type: 'SET_NOTICE', notice: message });
    };

    const ignoreCheckItem = (item: ConflictEntry | SuggestionEntry) => {
      const st = current();
      if (st.ignoredChecks.some((e) => e.key === item.key)) return;
      setIgnoredChecks([
        ...st.ignoredChecks,
        { key: item.key, 摘要: checkSummary(item), ignoredAt: new Date().toISOString() },
      ]);
    };

    const ignoreAllChecks = () => {
      const st = current();
      const known = new Set(st.ignoredChecks.map((e) => e.key));
      const pending = computePendingChecks(st.records);
      const next = [...st.ignoredChecks];
      for (const item of [...pending.conflicts, ...pending.suggestions]) {
        if (!known.has(item.key)) {
          known.add(item.key);
          next.push({ key: item.key, 摘要: checkSummary(item), ignoredAt: new Date().toISOString() });
        }
      }
      if (next.length !== st.ignoredChecks.length) setIgnoredChecks(next);
    };

    const restoreIgnoredCheck = (key: string) => {
      const st = current();
      setIgnoredChecks(st.ignoredChecks.filter((e) => e.key !== key));
    };

    const restoreAllIgnoredChecks = () => {
      setIgnoredChecks([]);
    };

    /* -------- v6.2（需求 1）：计划清单的增删改与成员维护 -------- */
    /**
     * 计划清单的待同步队列条目：记录 ID 固定 0（不指向任何记录），
     * 字段[0] = '计划清单'、字段[1] = 清单 ID。作用有二：
     *   ① 阻断启动自动拉取（decideAutoPull 按 pendingCount 判断）
     *   ② 无基线快照时按「动过的清单」重建合并归属（plans.mergeWithoutBaseline）
     */
    const planChange = (planId: string, 动作: '新增' | '编辑' | '删除'): PendingChange => ({
      id: `${planId}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      记录ID: 0,
      动作,
      字段: ['计划清单', planId],
      时间: new Date().toISOString(),
    });

    const createPlanListAction = (name: string): string | null => {
      const st = current();
      const res = createPlanList(st.plans, name);
      if (!res) {
        dispatch({ type: 'SET_NOTICE', notice: '清单名称不能为空。' });
        return null;
      }
      dispatch({ type: 'SET_PLANS', plans: res.plans, changes: [planChange(res.plan.id, '新增')] });
      return res.plan.id;
    };

    const renamePlanListAction = (planId: string, name: string) => {
      const st = current();
      if (!st.plans.some((p) => p.id === planId)) return;
      const trimmed = name.trim();
      if (!trimmed) {
        dispatch({ type: 'SET_NOTICE', notice: '清单名称不能为空。' });
        return;
      }
      const plans = renamePlanList(st.plans, planId, trimmed);
      if (plans === st.plans) return;
      dispatch({ type: 'SET_PLANS', plans, changes: [planChange(planId, '编辑')] });
    };

    const deletePlanListAction = (planId: string) => {
      const st = current();
      if (!st.plans.some((p) => p.id === planId)) return;
      // 删除清单只移除记录关联，绝不删除记录本身（v6.2 需求 1）
      dispatch({ type: 'SET_PLANS', plans: deletePlanList(st.plans, planId), changes: [planChange(planId, '删除')] });
    };

    const toggleRecordInPlanAction = (planId: string, recordId: number) => {
      const st = current();
      if (!st.records.some((r) => r.id === recordId)) return;
      const target = st.plans.find((p) => p.id === planId);
      if (!target) return;
      const inPlan = target.记录ID列表.includes(recordId);
      const plans = inPlan
        ? removeRecordFromPlan(st.plans, planId, recordId)
        : addRecordToPlan(st.plans, planId, recordId);
      if (plans === st.plans) return;
      dispatch({ type: 'SET_PLANS', plans, changes: [planChange(planId, '编辑')] });
    };

    /* -------- v6.3（需求 2）：品牌 / 款式选项的沉淀、删除与恢复 -------- */
    /**
     * 字段选项的待同步队列条目：记录 ID 固定 0（不指向任何记录），
     * 字段[0] = '字段选项'、字段[1] = 字段 jsonKey。作用与计划清单一致：
     *   ① 阻断启动自动拉取（decideAutoPull 按 pendingCount 判断）
     *   ② 无基线快照时按「动过的字段」重建合并归属（options.mergeWithoutBaseline）
     */
    const optionChange = (fieldKey: string, 动作: '新增' | '编辑' | '删除'): PendingChange => ({
      id: `${fieldKey}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      记录ID: 0,
      动作,
      字段: ['字段选项', fieldKey],
      时间: new Date().toISOString(),
    });

    /** 某字段的当前录入候选（schema 选项 ∪ 已沉淀 − 已删除） */
    const candidatesOf = (st: AppState, fieldKey: string): string[] => {
      const f = st.schema.fields.find((x) => x.jsonKey === fieldKey);
      const opts = f?.type === 'enum' && f.allowNew ? f.options ?? [] : [];
      return effectiveOptionsFor(opts, st.options[fieldKey]);
    };

    const addFieldOptionAction = (fieldKey: string, value: string) => {
      const st = current();
      const trimmed = value.trim();
      if (!trimmed) return;
      if (candidatesOf(st, fieldKey).includes(trimmed)) return; // 已在候选里 → 幂等 no-op
      const inSchema = st.schema.fields.find((x) => x.jsonKey === fieldKey)?.options?.includes(trimmed) ?? false;
      const options = addOptionValue(st.options, fieldKey, trimmed, inSchema);
      if (options === st.options) return;
      dispatch({ type: 'SET_OPTIONS', options, changes: [optionChange(fieldKey, '新增')] });
    };

    const removeFieldOptionAction = (fieldKey: string, value: string) => {
      const st = current();
      const options = removeOptionValue(st.options, fieldKey, value);
      if (options === st.options) return;
      dispatch({ type: 'SET_OPTIONS', options, changes: [optionChange(fieldKey, '删除')] });
    };

    const restoreFieldOptionAction = (fieldKey: string, value: string) => {
      const st = current();
      const inSchema = st.schema.fields.find((x) => x.jsonKey === fieldKey)?.options?.includes(value) ?? false;
      const options = restoreOptionValue(st.options, fieldKey, value, inSchema);
      if (options === st.options) return;
      dispatch({ type: 'SET_OPTIONS', options, changes: [optionChange(fieldKey, '编辑')] });
    };

    const makeClient = (): GithubClient | null => {
      const st = current();
      if (!st.config) return null;
      const token = readToken();
      if (!token) return null;
      return new GithubClient({
        owner: st.config.owner,
        repo: st.config.repo,
        branch: st.config.branch,
        token,
      });
    };

    // v6.1.1：待确认清单不再拉取数据仓静态文件（pending-conflicts.json），
    // 改为按当前记录实时核对（computePendingChecks，见 Provider 派生段）。
    const loadSchemaAndConflicts = async (client: GithubClient) => {
      try {
        const remoteSchema = await client.getFile(SCHEMA_FILE_PATH);
        const parsed = JSON.parse(remoteSchema.content) as Partial<Schema>;
        dispatch({ type: 'SET_SCHEMA', schema: mergeSchema(DEFAULT_SCHEMA, parsed) });
      } catch { /* schema 取不到不阻断主流程，使用内置兜底 */ }
    };

    /**
     * v6.2（需求 1）：拉取并合并远端计划清单。
     * · 远端没有 plans.json（404）→ 保留本地清单，首次写回时创建该文件
     * · 远端有 → 与本地做三方合并（基线 = iw.plansBaseline，缺失时按待同步队列归属）
     * · 计划清单冲突不阻断记录主流程：合并结果优先保留本地，冲突以提示告知
     *   （记录冲突走专门的冲突面板；清单是轻量聚合，单人使用场景下不值得打断整个同步）
     */
    const pullPlans = async (client: GithubClient, st: AppState) => {
      let remoteSha: string;
      let remoteParsed: { plans: PlanItem[]; dataVersion: number };
      try {
        const remote = await client.getFile(PLANS_FILE_PATH);
        remoteSha = remote.sha;
        remoteParsed = parsePlansFile(remote.content);
      } catch (err) {
        if (err instanceof GithubError && err.kind === 'notfound') return; // 远端尚无清单文件
        throw err; // 其余错误（网络 / 鉴权）沿用外层记录同步的错误处理
      }
      const planRes = planPlansSync({
        local: st.plans,
        remote: remoteParsed.plans,
        baseline: readPlansBaseline(),
        pending: st.pending,
      });
      dispatch({
        type: 'SET_PLANS',
        plans: planRes.plans,
        baseSha: remoteSha,
        dataVersion: remoteParsed.dataVersion,
      });
      // 与记录基线同一纪律：只有「本地与远端完全一致」时基线才前移
      if (plansEqual(planRes.plans, remoteParsed.plans)) {
        writePlansBaseline(remoteParsed.plans);
      }
      if (planRes.conflicts.length) {
        dispatch({
          type: 'SET_NOTICE',
          notice: `计划清单有 ${planRes.conflicts.length} 处与远端不一致，已保留本地版本，下次同步会写回。`,
        });
      }
    };

    /**
     * v6.3（需求 2）：拉取并合并远端字段选项管理状态。
     * · 远端没有 options.json（404）→ 保留本地状态，首次写回时创建该文件
     * · 远端有 → 与本地做三方合并（基线 = iw.optionsBaseline，缺失时按待同步队列归属）
     * · 选项是集合语义（新增 ∪ / 删除 −），天然可合并，无字段级冲突，不阻断主流程
     */
    const pullOptions = async (client: GithubClient, st: AppState) => {
      let remoteSha: string;
      let remoteParsed: { state: FieldOptionsState; dataVersion: number };
      try {
        const remote = await client.getFile(OPTIONS_FILE_PATH);
        remoteSha = remote.sha;
        remoteParsed = parseOptionsFile(remote.content);
      } catch (err) {
        if (err instanceof GithubError && err.kind === 'notfound') return; // 远端尚无选项文件
        throw err; // 其余错误（网络 / 鉴权）沿用外层记录同步的错误处理
      }
      const res = mergeOptionsSync({
        local: st.options,
        remote: remoteParsed.state,
        baseline: readOptionsBaseline(),
        pending: st.pending,
      });
      dispatch({
        type: 'SET_OPTIONS',
        options: res.state,
        baseSha: remoteSha,
        dataVersion: remoteParsed.dataVersion,
      });
      // 与记录 / 清单基线同一纪律：只有「本地与远端完全一致」时基线才前移
      if (optionsStateEqual(res.state, remoteParsed.state)) {
        writeOptionsBaseline(remoteParsed.state);
      }
    };

    /**
     * v6.2（需求 1）：把计划清单写回远端（随 syncNow 一并执行）。
     * · 远端 sha 与本地记录的不一致时先做三方合并（记录主流程同款守卫）
     * · 写回前把成员引用裁剪到当前记录集合（记录已删的引用不落远端）
     * · 本地与远端内容一致时不产生新版本（与记录写回的 AC-7 同口径）
     */
    const syncPlans = async (client: GithubClient, recordsForPrune: RecordItem[]): Promise<boolean> => {
      const st = current();
      let remoteSha: string | null = null;
      let remotePlans: PlanItem[] = [];
      let remoteDataVersion = 0;
      try {
        const remote = await client.getFile(PLANS_FILE_PATH);
        remoteSha = remote.sha;
        const parsed = parsePlansFile(remote.content);
        remotePlans = parsed.plans;
        remoteDataVersion = parsed.dataVersion;
      } catch (err) {
        if (!(err instanceof GithubError && err.kind === 'notfound')) {
          const message = err instanceof GithubError ? err.message : '计划清单写回失败';
          dispatch({ type: 'SET_SYNC', status: 'error', message });
          recordAction('同步写回', '失败', `计划清单：${message}`);
          return false;
        }
        // 远端尚无 plans.json → 首次写回时创建（putFile sha 传 null）
      }

      let plans = st.plans;
      if (remoteSha !== null && remoteSha !== st.plansBaseSha) {
        // 远端清单已被改动 → 基线三方合并（与记录写回同一守卫，P1-1）
        const planRes = planPlansSync({
          local: st.plans,
          remote: remotePlans,
          baseline: readPlansBaseline(),
          pending: st.pending,
        });
        plans = planRes.plans;
        if (planRes.conflicts.length) {
          dispatch({
            type: 'SET_NOTICE',
            notice: `计划清单有 ${planRes.conflicts.length} 处与远端冲突，已按本地版本写回。`,
          });
        }
      }

      // 成员引用裁剪：记录已被删除的引用不写回远端
      const recordIds = new Set(recordsForPrune.map((r) => r.id));
      plans = plans.map((p) => {
        const kept = p.记录ID列表.filter((id) => recordIds.has(id));
        if (kept.length === p.记录ID列表.length) return p;
        return { ...p, 记录ID列表: kept, 更新时间: new Date().toISOString() };
      });

      if (plansEqual(plans, remotePlans)) {
        // 与远端一致：只对齐元数据与基线，不产生新版本
        if (remoteSha !== null) {
          dispatch({ type: 'SET_PLANS', plans: remotePlans, baseSha: remoteSha, dataVersion: remoteDataVersion });
          writePlansBaseline(remotePlans);
        }
        return true;
      }

      const payload = makePlansFile(plans, remoteDataVersion + 1);
      const message = `工作台计划清单 ${payload.dataVersion} · ${payload.totalCount} 份 · ${payload.updatedAt}`;
      const result = await client.putFile(PLANS_FILE_PATH, JSON.stringify(payload, null, 2), remoteSha, message);
      dispatch({ type: 'SET_PLANS', plans, baseSha: result.sha, dataVersion: payload.dataVersion });
      writePlansBaseline(plans);
      recordAction('同步写回', '成功', `已写入 ${payload.totalCount} 份计划清单（数据版本 ${payload.dataVersion}）`);
      return true;
    };

    /**
     * v6.3（需求 2）：把字段选项管理状态写回远端（随 syncNow 一并执行）。
     * · 远端 sha 与本地记录的不一致时先做三方合并（集合语义，无真冲突）
     * · 本地与远端内容一致时不产生新版本（与记录写回的 AC-7 同口径）
     */
    const syncOptions = async (): Promise<boolean> => {
      const st = current();
      const client = makeClient();
      if (!client) return false;
      let remoteSha: string | null = null;
      let remoteState: FieldOptionsState = {};
      let remoteDataVersion = 0;
      try {
        const remote = await client.getFile(OPTIONS_FILE_PATH);
        remoteSha = remote.sha;
        const parsed = parseOptionsFile(remote.content);
        remoteState = parsed.state;
        remoteDataVersion = parsed.dataVersion;
      } catch (err) {
        if (!(err instanceof GithubError && err.kind === 'notfound')) {
          const message = err instanceof GithubError ? err.message : '字段选项写回失败';
          dispatch({ type: 'SET_SYNC', status: 'error', message });
          recordAction('同步写回', '失败', `字段选项：${message}`);
          return false;
        }
        // 远端尚无 options.json → 首次写回时创建（putFile sha 传 null）
      }

      let state = st.options;
      if (remoteSha !== null && remoteSha !== st.optionsBaseSha) {
        // 远端选项已被改动 → 基线三方合并（集合语义，无字段级冲突）
        const res = mergeOptionsSync({
          local: st.options,
          remote: remoteState,
          baseline: readOptionsBaseline(),
          pending: st.pending,
        });
        state = res.state;
      }

      if (optionsStateEqual(state, remoteState)) {
        // 与远端一致：只对齐元数据与基线，不产生新版本
        if (remoteSha !== null) {
          dispatch({ type: 'SET_OPTIONS', options: remoteState, baseSha: remoteSha, dataVersion: remoteDataVersion });
          writeOptionsBaseline(remoteState);
        }
        return true;
      }

      const payload = makeOptionsFile(state, remoteDataVersion + 1);
      const message = `工作台字段选项 ${payload.dataVersion} · ${Object.keys(payload.fields).length} 个字段 · ${payload.updatedAt}`;
      const result = await client.putFile(OPTIONS_FILE_PATH, JSON.stringify(payload, null, 2), remoteSha, message);
      dispatch({ type: 'SET_OPTIONS', options: state, baseSha: result.sha, dataVersion: payload.dataVersion });
      writeOptionsBaseline(state);
      recordAction('同步写回', '成功', `已写入字段选项管理状态（数据版本 ${payload.dataVersion}）`);
      return true;
    };

    const pull = async (silent = false): Promise<boolean> => {
      const st = current();
      if (!st.config) return false;
      const client = makeClient();
      if (!client) {
        dispatch({ type: 'SET_CONNECTION', status: 'unconfigured' });
        return false;
      }
      dispatch({ type: 'SET_CONNECTION', status: 'connecting' });
      try {
        const remote = await client.getFile(DATA_FILE_PATH);
        const parsed = JSON.parse(remote.content) as {
          schemaVersion: number; dataVersion: number; updatedAt: string; records: RecordItem[];
        };
        const migration = applyMigrations(parsed, st.schema);
        if (migration.readOnly) {
          dispatch({
            type: 'SET_NOTICE',
            notice: '远端数据版本高于当前页面支持的版本，已进入只读模式，请更新工作台后再编辑。',
          });
          dispatch({ type: 'SET_CONNECTION', status: 'connected' });
          return false;
        }
        await loadSchemaAndConflicts(client);

        // v6.2（需求 1）：计划清单拉取与三方合并（远端尚无 plans.json 时视为空清单，不阻断记录主流程）
        await pullPlans(client, st);

        // v6.3（需求 2）：字段选项管理状态拉取与三方合并（远端尚无 options.json 时保留本地，不阻断主流程）
        await pullOptions(client, st);

        // 质检 P0-1 / P1-1 / P1-2 / P1-3：
        // 不再无条件用远端覆盖本地记录，而是基于「持久化基线快照」做真三方合并。
        // 本地未同步的改动一律保留；远端新增合入；远端已删不复活；真冲突交给用户裁决。
        const plan = planRemoteSync({
          local: st.records,
          remote: migration.records,
          baseline: normalizeToCurrent(readBaseline() ?? [], st.schema),
          pending: st.pending,
        });

        if (plan.kind === 'conflict') {
          dispatch({
            type: 'SET_CONFLICT_DETAIL',
            detail: {
              diffs: plan.conflicts,
              remoteRecords: migration.records,
              remoteSha: remote.sha,
            },
          });
          dispatch({ type: 'SET_SYNC', status: 'conflict', message: '远端数据已被更新，需要先处理冲突。' });
          dispatch({ type: 'SET_CONNECTION', status: 'connected' });
          recordAction('从仓库拉取', '失败', `远端有 ${plan.conflicts.length} 处字段级冲突，需先处理冲突`);
          return false;
        }

        dispatch({
          type: 'SET_RECORDS',
          records: plan.records,
          baseSha: remote.sha,
          dataVersion: parsed.dataVersion ?? 1,
          updatedAt: parsed.updatedAt,
          // 合并场景保留未同步队列；完全一致（fast-forward）时才清空
          keepPending: plan.kind !== 'fast-forward',
        });

        // 只有「本地与远端完全一致」时基线才能前移：
        // 合并过程中本地可能仍有尚未写回远端的改动，此时基线必须钉住，
        // 否则下一次合并会把这些改动误判成「本地未改」而被远端覆盖。
        if (plan.kind === 'fast-forward') {
          const outcome = writeBaseline(migration.records);
          const message = storageErrorNotice(outcome, '同步基线快照');
          if (message) dispatch({ type: 'SET_NOTICE', notice: message });
        }
        dispatch({ type: 'SET_CONNECTION', status: 'connected' });
        dispatch({ type: 'SET_AUTO_PULL_BLOCK', blocked: false, message: null });
        recordAction('从仓库拉取', '成功', plan.summary);
        if (!silent) {
          dispatch({ type: 'SET_NOTICE', notice: plan.summary });
        }
        return true;
      } catch (err) {
        const message = err instanceof GithubError ? err.message : '拉取失败，请稍后重试';
        dispatch({ type: 'SET_CONNECTION', status: err instanceof GithubError && err.kind === 'auth' ? 'invalid' : 'offline' });
        dispatch({ type: 'SET_SYNC', status: 'error', message });
        recordAction('从仓库拉取', '失败', message);
        if (!silent) dispatch({ type: 'SET_NOTICE', notice: message });
        return false;
      }
    };

    const syncNow = async (): Promise<boolean> => {
      const st = current();
      const client = makeClient();
      if (!client) {
        dispatch({ type: 'SET_NOTICE', notice: '尚未配置仓库与令牌，请先到设置页完成配置。' });
        return false;
      }
      // v4 修复（同步被阻断的根因）：
      // 写回前校验**只针对有效记录**（排除「名称为空」的导入遗留空壳记录与软删残留）。
      // v3 及更早版本把所有记录都算进必填校验，而数据里存在一条名称为空的历史导入记录，
      // 于是每次写回都被这条用户既看不到、也改不掉的记录挡住 —— 同步永久卡死。
      const issues = validateRecords(st.records, st.schema);
      if (issues.length) {
        const first = issues[0];
        const msg = `写回前校验未通过（${issues.length} 处）：${first.记录ID} 号记录的「${first.字段}」${first.问题}`;
        dispatch({ type: 'SET_SYNC', status: 'error', message: msg });
        recordAction('同步写回', '失败', msg);
        return false;
      }
      dispatch({ type: 'SET_SYNC', status: 'syncing' });
      try {
        const remote = await client.getFile(DATA_FILE_PATH);
        const remoteParsed = JSON.parse(remote.content) as {
          records: RecordItem[]; dataVersion?: number; updatedAt?: string;
        };
        const remoteRecords = remoteParsed.records ?? [];
        let records = st.records;

        // v3/v5 写回闸门：远端若仍带旧字段（关联 / 电子版缺码 / 电子版 / 纸质版），
        // 写回会把这些列静默抹掉。必须先由数据仓迁移脚本完成「归档旧字段取值 + 结构迁移」，
        // 才允许写回。
        const legacyKeys = findLegacyFieldKeys(remoteRecords);
        if (legacyKeys.length) {
          const msg = `远端数据仍包含已废弃字段（${legacyKeys.join('、')}），写回会覆盖掉这些历史取值。请先执行数据仓迁移（归档旧字段后再写回），再同步。`;
          dispatch({ type: 'SET_SYNC', status: 'error', message: msg });
          dispatch({
            type: 'SET_NOTICE',
            notice: `已拦截写回：远端仍有旧字段 ${legacyKeys.join('、')}。`,
          });
          recordAction('同步写回', '失败', `远端仍有已废弃字段 ${legacyKeys.join('、')}，需先执行数据仓迁移`);
          return false;
        }

        if (remote.sha !== st.baseSha) {
          // 远端已被改动 → 用「持久化基线快照」做真三方合并。
          // 质检 P1-1：基线必须是上次成功同步时的快照，不能拿本地当前值当基线
          // （那样 localChanged 恒为 false，字段级冲突检测恒空、本地改动被静默覆盖）。
          const plan = planRemoteSync({
            local: st.records,
            remote: remoteRecords,
            baseline: normalizeToCurrent(readBaseline() ?? [], st.schema),
            pending: st.pending,
          });
          if (plan.conflicts.length) {
            dispatch({
              type: 'SET_CONFLICT_DETAIL',
              detail: { diffs: plan.conflicts, remoteRecords, remoteSha: remote.sha },
            });
            dispatch({ type: 'SET_SYNC', status: 'conflict', message: '远端数据已被更新，需要先处理冲突。' });
            recordAction('同步写回', '失败', `远端有 ${plan.conflicts.length} 处字段级冲突，需先处理冲突`);
            return false;
          }
          records = plan.records;
        }

        // 合并结果与远端内容完全一致 → 没有需要写回的改动，只对齐元数据与基线
        if (!hasContentDiff(records, remoteRecords)) {
          dispatch({
            type: 'SET_RECORDS',
            records: remoteRecords,
            baseSha: remote.sha,
            dataVersion: remoteParsed.dataVersion ?? st.dataVersion,
            updatedAt: remoteParsed.updatedAt,
          });
          const baselineOutcome = writeBaseline(remoteRecords);
          const baselineMessage = storageErrorNotice(baselineOutcome, '同步基线快照');
          if (baselineMessage) dispatch({ type: 'SET_NOTICE', notice: baselineMessage });
          dispatch({ type: 'SET_SYNC', status: 'idle', message: '远端已是最新，无需写入。' });
          dispatch({ type: 'SET_NOTICE', notice: '远端已是最新，本次没有需要写回的改动。' });
          dispatch({ type: 'SET_AUTO_PULL_BLOCK', blocked: false, message: null });
          recordAction('同步写回', '成功', '远端已是最新，无需写入');
          // v6.2：记录无改动也要核对计划清单（可能只有清单改动）
          const plansOkNoDiff = await syncPlans(client, records);
          // v6.3：字段选项同理（可能只有选项改动）
          const optionsOkNoDiff = plansOkNoDiff ? await syncOptions() : false;
          if (plansOkNoDiff && !optionsOkNoDiff) {
            dispatch({ type: 'SET_NOTICE', notice: '记录已写回，但字段选项写回失败，请再次点「同步到 GitHub」重试。' });
            return false;
          }
          return plansOkNoDiff;
        }

        const payload = {
          schemaVersion: st.schema.schemaVersion,
          dataVersion: st.dataVersion + 1,
          updatedAt: new Date().toISOString(),
          // v4：回收站移除，recordCount = 实际记录数（不再区分未删除 / 已删除）
          recordCount: records.length,
          totalCount: records.length,
          records,
        };
        const message = `工作台同步 ${payload.dataVersion} · ${payload.recordCount} 条 · ${payload.updatedAt}`;
        const result = await client.putFile(DATA_FILE_PATH, JSON.stringify(payload, null, 2), remote.sha, message);
        dispatch({
          type: 'SET_RECORDS',
          records,
          baseSha: result.sha,
          dataVersion: payload.dataVersion,
          updatedAt: payload.updatedAt,
        });
        // 写回成功 → 基线前移到本次写出的内容（下一轮三方合并的 new base）
        const baselineOutcome = writeBaseline(records);
        const baselineMessage = storageErrorNotice(baselineOutcome, '同步基线快照');
        if (baselineMessage) dispatch({ type: 'SET_NOTICE', notice: baselineMessage });
        dispatch({ type: 'SET_SYNC', status: 'idle', message: '同步成功。' });
        dispatch({ type: 'SET_NOTICE', notice: '已同步到 GitHub 仓库。' });
        dispatch({ type: 'SET_AUTO_PULL_BLOCK', blocked: false, message: null });
        recordAction('同步写回', '成功', `已写入 ${payload.recordCount} 条记录（数据版本 ${payload.dataVersion}）`);
        // v6.2（需求 1）：记录写回成功后同步计划清单（失败时如实报错，记录已写回不受影响）
        const plansOk = await syncPlans(client, records);
        if (!plansOk) {
          dispatch({ type: 'SET_NOTICE', notice: '记录已写回，但计划清单写回失败，请再次点「同步到 GitHub」重试。' });
          return false;
        }
        // v6.3（需求 2）：记录与清单都写回成功后再写字段选项（失败时如实报错，前者已写回不受影响）
        const optionsOk = await syncOptions();
        if (!optionsOk) {
          dispatch({ type: 'SET_NOTICE', notice: '记录与计划清单已写回，但字段选项写回失败，请再次点「同步到 GitHub」重试。' });
          return false;
        }
        return true;
      } catch (err) {
        if (err instanceof GithubError && err.kind === 'conflict') {
          dispatch({ type: 'SET_SYNC', status: 'conflict', message: err.message });
          recordAction('同步写回', '失败', err.message);
          return false;
        }
        const message = err instanceof GithubError ? err.message : '同步失败';
        dispatch({
          type: 'SET_SYNC',
          status: err instanceof GithubError && err.kind === 'network' ? 'offline' : 'error',
          message,
        });
        dispatch({ type: 'SET_NOTICE', notice: message });
        recordAction('同步写回', '失败', message);
        return false;
      }
    };

    const resolveSyncConflict = async (choice: 'local' | 'remote' | 'merge'): Promise<boolean> => {
      const st = current();
      const detail = st.conflictDetail;
      const client = makeClient();
      if (!detail || !client) return false;

      // 强制导出本地版本（不可跳过，架构 4.4）
      const stamp = new Date();
      const y = stamp.getFullYear();
      const m = String(stamp.getMonth() + 1).padStart(2, '0');
      const d = String(stamp.getDate()).padStart(2, '0');
      const localText = JSON.stringify({
        schemaVersion: st.schema.schemaVersion,
        dataVersion: st.dataVersion,
        updatedAt: new Date().toISOString(),
        recordCount: countActive(st.records),
        totalCount: st.records.length,
        records: st.records,
      }, null, 2);
      const url = URL.createObjectURL(new Blob([localText], { type: 'application/json;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `信息汇总工作台-冲突前本地版本-${y}${m}${d}-${stamp.getHours()}${stamp.getMinutes()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      let records = st.records;
      if (choice === 'remote') {
        records = detail.remoteRecords;
      } else if (choice === 'merge') {
        // 质检 P1-1：三方合并的基线必须是持久化基线快照，不能拿本地当前值当基线。
        // 基线缺失时退化为「按待同步队列归属」的两方合并，差异会显式暴露成冲突而不是被覆盖。
        const plan = planRemoteSync({
          local: st.records,
          remote: detail.remoteRecords,
          baseline: normalizeToCurrent(readBaseline() ?? [], st.schema),
          pending: st.pending,
        });
        records = plan.records;
      }
      // choice === 'local' → 保留本地

      dispatch({ type: 'SET_CONFLICT_DETAIL', detail: null });
      dispatch({ type: 'SET_SYNC', status: 'syncing' });
      try {
        const payload = {
          schemaVersion: st.schema.schemaVersion,
          dataVersion: st.dataVersion + 1,
          updatedAt: new Date().toISOString(),
          // v4：回收站移除，recordCount = 实际记录数
          recordCount: countActive(records),
          totalCount: records.length,
          records,
        };
        const commitMessage = `工作台同步 ${payload.dataVersion} · ${payload.recordCount} 条 · ${payload.updatedAt}`;
        const result = await client.putFile(DATA_FILE_PATH, JSON.stringify(payload, null, 2), detail.remoteSha, commitMessage);
        dispatch({
          type: 'SET_RECORDS',
          records,
          baseSha: result.sha,
          dataVersion: payload.dataVersion,
          updatedAt: payload.updatedAt,
        });
        // 写回成功 → 基线前移
        const baselineOutcome = writeBaseline(records);
        const baselineMessage = storageErrorNotice(baselineOutcome, '同步基线快照');
        if (baselineMessage) dispatch({ type: 'SET_NOTICE', notice: baselineMessage });
        dispatch({ type: 'SET_SYNC', status: 'idle', message: '冲突已处理并写回。' });
        dispatch({ type: 'SET_NOTICE', notice: '冲突已处理：已为你保存本地版本，并按所选方案写回。' });
        dispatch({ type: 'SET_AUTO_PULL_BLOCK', blocked: false, message: null });
        recordAction('冲突处理写回', '成功', `按「${choice === 'local' ? '本地为准' : choice === 'remote' ? '远端为准' : '合并'}」写回 ${payload.recordCount} 条记录`);
        return true;
      } catch (err) {
        const message = err instanceof GithubError ? err.message : '冲突处理后写回失败';
        dispatch({ type: 'SET_SYNC', status: 'error', message });
        recordAction('冲突处理写回', '失败', message);
        return false;
      }
    };

    const saveConfig = async (input: {
      repoUrl: string; branch: string; token: string; sessionOnly: boolean;
    }): Promise<boolean> => {
      const parsed = parseRepoUrl(input.repoUrl);
      if (!parsed) {
        dispatch({ type: 'SET_NOTICE', notice: '仓库地址格式不正确，请填写 https://github.com/用户名/仓库名 或 用户名/仓库名。' });
        return false;
      }
      const branch = input.branch.trim() || 'main';
      writeConfig({
        owner: parsed.owner,
        repo: parsed.repo,
        branch,
        token: input.token.trim(),
        sessionOnly: input.sessionOnly,
      });
      dispatch({
        type: 'SET_CONFIG',
        config: { owner: parsed.owner, repo: parsed.repo, branch, sessionOnly: input.sessionOnly },
      });
      dispatch({ type: 'SET_CONNECTION', status: 'connecting' });
      const ok = await pull(true);
      if (ok) {
        dispatch({ type: 'SET_NOTICE', notice: '配置成功，已连接并拉取数据。' });
      }
      return ok;
    };

    const clearConfigAction = () => {
      clearConfig();
      dispatch({ type: 'SET_CONFIG', config: null });
      dispatch({ type: 'SET_CONNECTION', status: 'unconfigured' });
      dispatch({ type: 'SET_NOTICE', notice: '已清除配置，本地不再保存令牌。' });
    };

    const testConnection = async (): Promise<boolean> => {
      const st = current();
      if (!st.config) {
        dispatch({ type: 'SET_NOTICE', notice: '请先保存仓库地址与令牌。' });
        return false;
      }
      const token = readToken();
      if (!token) {
        dispatch({ type: 'SET_NOTICE', notice: '未找到令牌，请重新保存配置。' });
        return false;
      }
      dispatch({ type: 'SET_CONNECTION', status: 'connecting' });
      const client = new GithubClient({
        owner: st.config.owner, repo: st.config.repo, branch: st.config.branch, token,
      });
      const res = await client.checkConnection();
      dispatch({ type: 'SET_CONNECTION', status: res.ok ? 'connected' : 'invalid' });
      dispatch({ type: 'SET_NOTICE', notice: res.ok ? '连接正常。' : `连接失败：${res.message}` });
      return res.ok;
    };

    const exportRange = (scope: 'all' | 'filtered'): RecordItem[] => {
      const st = current();
      if (scope === 'all') return st.records;
      // 质检 P2-1：导出与列表必须同口径 —— 同一套筛选、同一套搜索、同一排序。
      // 原来这里用的是一套简化版 includes 匹配，与列表页的索引搜索结果对不上。
      // v6.2：按计划清单筛选的口径也一并对齐（导出结果与列表一致）。
      const list = applyQuery(st.records, st.filters, st.query, st.indexes, buildPlanMembers(st.plans));
      return sortRecords(list, st.sort);
    };

    const exportJson = (scope: 'all' | 'filtered') => {
      const st = current();
      const list = exportRange(scope);
      const meta = {
        scope: scope === 'all' ? '全部记录' : '当前筛选命中记录',
        exportedAt: new Date().toISOString(),
        count: list.length,
      };
      downloadJson(list, st.schema, meta, st.dataVersion);
      dispatch({ type: 'SET_NOTICE', notice: `已导出 ${list.length} 条记录（JSON）。` });
      recordAction('本地备份导出', '成功', `导出 ${list.length} 条记录（JSON）`);
    };

    const exportXlsx = (scope: 'all' | 'filtered') => {
      const st = current();
      const list = exportRange(scope);
      const stats = computeStats(list);
      downloadXlsx(list, st.schema, buildStatsRows(stats));
      dispatch({ type: 'SET_NOTICE', notice: `已导出 ${list.length} 条记录（Excel）。` });
      recordAction('本地备份导出', '成功', `导出 ${list.length} 条记录（Excel）`);
    };

    return {
      setFilters: (filters) => dispatch({ type: 'SET_FILTERS', filters }),
      toggleFilter,
      clearFilters: () => dispatch({ type: 'SET_FILTERS', filters: { ...EMPTY_FILTERS } }),
      setQuery: (query) => dispatch({ type: 'SET_QUERY', query }),
      setSort: (sort) => dispatch({ type: 'SET_SORT', sort }),
      setPage: (page) => dispatch({ type: 'SET_PAGE', page }),
      setColumns: (columns) => dispatch({ type: 'SET_COLUMNS', columns }),
      setPageSize: (size) => dispatch({ type: 'SET_PAGE_SIZE', size }),
      savePreset: (name) => {
        const st = current();
        const preset = {
          id: `${Date.now()}`,
          name,
          filters: st.filters,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'SET_PRESETS', presets: [...st.presets, preset] });
      },
      deletePreset: (id) => {
        const st = current();
        dispatch({ type: 'SET_PRESETS', presets: st.presets.filter((p) => p.id !== id) });
      },
      addRecord,
      updateRecord,
      deleteRecord,
      cleanupShellRecords,
      ignoreCheckItem,
      ignoreAllChecks,
      restoreIgnoredCheck,
      restoreAllIgnoredChecks,
      createPlanList: createPlanListAction,
      renamePlanList: renamePlanListAction,
      deletePlanList: deletePlanListAction,
      toggleRecordInPlan: toggleRecordInPlanAction,
      addFieldOption: addFieldOptionAction,
      removeFieldOption: removeFieldOptionAction,
      restoreFieldOption: restoreFieldOptionAction,
      saveConfig,
      clearConfigAction,
      testConnection,
      pull,
      syncNow,
      resolveSyncConflict,
      closeConflict: () => dispatch({ type: 'SET_CONFLICT_DETAIL', detail: null }),
      exportJson,
      exportXlsx,
      setBackupInterval: (days) => dispatch({ type: 'SET_BACKUP_INTERVAL', days }),
      dismissNotice: () => dispatch({ type: 'SET_NOTICE', notice: null }),
    };
  }, []);

  /* -------- v6.1.1：待确认清单动态核对 --------
   * 打开工作台即按当前记录实时重算矛盾项与建议补全项（规则见 store/pendingChecks.ts）。
   * 用户修复记录后条目自动消失；全部处理完（或全部忽略）横幅不显示。 */
  const pendingChecks = useMemo(() => computePendingChecks(state.records), [state.records]);

  /* -------- v6.2（需求 1）：计划清单成员索引（列表筛选 / 详情展示共用派生） -------- */
  const planMembers = useMemo(() => buildPlanMembers(state.plans), [state.plans]);

  /* -------- v6.3（需求 2）：受管字段的录入候选（schema 选项 ∪ 沉淀 − 删除） -------- */
  const optionCandidates = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of state.schema.fields) {
      if (f.type !== 'enum' || !f.allowNew || f.system || f.readonly) continue;
      out[f.jsonKey] = effectiveOptionsFor(f.options ?? [], state.options[f.jsonKey]);
    }
    return out;
  }, [state.schema, state.options]);

  const value = useMemo(
    () => ({
      ...state,
      conflicts: pendingChecks.conflicts,
      suggestions: pendingChecks.suggestions,
      planMembers,
      /** v6.3：受管字段（品牌 / 款式）的录入候选（schema 选项 ∪ 沉淀 − 删除） */
      optionCandidates,
      actions,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, pendingChecks, planMembers, version],
  );

  /* -------- 启动时自动拉取（质检 P0-1） -------- */
  // 本地存在未同步改动时禁止自动拉取：原实现无条件 pull 会用远端覆盖本地记录
  // 并清空离线暂存队列，用户「改了没同步就关页」的改动会被永久抹掉。
  const pulledRef = useRef(false);
  useEffect(() => {
    if (pulledRef.current) return;
    pulledRef.current = true;
    if (!state.config) return;
    const st = stateRef.current;
    const decision = decideAutoPull({
      local: st.records,
      baseline: normalizeToCurrent(readBaseline() ?? [], st.schema),
      pendingCount: st.pending.length,
    });
    if (!decision.allow) {
      dispatch({ type: 'SET_AUTO_PULL_BLOCK', blocked: true, message: decision.message });
      return;
    }
    void actions.pull(true);
  }, [state.config, actions]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}
