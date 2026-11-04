/**
 * 信息汇总工作台 · 浏览器本地存储（架构 4.3 / 4.5）
 *
 * 十个键（ARCH L3 层）：
 *   iw.config   连接配置（仓库 + 令牌）——令牌只在发起 API 请求时读取，不进全局状态
 *   iw.cache    本地数据缓存（记录 + schema + 基线 sha + dataVersion）
 *   iw.pending  离线暂存队列（未同步改动）
 *   iw.baseline 上次成功同步时的记录快照 —— 三方合并的基线（质检 P1-1）
 *   iw.prefs    界面偏好（显示列、排序、分页、筛选方案）
 *   iw.settings 设置项（备份周期等）
 *   iw.actionlog 同步 / 备份操作日志（v4：只保留最近 3 条）
 *   iw.maxid    记录 ID 发号水位（v4：保证删除记录后 ID 不复用）
 *   iw.ignoredChecks 已忽略的待确认项（v6.1.1：单人使用，只存浏览器本地）
 *   iw.plansBaseline 上次成功同步时的计划清单快照 —— plans.json 三方合并的基线（v6.2）
 *   iw.optionsBaseline 上次成功同步时的字段选项管理状态快照 —— options.json 三方合并的基线（v6.3）
 *
 * ⚠️ 令牌永不写入 URL / 日志 / commit message / 导出文件 / 构建产物。
 */

import type { ActionLogEntry, FieldOptionsState, FilterPreset, Filters, PlanItem, RecordItem, RepoConfig, Schema, SortSpec } from '../types';
import type { IgnoredCheckEntry } from './pendingChecks';
import { LEGACY_FIELD_ALIAS, REMOVED_FIELD_KEYS } from '../schema';

export const STORAGE_KEYS = {
  config: 'iw.config',
  cache: 'iw.cache',
  pending: 'iw.pending',
  baseline: 'iw.baseline',
  prefs: 'iw.prefs',
  settings: 'iw.settings',
  actionlog: 'iw.actionlog',
  maxid: 'iw.maxid',
  /** v6.1.1：待确认清单的「已忽略项」（单人使用，浏览器本地持久化即可） */
  ignoredChecks: 'iw.ignoredChecks',
  /** v6.2：计划清单的同步基线快照（plans.json 三方合并基线） */
  plansBaseline: 'iw.plansBaseline',
  /** v6.3：字段选项管理的同步基线快照（options.json 三方合并基线） */
  optionsBaseline: 'iw.optionsBaseline',
} as const;

/** v4：操作日志最多保留的条数 */
export const ACTION_LOG_LIMIT = 3;

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
  /** v6.2：计划清单本地缓存（无则视为空） */
  plans?: PlanItem[] | null;
  /** v6.2：plans.json 的远端 sha（null = 远端尚无该文件） */
  plansBaseSha?: string | null;
  /** v6.2：plans.json 的数据版本 */
  plansDataVersion?: number;
  /** v6.3：字段选项管理状态本地缓存（无则视为空） */
  options?: FieldOptionsState | null;
  /** v6.3：options.json 的远端 sha（null = 远端尚无该文件） */
  optionsBaseSha?: string | null;
  /** v6.3：options.json 的数据版本 */
  optionsDataVersion?: number;
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

/* ------------------- 计划清单同步基线（v6.2） ------------------- */

/**
 * 上次成功同步（拉取或写回）时的计划清单快照 —— plans.json 三方合并的基线。
 * 与记录基线（iw.baseline）同一模式：缺了它只能按待同步队列归属做两方合并。
 */
export function readPlansBaseline(): PlanItem[] | null {
  const raw = readJson<PlanItem[]>(STORAGE_KEYS.plansBaseline, safeStorage('local'));
  return Array.isArray(raw) ? raw : null;
}

export function writePlansBaseline(plans: PlanItem[]): WriteOutcome {
  return writeJson(STORAGE_KEYS.plansBaseline, plans, safeStorage('local'));
}

