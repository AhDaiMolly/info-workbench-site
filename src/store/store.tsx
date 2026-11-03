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
  ActionLogEntry, ConflictEntry, ConnectionStatus, Filters, RecordItem, Schema, SortSpec, SuggestionEntry,
} from '../types';
import { EMPTY_FILTERS } from '../types';
import { DEFAULT_SCHEMA, mergeSchema } from '../schema';
import { buildIndexes, type Indexes } from './selectors';
import {
  applyMigrations, findLegacyFieldKeys, findShellRecords, nextRecordId, normalizeToCurrent, validateRecords,
} from './migrations';
import {
  appendActionLog, clearConfig, readActionLog, readBaseline, readCache, readConfigMeta,
  readLastIssuedId, readPending, readPrefs, readSettings, readToken, writeBaseline, writeCache,
  writeConfig, writeLastIssuedId, writePending, writePrefs, writeSettings,
  type ConfigMeta, type PendingChange, type WriteOutcome,
} from './persist';
import { GithubClient, GithubError, parseRepoUrl } from '../sync/github';
import { hasContentDiff, type FieldDiff } from '../sync/conflict';
import { decideAutoPull, planRemoteSync } from './syncPolicy';
import { downloadJson, downloadXlsx, buildStatsRows } from '../export/exporters';
import { applyQuery, computeStats, sortRecords } from './selectors';

export const DATA_FILE_PATH = 'data/records.json';
export const SCHEMA_FILE_PATH = 'data/schema.json';
export const CONFLICTS_FILE_PATH = 'data/pending-conflicts.json';
export const AUDIT_FILE_PATH = 'data/migration-audit.json';

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
  conflicts: ConflictEntry[];
  suggestions: SuggestionEntry[];
  /** 已确认（用户处理过）的冲突条目 ID 集合 */
  resolvedConflicts: number[];
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
  | { type: 'SET_CONFLICTS'; conflicts: ConflictEntry[]; suggestions: SuggestionEntry[] }
  | { type: 'RESOLVE_CONFLICT_ITEM'; recordId: number }
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
    case 'SET_CONFLICTS':
      return { ...state, conflicts: action.conflicts, suggestions: action.suggestions };
    case 'RESOLVE_CONFLICT_ITEM':
      return {
        ...state,
        resolvedConflicts: state.resolvedConflicts.includes(action.recordId)
          ? state.resolvedConflicts
          : [...state.resolvedConflicts, action.recordId],
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
    conflicts: [],
    suggestions: [],
    resolvedConflicts: [],
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
  addRecord: (values: Partial<RecordItem>) => number | null;
  updateRecord: (id: number, values: Partial<RecordItem>) => void;
  /** v4：删除即物理删除（无回收站） */
  deleteRecord: (id: number) => void;
  /** v4：一键清理「名称为空」的导入遗留空壳记录，返回清理条数 */
  cleanupShellRecords: () => number;
  resolveConflictItem: (recordId: number) => void;
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

const AppContext = createContext<(AppState & { actions: AppActions }) | null>(null);

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
    });
    // 质检 P2-3：本地存储写失败（配额超限）必须让用户知道，不能静默失败
    const message = storageErrorNotice(outcome, '最新数据');
    if (message) dispatch({ type: 'SET_NOTICE', notice: message });
  }, [state.records, state.schema, state.baseSha, state.dataVersion, state.lastSyncedAt]);

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

    const addRecord = (values: Partial<RecordItem>): number | null => {
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
      dispatch({
        type: 'SET_NOTICE',
        notice: `已清理 ${shells.length} 条名称为空的导入遗留记录，下次同步会写回仓库。`,
      });
      return shells.length;
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

    const loadSchemaAndConflicts = async (client: GithubClient) => {
      try {
        const remoteSchema = await client.getFile(SCHEMA_FILE_PATH);
        const parsed = JSON.parse(remoteSchema.content) as Partial<Schema>;
        dispatch({ type: 'SET_SCHEMA', schema: mergeSchema(DEFAULT_SCHEMA, parsed) });
      } catch { /* schema 取不到不阻断主流程，使用内置兜底 */ }
      try {
        const remoteConflicts = await client.getFile(CONFLICTS_FILE_PATH);
        const parsed = JSON.parse(remoteConflicts.content) as {
          conflicts?: ConflictEntry[]; suggestions?: SuggestionEntry[];
        };
        dispatch({
          type: 'SET_CONFLICTS',
          conflicts: parsed.conflicts ?? [],
          suggestions: parsed.suggestions ?? [],
        });
      } catch { /* 冲突清单取不到不阻断主流程 */ }
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
          return true;
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
      const list = applyQuery(st.records, st.filters, st.query, st.indexes);
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
      resolveConflictItem: (recordId) => dispatch({ type: 'RESOLVE_CONFLICT_ITEM', recordId }),
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

  const value = useMemo(
    () => ({ ...state, actions }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, version],
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
