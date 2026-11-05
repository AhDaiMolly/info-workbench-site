/**
 * 信息汇总工作台 · 字段选项管理（v6.3 需求 2，纯函数，无副作用，可单测）
 *
 * 品牌 / 款式（allowNew 枚举）允许手动输入新值；新值保存成功后自动沉淀为
 * 候选选项，用户也可删除候选（含隐藏 schema 内置选项）。选项状态独立于记录：
 *   · 沉淀 / 删除 / 恢复都只影响后续录入的下拉候选，绝不改动任何历史记录取值；
 *   · 状态存在数据仓 data/options.json（每字段 added / removed 两个集合），
 *     同步走与 records / plans 同构的「基线快照 + 三方合并」（mergeOptionsSync），
 *     基线缺失时按待同步队列归属重建（mergeWithoutBaseline）。
 */

import type { FieldDef, FieldOptionsState, ManagedFieldOptions, OptionsFile, Schema } from '../types';
import type { PendingChange } from './persist';
import { PAPER_SIZE_HEIGHT_TAGS, PAPER_SIZE_LETTER_TAGS } from '../schema';

/** options.json 的当前结构版本 */
export const OPTIONS_SCHEMA_VERSION = 1;

/** 待同步队列里字段选项改动的字段标记（字段[0] 固定为「字段选项」，字段[1] 为字段 jsonKey） */
export const OPTIONS_PENDING_FIELD = '字段选项';

/**
 * v6.5（需求 3）：受选项管理的尺码字段（tags 类型，基础选项集内置在代码里，不在 schema.options 里）。
 *
 * 两个尺码字段各自独立管理：电子版尺码、纸质版尺码。
 */
export const SIZE_MANAGED_KEYS = ['电子版尺码', '纸质版尺码'];

/** 尺码选项是否归「身高码」组（纯数字，2~3 位，如 80 / 155 / 180） */
const HEIGHT_CODE_RE = /^\d{2,3}$/;

/** 尺码字段的基础候选全集（字母码 + 身高码，内置常量，不随数据仓变化） */
export const BASE_SIZE_TAGS = [...PAPER_SIZE_LETTER_TAGS, ...PAPER_SIZE_HEIGHT_TAGS];

export interface SizeGroups {
  /** 字母码组（XS–4XL 及新增的非数字码） */
  letters: string[];
  /** 身高码组（80–180 及新增的数字码），按数值升序 */
  heights: string[];
}

/**
 * v6.5（需求 3）：尺码字段的当前候选项（基础快捷集 ∪ 手动新增 − 已删除）。
 *
 * 规则：
 *   · 数字型新增值（如 165、95）归入「身高码」组，并按数值升序排列；
 *   · 其它新增值（如 5XL）归入「字母码」组，追加在基础字母码之后；
 *   · 删除只影响候选，历史记录里已填的尺码原样保留、照常显示。
 */
export function effectiveSizeGroups(managed: ManagedFieldOptions | undefined): SizeGroups {
  const removed = new Set(managed?.removed ?? []);
  const added = managed?.added ?? [];

  const letters: string[] = [];
  for (const t of PAPER_SIZE_LETTER_TAGS) if (!removed.has(t)) letters.push(t);
  for (const a of added) {
    if (removed.has(a)) continue;
    if (HEIGHT_CODE_RE.test(a)) continue;
    if (!letters.includes(a)) letters.push(a);
  }

  const heights: string[] = [];
  for (const t of PAPER_SIZE_HEIGHT_TAGS) if (!removed.has(t)) heights.push(t);
  for (const a of added) {
    if (removed.has(a)) continue;
    if (!HEIGHT_CODE_RE.test(a)) continue;
    if (!heights.includes(a)) heights.push(a);
  }
  heights.sort((a, b) => Number(a) - Number(b));

  return { letters, heights };
}

/** 尺码候选项平铺列表（字母码在前、身高码在后） */
export function effectiveSizeTags(managed: ManagedFieldOptions | undefined): string[] {
  const g = effectiveSizeGroups(managed);
  return [...g.letters, ...g.heights];
}

/* ------------------------------ 结构归一 ------------------------------ */

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

/** 单个字段的管理状态归一：added / removed 各自去空白去重；坏的条目静默丢弃 */
function normalizeManaged(raw: unknown): ManagedFieldOptions {
  const src = (raw ?? {}) as Record<string, unknown>;
  return { added: normalizeStringList(src.added), removed: normalizeStringList(src.removed) };
}

/** 任意输入 → 干净的选项管理状态（手工改坏的 JSON 不能让页面白屏） */
export function normalizeOptionsState(raw: unknown): FieldOptionsState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: FieldOptionsState = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    out[key] = normalizeManaged(value);
  }
  return out;
}