export function clearPlansBaseline(): void {
  removeKey(STORAGE_KEYS.plansBaseline, safeStorage('local'));
}

/* ------------------- 字段选项管理同步基线（v6.3） ------------------- */

/**
 * 上次成功同步（拉取或写回）时的字段选项管理状态快照 —— options.json 三方合并的基线。
 * 与记录 / 计划清单基线同一模式；空对象也是合法基线，只有 null 才触发队列重建。
 */
export function readOptionsBaseline(): FieldOptionsState | null {
  const raw = readJson<FieldOptionsState>(STORAGE_KEYS.optionsBaseline, safeStorage('local'));
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

export function writeOptionsBaseline(state: FieldOptionsState): WriteOutcome {
  return writeJson(STORAGE_KEYS.optionsBaseline, state, safeStorage('local'));
}

export function clearOptionsBaseline(): void {
  removeKey(STORAGE_KEYS.optionsBaseline, safeStorage('local'));
}

/* ------------------------------ 待同步队列 ------------------------------ */

export interface PendingChange {
  /** 变更条目的唯一标识（记录 ID + 时间戳），非业务主键 */
  id: string;
  记录ID: number;
  /** v4：移除回收站后动作只有「新增 / 编辑 / 删除」，删除即物理删除 */
  动作: '新增' | '编辑' | '删除';
  字段: string[];
  时间: string;
}

export interface PendingQueue {
  baseSha: string | null;
  changes: PendingChange[];
}

export function readPending(): PendingQueue {
  const raw = readJson<PendingQueue>(STORAGE_KEYS.pending, safeStorage('local')) ?? { baseSha: null, changes: [] };
  // v3：待同步队列里记录的字段名同步改名 / 剔除（仅影响界面展示的字段清单）
  // v5（R5）：被合并的旧键（电子版 / 纸质版）统一显示为「拥有形态」
  raw.changes = (raw.changes ?? []).map((c) => ({
    ...c,
    字段: (c.字段 ?? [])
      .map((f) => normalizeFieldLabel(f))
      .filter((f) => !REMOVED_FIELD_KEYS.includes(f)),
  }));
  return raw;
}

export function writePending(queue: PendingQueue): WriteOutcome {
  return writeJson(STORAGE_KEYS.pending, queue, safeStorage('local'));
}

export function clearPending(): void {
  removeKey(STORAGE_KEYS.pending, safeStorage('local'));
}

/* ------------------ 旧字段名归一（v3 兼容 + v5 合并兼容） ------------------ */

/**
 * v5（R5）：被「拥有形态」合并掉的旧键 → 新字段名。
 *
 * 迁移链是两级：先走 v3 的改名表（拥有电子版 → 电子版），再走本表（电子版 → 拥有形态）。
 */
const MERGED_TO_NEW_KEY: Record<string, string> = {
  电子版: '拥有形态',
  纸质版: '拥有形态',
};

/**
 * v5（R1）：旧列表列名 → 新列表列名。
 *
 * 旧版列表里的「电子版」「纸质版」两列在新模型下由派生列「形态」统一承载，
 * 因此映射到「形态」而不是新字段名「拥有形态」（后者不是数据列）。
 */
const LEGACY_COLUMN_ALIAS: Record<string, string> = {
  电子版: '形态',
  纸质版: '形态',
  拥有电子版: '形态',
  拥有纸质版: '形态',
};

/** 字段标签归一：v3 改名 → v5 合并 */
export function normalizeFieldLabel(f: unknown): string {
  if (typeof f !== 'string') return '';
  const aliased = f in LEGACY_FIELD_ALIAS ? LEGACY_FIELD_ALIAS[f] : f;
  return aliased in MERGED_TO_NEW_KEY ? MERGED_TO_NEW_KEY[aliased] : aliased;
}

/**
 * 把界面偏好里的旧字段名换成新字段名：
 *   · 「拥有电子版」→「电子版」→「拥有形态」（v5 合并）
 *   · 「电子版缺码」「关联」已删除 → 直接剔除
 * 目的：老用户浏览器里的本地偏好不会因为改名 / 合并而失效，也不会出现「选了一个已删除的列」。
 */
export function normalizeLegacyNames(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input
      .filter((v) => !REMOVED_FIELD_KEYS.includes(String(v)))
      .map((v) => (typeof v === 'string' && v in LEGACY_FIELD_ALIAS ? LEGACY_FIELD_ALIAS[v] : v));
  }
  if (input && typeof input === 'object') {
    const src = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (REMOVED_FIELD_KEYS.includes(k)) continue;
      const key = k in LEGACY_FIELD_ALIAS ? LEGACY_FIELD_ALIAS[k] : k;
      if ((key === '电子版' || key === '纸质版') && typeof v === 'boolean') {
        // 旧的布尔三态筛选 → 新的枚举多选筛选（已是数组的新格式保持原样）
        out[key] = v === true ? ['有'] : ['没有'];
        continue;
      }
      out[key] = v;
    }
    return out;
  }
  return input;
}

