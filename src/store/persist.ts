/**
 * 信息汇总工作台 · 浏览器本地存储（架构 4.3 / 4.5）
 *
 * 六个键（ARCH L3 层）：
 *   iw.config   连接配置（仓库 + 令牌）——令牌只在发起 API 请求时读取，不进全局状态
 *   iw.cache    本地数据缓存（记录 + schema + 基线 sha + dataVersion）
 *   iw.pending  离线暂存队列（未同步改动）
 *   iw.baseline 上次成功同步时的记录快照 —— 三方合并的基线（质检 P1-1）
 *   iw.prefs    界面偏好（显示列、排序、分页、筛选方案）
 *   iw.settings 设置项（备份周期等）
 *
 * ⚠️ 令牌永不写入 URL / 日志 / commit message / 导出文件 / 构建产物。
 */

import type { FilterPreset, RecordItem, RepoConfig, Schema, SortSpec } from '../types';

export const STORAGE_KEYS = {
  config: 'iw.config',
  cache: 'iw.cache',
  pending: 'iw.pending',
  baseline: 'iw.baseline',
  prefs: 'iw.prefs',
  settings: 'iw.settings',
} as const;

/** 写入结果：配额超限必须能被上层感知，不能静默失败（质检 P2-3） */
export type WriteOutcome = 'ok' | 'quota' | 'error';

/** localStorage 不可用时（隐私模式等）降级为内存兜底 */
const memoryStore = new Map<string, string>();

function safeStorage(kind: 'local' | 'session'): Storage {
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage;
    const probe = '__iw_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    const shim: Storage = {
      get length() { return memoryStore.size; },
      clear: () => memoryStore.clear(),
      getItem: (k: string) => memoryStore.get(k) ?? null,
      key: (i: number) => [...memoryStore.keys()][i] ?? null,
      removeItem: (k: string) => { memoryStore.delete(k); },
      setItem: (k: string, v: string) => { memoryStore.set(k, v); },
    };
    return shim;
  }
}

/** 会话模式下用 sessionStorage，否则用 localStorage */
export function storageFor(sessionOnly: boolean): Storage {
  return safeStorage(sessionOnly ? 'session' : 'local');
}

/** 判断异常是否为浏览器存储配额超限 */
export function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; code?: number } | null;
  if (!e) return false;
  return e.name === 'QuotaExceededError'
    || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || e.code === 22
    || e.code === 1014;
}

function readJson<T>(key: string, storage: Storage): T | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown, storage: Storage): WriteOutcome {
  try {
    storage.setItem(key, JSON.stringify(value));
    return 'ok';
  } catch (err) {
    return isQuotaError(err) ? 'quota' : 'error';
  }
}

function removeKey(key: string, storage: Storage): void {
  try {
    storage.removeItem(key);
  } catch { /* ignore */ }
}

/* ------------------------------ 连接配置 ------------------------------ */

export interface ConfigMeta {
  owner: string;
  repo: string;
  branch: string;
  sessionOnly: boolean;
}

export function readConfigMeta(): ConfigMeta | null {
  const local = readJson<RepoConfig>(STORAGE_KEYS.config, safeStorage('local'));
  const session = readJson<RepoConfig>(STORAGE_KEYS.config, safeStorage('session'));
  const raw = session ?? local;
  if (!raw || !raw.owner || !raw.repo) return null;
  return { owner: raw.owner, repo: raw.repo, branch: raw.branch || 'main', sessionOnly: Boolean(session) };
}

/** 令牌单独读取：仅在发起 API 请求时调用，不常驻全局状态 */
export function readToken(): string | null {
  const session = readJson<RepoConfig>(STORAGE_KEYS.config, safeStorage('session'));
  if (session?.token) return session.token;
  const local = readJson<RepoConfig>(STORAGE_KEYS.config, safeStorage('local'));
  return local?.token ?? null;
}

export function writeConfig(cfg: RepoConfig): void {
  const localStore = safeStorage('local');
  const sessionStore = safeStorage('session');
  // 先清掉另一处，避免令牌残留
  removeKey(STORAGE_KEYS.config, cfg.sessionOnly ? localStore : sessionStore);
  writeJson(STORAGE_KEYS.config, cfg, cfg.sessionOnly ? sessionStore : localStore);
}

export function clearConfig(): void {
  removeKey(STORAGE_KEYS.config, safeStorage('local'));
  removeKey(STORAGE_KEYS.config, safeStorage('session'));
}

/* -------------------------------- 缓存 -------------------------------- */

export interface CachedData {
  schemaVersion: number;
  dataVersion: number;
  updatedAt: string;
  records: RecordItem[];
  schema: Schema | null;
  baseSha: string | null;
  lastSyncedAt: string | null;
}

export function readCache(): CachedData | null {
  return readJson<CachedData>(STORAGE_KEYS.cache, safeStorage('local'));
}

export function writeCache(data: CachedData): WriteOutcome {
  return writeJson(STORAGE_KEYS.cache, data, safeStorage('local'));
}

export function clearCache(): void {
  removeKey(STORAGE_KEYS.cache, safeStorage('local'));
}

/* ----------------------- 同步基线快照（三方合并） ----------------------- */

/**
 * 上次成功同步（拉取或写回）时的记录快照 —— 三方合并的基线。
 * 缺了它，合并时只能拿「本地当前值」当基线，字段级冲突检测会恒空（质检 P1-1）。
 */
export function readBaseline(): RecordItem[] | null {
  const raw = readJson<RecordItem[]>(STORAGE_KEYS.baseline, safeStorage('local'));
  return Array.isArray(raw) ? raw : null;
}

export function writeBaseline(records: RecordItem[]): WriteOutcome {
  return writeJson(STORAGE_KEYS.baseline, records, safeStorage('local'));
}

export function clearBaseline(): void {
  removeKey(STORAGE_KEYS.baseline, safeStorage('local'));
}

/* ------------------------------ 待同步队列 ------------------------------ */

export interface PendingChange {
  /** 变更条目的唯一标识（记录 ID + 时间戳），非业务主键 */
  id: string;
  记录ID: number;
  动作: '新增' | '编辑' | '删除' | '恢复';
  字段: string[];
  时间: string;
}

export interface PendingQueue {
  baseSha: string | null;
  changes: PendingChange[];
}

export function readPending(): PendingQueue {
  return readJson<PendingQueue>(STORAGE_KEYS.pending, safeStorage('local')) ?? { baseSha: null, changes: [] };
}

export function writePending(queue: PendingQueue): WriteOutcome {
  return writeJson(STORAGE_KEYS.pending, queue, safeStorage('local'));
}

export function clearPending(): void {
  removeKey(STORAGE_KEYS.pending, safeStorage('local'));
}

/* ------------------------------ 界面偏好 ------------------------------ */

export interface Prefs {
  columns: string[];
  sort: SortSpec;
  pageSize: number;
  presets: FilterPreset[];
}

export function readPrefs(): Partial<Prefs> {
  return readJson<Partial<Prefs>>(STORAGE_KEYS.prefs, safeStorage('local')) ?? {};
}

export function writePrefs(prefs: Prefs): void {
  writeJson(STORAGE_KEYS.prefs, prefs, safeStorage('local'));
}

/* -------------------------------- 设置 -------------------------------- */

export interface Settings {
  backupIntervalDays: number;
}

export function readSettings(): Settings {
  return readJson<Settings>(STORAGE_KEYS.settings, safeStorage('local')) ?? { backupIntervalDays: 7 };
}

export function writeSettings(settings: Settings): void {
  writeJson(STORAGE_KEYS.settings, settings, safeStorage('local'));
}