/** 解析远端 options.json 文本（结构异常时回退空状态，不抛错阻断主流程） */
export function parseOptionsFile(content: string): { state: FieldOptionsState; dataVersion: number } {
  try {
    const parsed = JSON.parse(content) as Partial<OptionsFile>;
    return {
      state: normalizeOptionsState(parsed?.fields),
      dataVersion: typeof parsed?.dataVersion === 'number' && parsed.dataVersion > 0 ? parsed.dataVersion : 1,
    };
  } catch {
    return { state: {}, dataVersion: 1 };
  }
}

/** 组装写回远端的 options.json 载荷 */
export function makeOptionsFile(state: FieldOptionsState, dataVersion: number): OptionsFile {
  return {
    schemaVersion: OPTIONS_SCHEMA_VERSION,
    dataVersion: Math.max(1, dataVersion),
    updatedAt: new Date().toISOString(),
    fields: state,
  };
}

/* ------------------------------ 纯函数操作 ------------------------------ */

/** schema 里受选项管理的字段（allowNew 的枚举字段，目前 = 品牌 / 款式） */
export function managedFieldKeys(schema: Schema): string[] {
  return schema.fields
    .filter((f: FieldDef) => f.type === 'enum' && f.allowNew && !f.system && !f.readonly)
    .map((f) => f.jsonKey);
}

/**
 * v6.5（需求 3）：全部受选项管理的字段 —— allowNew 枚举（品牌 / 款式）+ 尺码字段（电子版尺码 / 纸质版尺码）。
 */
export function managedOptionKeys(schema: Schema): string[] {
  const enumKeys = managedFieldKeys(schema);
  const sizeKeys = SIZE_MANAGED_KEYS.filter((k) => schema.fields.some((f: FieldDef) => f.jsonKey === k));
  return [...enumKeys, ...sizeKeys];
}

/** 无管理状态时返回 schema 选项本身（同一数组内容重新包装，不修改入参） */
function listOrEmpty(list: string[] | undefined): string[] {
  return list ?? [];
}

/**
 * 某个字段的录入候选 =（schema 选项 ∪ added）− removed。
 * schema 选项保持原顺序在前，added 按沉淀顺序追加。
 */
export function effectiveOptions(
  schemaOptions: string[] | undefined,
  managed: ManagedFieldOptions | undefined,
): string[] {
  const removed = new Set(managed?.removed ?? []);
  const out: string[] = [];
  for (const o of listOrEmpty(schemaOptions)) {
    if (!removed.has(o) && !out.includes(o)) out.push(o);
  }
  for (const a of managed?.added ?? []) {
    if (!removed.has(a) && !out.includes(a)) out.push(a);
  }
  return out;
}

/** 值是否已在某字段的候选里（沉淀前的幂等判断） */
function inCandidates(schemaOptions: string[] | undefined, managed: ManagedFieldOptions | undefined, value: string): boolean {
  return effectiveOptions(schemaOptions, managed).includes(value);
}

/**
 * 沉淀一个新选项（手动输入保存成功后调用）。
 * 已在候选里 / 值为空白 → 原样返回同一引用；被删除过的值重新沉淀（移出 removed）。
 */
export function addOptionValue(
  state: FieldOptionsState, fieldKey: string, value: string, inSchema: boolean,
): FieldOptionsState {
  const trimmed = value.trim();
  if (!trimmed) return state;
  const managed = state[fieldKey] ?? { added: [], removed: [] };
  if (inCandidates(inSchema ? [trimmed] : undefined, undefined, trimmed)) return state; // schema 本身已含
  const alreadyAdded = managed.added.includes(trimmed);
  const wasRemoved = managed.removed.includes(trimmed);
  if (!inSchema && alreadyAdded && !wasRemoved) return state;
  return {
    ...state,
    [fieldKey]: {
      added: wasRemoved && alreadyAdded ? managed.added : alreadyAdded ? managed.added : [...managed.added, trimmed],
      removed: managed.removed.filter((v) => v !== trimmed),
    },
  };
}

/**
 * 从候选里删除一个选项（内置 / 沉淀选项都可删）。
 * 已在 removed 里 / 值为空白 → 原样返回同一引用。
 * 删除只影响后续录入候选，绝不改动使用该选项的历史记录。
 */
export function removeOptionValue(
  state: FieldOptionsState, fieldKey: string, value: string,
): FieldOptionsState {
  const trimmed = value.trim();
  if (!trimmed) return state;
  const managed = state[fieldKey] ?? { added: [], removed: [] };
  const alreadyRemoved = managed.removed.includes(trimmed);
  const stillAdded = managed.added.includes(trimmed);
  if (alreadyRemoved && !stillAdded) return state;
  return {
    ...state,
    [fieldKey]: {
      added: managed.added.filter((v) => v !== trimmed),
      removed: alreadyRemoved ? managed.removed : [...managed.removed, trimmed],
    },
  };
}