/**
 * v5：列清单归一。
 *
 * 旧偏好里的「电子版」「纸质版」（或更早的「拥有电子版」「拥有纸质版」）列
 * 映射到派生列「形态」；同一列只保留一次，保持原有顺序。
 */
export function normalizeColumns(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== 'string') continue;
    if (REMOVED_FIELD_KEYS.includes(v)) continue;
    const aliased = v in LEGACY_FIELD_ALIAS ? LEGACY_FIELD_ALIAS[v] : v;
    const key = aliased in LEGACY_COLUMN_ALIAS ? LEGACY_COLUMN_ALIAS[aliased] : aliased;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** 旧三态取值（'有' / '没有' / '不确定'）里只有 '有' 能表达「拥有」 */
function legacyOwnershipPicked(v: unknown): boolean {
  const vals = Array.isArray(v)
    ? v.map((x) => String(x))
    : (typeof v === 'boolean' ? [v ? '有' : '没有'] : []);
  return vals.includes('有');
}

/**
 * v5（R5）：筛选条件归一 —— 旧的两个单选筛选合并为「拥有形态」多选。
 *
 *   · 电子版 = ['有']      → 拥有形态 含「电子版」
 *   · 纸质版 = ['有']      → 拥有形态 含「纸质版」
 *   · 电子版 = ['没有']    → 无法表达（新模型里「没有电子版」＝不含该项），丢弃
 *   · 电子版 = ['不确定']  → 同上，丢弃（v5 取消「不确定」态）
 *
 * 已经是新格式的「拥有形态」原样保留（并与旧键合并去重）。
 */
export function normalizeFilters(input: unknown): Filters {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== 'object') return out as unknown as Filters;
  const src = input as Record<string, unknown>;
  const ownership: string[] = [];
  for (const [k, v] of Object.entries(src)) {
    if (REMOVED_FIELD_KEYS.includes(k)) continue;
    const aliased = k in LEGACY_FIELD_ALIAS ? LEGACY_FIELD_ALIAS[k] : k;
    if (aliased === '电子版' || aliased === '纸质版') {
      if (legacyOwnershipPicked(v)) {
        const target = aliased === '电子版' ? '电子版' : '纸质版';
        if (!ownership.includes(target)) ownership.push(target);
      }
      continue;
    }
    if (aliased === '拥有形态') {
      const vals = Array.isArray(v) ? v.map((x) => String(x)) : [];
      for (const x of vals) if (!ownership.includes(x)) ownership.push(x);
      continue;
    }
    out[aliased] = v;
  }
  if (ownership.length) out['拥有形态'] = ownership;
  return out as unknown as Filters;
}

/* ------------------------------ 界面偏好 ------------------------------ */

export interface Prefs {
  columns: string[];
  sort: SortSpec;
  pageSize: number;
  presets: FilterPreset[];
}

export function readPrefs(): Partial<Prefs> {
  const raw = readJson<Partial<Prefs>>(STORAGE_KEYS.prefs, safeStorage('local')) ?? {};
  // v3：列名与筛选方案里的旧字段名统一改名，已删除字段剔除
  // v5：列表列「电子版 / 纸质版」并入派生列「形态」；旧的两个单选筛选并入「拥有形态」多选
  if (raw.columns) raw.columns = normalizeColumns(raw.columns);
  if (raw.presets) {
    raw.presets = raw.presets.map((p) => ({
      ...p,
      filters: normalizeFilters(p.filters),
    }));
  }
  return raw;
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

/* --------------------------- 操作日志（v4） --------------------------- */

/**
 * 读操作日志（同步 / 备份动作）。只保留最近 ACTION_LOG_LIMIT 条，新的在前。
 * 读取时做一次结构兜底：浏览器里存的是 JSON，可能被手工改坏。
 */
export function readActionLog(): ActionLogEntry[] {
  const raw = readJson<ActionLogEntry[]>(STORAGE_KEYS.actionlog, safeStorage('local'));
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is ActionLogEntry => Boolean(e) && typeof e === 'object')
    .map((e): ActionLogEntry => ({
      时间: String(e.时间 ?? ''),
      类型: String(e.类型 ?? ''),
      结果: e.结果 === '失败' ? '失败' : '成功',
      说明: String(e.说明 ?? ''),
    }))
    .slice(0, ACTION_LOG_LIMIT);
}

/**
 * 追加一条操作日志并返回最新的完整列表（只保留最近 ACTION_LOG_LIMIT 条）。
 * 写失败不抛错：日志是辅助信息，不能因为它写不进去就把同步功能搞挂。
 */
export function appendActionLog(entry: ActionLogEntry): ActionLogEntry[] {
  const next = [entry, ...readActionLog()].slice(0, ACTION_LOG_LIMIT);
  writeJson(STORAGE_KEYS.actionlog, next, safeStorage('local'));
  return next;
}

/* --------------------------- 发号水位（v4） --------------------------- */

/**
 * 读「历史发号水位」—— 已经用出去过的最大记录 ID。
 *
 * v4 移除回收站后记录被物理删除，若新 ID 只看现存记录的最大值，
 * 删掉最大号记录后新记录会复用旧 ID，与同步基线里的历史记录撞号
 * （三方合并时会被判成「同一记录被改」）。水位保证 ID 只增不复用。
 */
export function readLastIssuedId(): number {
  const raw = readJson<number>(STORAGE_KEYS.maxid, safeStorage('local'));
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

export function writeLastIssuedId(id: number): WriteOutcome {
  return writeJson(STORAGE_KEYS.maxid, Math.max(0, Math.floor(id)), safeStorage('local'));
}

/* --------------------- 已忽略的待确认项（v6.1.1） --------------------- */

/**
 * 读「已忽略的待确认项」。用户对某条核对结果选择「忽略」后，
 * 它不再出现在列表页横幅里，但保留在本地存储中，可在设置页查看与恢复。
 * 单人使用，浏览器本地持久化即可，不进入数据仓。
 */
export function readIgnoredChecks(): IgnoredCheckEntry[] {
  const raw = readJson<IgnoredCheckEntry[]>(STORAGE_KEYS.ignoredChecks, safeStorage('local'));
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is IgnoredCheckEntry => Boolean(e) && typeof e === 'object' && typeof e.key === 'string')
    .map((e): IgnoredCheckEntry => ({
      key: String(e.key),
      摘要: String(e.摘要 ?? ''),
      ignoredAt: String(e.ignoredAt ?? ''),
    }));
}

export function writeIgnoredChecks(entries: IgnoredCheckEntry[]): WriteOutcome {
  return writeJson(STORAGE_KEYS.ignoredChecks, entries, safeStorage('local'));
}