/**
 * 恢复一个被删除的选项：移出 removed；非 schema 选项重新回到 added。
 * 值不在 removed 里 → 原样返回同一引用。
 */
export function restoreOptionValue(
  state: FieldOptionsState, fieldKey: string, value: string, inSchema: boolean,
): FieldOptionsState {
  const trimmed = value.trim();
  if (!trimmed) return state;
  const managed = state[fieldKey] ?? { added: [], removed: [] };
  if (!managed.removed.includes(trimmed)) return state;
  return {
    ...state,
    [fieldKey]: {
      added: inSchema || managed.added.includes(trimmed) ? managed.added : [...managed.added, trimmed],
      removed: managed.removed.filter((v) => v !== trimmed),
    },
  };
}

/* ------------------------------ 内容比对 ------------------------------ */

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** 两份选项管理状态是否内容一致（与字段遍历顺序无关） */
export function optionsStateEqual(a: FieldOptionsState, b: FieldOptionsState): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const x = a[key] ?? { added: [], removed: [] };
    const y = b[key] ?? { added: [], removed: [] };
    if (!sameStringList(x.added, y.added) || !sameStringList(x.removed, y.removed)) return false;
  }
  return true;
}

/* ------------------------------ 同步合并 ------------------------------ */

export interface OptionsMergeResult {
  state: FieldOptionsState;
  baselineMode: 'persisted' | 'reconstructed';
}

/** 集合语义的三方合并：任一侧新增都保留，任一侧删除都生效（选项天然可并集，无字段级冲突） */
function mergeSet(base: string[], local: string[], remote: string[]): string[] {
  const baseSet = new Set(base);
  const added = new Set([...local, ...remote].filter((v) => !baseSet.has(v)));
  const dropped = new Set([
    ...base.filter((v) => !local.includes(v)),
    ...base.filter((v) => !remote.includes(v)),
  ]);
  const out: string[] = [];
  for (const v of [...base, ...local, ...remote]) {
    const kept = added.has(v) || (baseSet.has(v) && !dropped.has(v));
    if (kept && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 有基线快照 → 按字段做集合三方合并 */
function mergeWithBaseline(
  baseline: FieldOptionsState, local: FieldOptionsState, remote: FieldOptionsState,
): OptionsMergeResult {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(local), ...Object.keys(remote)]);
  const out: FieldOptionsState = {};
  for (const key of keys) {
    const b = baseline[key] ?? { added: [], removed: [] };
    const l = local[key] ?? { added: [], removed: [] };
    const r = remote[key] ?? { added: [], removed: [] };
    out[key] = { added: mergeSet(b.added, l.added, r.added), removed: mergeSet(b.removed, l.removed, r.removed) };
  }
  return { state: out, baselineMode: 'persisted' };
}

/** 从待同步队列里提取「用户动过选项的字段」 */
export function touchedOptionFields(pending: PendingChange[]): Set<string> {
  const fields = new Set<string>();
  for (const c of pending) {
    const fields2 = c.字段 ?? [];
    if (fields2[0] === OPTIONS_PENDING_FIELD && typeof fields2[1] === 'string' && fields2[1]) fields.add(fields2[1]);
  }
  return fields;
}

/** 无基线快照 → 按待同步队列归属做两方合并：动过的字段按本地意图保留，其余以远端为准 */
function mergeWithoutBaseline(
  local: FieldOptionsState, remote: FieldOptionsState, pending: PendingChange[],
): OptionsMergeResult {
  const touched = touchedOptionFields(pending);
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const out: FieldOptionsState = {};
  for (const key of keys) {
    if (touched.has(key)) {
      out[key] = local[key] ?? { added: [], removed: [] }; // 动过 → 本地意图优先
    } else {
      out[key] = remote[key] ?? { added: [], removed: [] }; // 没动 → 跟远端
    }
  }
  return { state: out, baselineMode: 'reconstructed' };
}

/** 字段选项同步合并入口（与 plans.planPlansSync / syncPolicy.planRemoteSync 同构） */
export function mergeOptionsSync(input: {
  local: FieldOptionsState;
  remote: FieldOptionsState;
  baseline: FieldOptionsState | null;
  pending: PendingChange[];
}): OptionsMergeResult {
  // 注意：空对象也是合法的已持久化基线（上次同步时远端就没有任何选项管理），只有 null 才走重建
  if (input.baseline && typeof input.baseline === 'object') {
    return mergeWithBaseline(input.baseline, input.local, input.remote);
  }
  return mergeWithoutBaseline(input.local, input.remote, input.pending);
}
