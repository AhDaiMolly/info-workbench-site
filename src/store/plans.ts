/**
 * 信息汇总工作台 · 计划清单（v6.2 需求 1，纯函数，无副作用，可单测）
 *
 * 计划清单是独立于记录的轻量聚合：一份 data/plans.json，每条清单自带
 * 「记录ID列表」成员关系。这样 records.json 与既有「状态及评价」里的
 * 「计划」枚举完全不动（v6.2 需求 1 第 5 条：已有数据零迁移）。
 *
 *   · 清单成员关系存在清单一侧（PlanItem.记录ID列表），记录本身无感知
 *   · 删除清单只解除关联，绝不删除记录
 *   · 删除记录时由调用方顺带清理各清单里的成员引用（prunePlanMembers）
 *   · 同步走与 records 同构的「基线快照 + 三方合并」（mergePlans），
 *     基线缺失时按待同步队列归属重建（planPlansSync）
 */

import type { PlanItem, PlansFile } from '../types';
import type { PendingChange } from './persist';

/** plans.json 的当前结构版本 */
export const PLANS_SCHEMA_VERSION = 1;

/** 待同步队列里计划清单改动的字段标记（字段[0] 固定为「计划清单」，字段[1] 为清单 ID） */
export const PLAN_PENDING_FIELD = '计划清单';

/* ------------------------------ 结构归一 ------------------------------ */

/** 单条清单的结构兜底：手工改坏的 JSON 不能让页面白屏 */
function normalizePlanItem(raw: unknown): PlanItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const id = typeof src.id === 'string' && src.id ? src.id : null;
  const name = typeof src.名称 === 'string' ? src.名称.trim() : '';
  if (!id || !name) return null;
  const members = Array.isArray(src.记录ID列表)
    ? [...new Set(src.记录ID列表.filter((n): n is number => Number.isInteger(n) && n > 0))]
    : [];
  const now = new Date().toISOString();
  return {
    id,
    名称: name,
    记录ID列表: members,
    创建时间: typeof src.创建时间 === 'string' ? src.创建时间 : now,
    更新时间: typeof src.更新时间 === 'string' ? src.更新时间 : now,
  };
}

/** 任意输入 → 干净的清单数组（去重 by id，按创建时间稳定排序） */
export function normalizePlans(raw: unknown): PlanItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PlanItem[] = [];
  for (const item of raw) {
    const plan = normalizePlanItem(item);
    if (!plan || seen.has(plan.id)) continue;
    seen.add(plan.id);
    out.push(plan);
  }
  return out.sort((a, b) => (a.创建时间 === b.创建时间 ? a.id.localeCompare(b.id) : a.创建时间.localeCompare(b.创建时间)));
}

/** 解析远端 plans.json 文本（结构异常时回退为空清单，不抛错阻断主流程） */
export function parsePlansFile(content: string): { plans: PlanItem[]; dataVersion: number } {
  try {
    const parsed = JSON.parse(content) as Partial<PlansFile>;
    return {
      plans: normalizePlans(parsed?.plans),
      dataVersion: typeof parsed?.dataVersion === 'number' && parsed.dataVersion > 0 ? parsed.dataVersion : 1,
    };
  } catch {
    return { plans: [], dataVersion: 1 };
  }
}

/** 组装写回远端的 plans.json 载荷 */
export function makePlansFile(plans: PlanItem[], dataVersion: number): PlansFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: PLANS_SCHEMA_VERSION,
    dataVersion: Math.max(1, dataVersion),
    updatedAt: now,
    totalCount: plans.length,
    plans,
  };
}

/* ------------------------------ 纯函数操作 ------------------------------ */

function clonePlan(p: PlanItem): PlanItem {
  return { ...p, 记录ID列表: [...p.记录ID列表] };
}

/** 生成新清单 ID：p1、p2…（取现有最大号 + 1，确定性、可测试） */
export function nextPlanId(plans: PlanItem[]): string {
  let max = 0;
  for (const p of plans) {
    const m = /^p(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `p${max + 1}`;
}

/** 新建清单（名称必填；重名不禁止 —— 单人工具，允许两个同名清单各自独立） */
export function createPlan(plans: PlanItem[], name: string): { plans: PlanItem[]; plan: PlanItem } | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const now = new Date().toISOString();
  const plan: PlanItem = {
    id: nextPlanId(plans),
    名称: trimmed,
    记录ID列表: [],
    创建时间: now,
    更新时间: now,
  };
  return { plans: [...plans.map(clonePlan), plan], plan };
}

/** 重命名清单（不存在或名称为空 → 原样返回同一引用） */
export function renamePlan(plans: PlanItem[], planId: string, name: string): PlanItem[] {
  const trimmed = name.trim();
  if (!trimmed) return plans;
  const target = plans.find((p) => p.id === planId);
  if (!target) return plans;
  return plans.map((p) => (p.id === planId ? { ...clonePlan(p), 名称: trimmed, 更新时间: new Date().toISOString() } : p));
}

/** 删除清单：只移除清单本身（及其成员关联），记录不受任何影响 */
export function deletePlan(plans: PlanItem[], planId: string): PlanItem[] {
  return plans.filter((p) => p.id !== planId);
}

/** 把记录加入清单（已在清单里 → 原样返回，不产生新引用） */
export function addRecordToPlan(plans: PlanItem[], planId: string, recordId: number): PlanItem[] {
  const target = plans.find((p) => p.id === planId);
  if (!target || target.记录ID列表.includes(recordId)) return plans;
  return plans.map((p) => {
    if (p.id !== planId || p.记录ID列表.includes(recordId)) return p;
    const next = clonePlan(p);
    next.记录ID列表.push(recordId);
    next.记录ID列表.sort((a, b) => a - b);
    next.更新时间 = new Date().toISOString();
    return next;
  });
}

/** 把记录移出清单（不在该清单里 → 原样返回同一引用） */
export function removeRecordFromPlan(plans: PlanItem[], planId: string, recordId: number): PlanItem[] {
  const target = plans.find((p) => p.id === planId);
  if (!target || !target.记录ID列表.includes(recordId)) return plans;
  return plans.map((p) => {
    if (p.id !== planId || !p.记录ID列表.includes(recordId)) return p;
    const next = clonePlan(p);
    next.记录ID列表 = next.记录ID列表.filter((id) => id !== recordId);
    next.更新时间 = new Date().toISOString();
    return next;
  });
}

/** 记录被删除后，清掉各清单里对它的成员引用（返回 null 表示无需清理） */
export function prunePlanMembers(plans: PlanItem[], recordIds: number[]): PlanItem[] | null {
  const drop = new Set(recordIds);
  let changed = false;
  const next = plans.map((p) => {
    if (!p.记录ID列表.some((id) => drop.has(id))) return p;
    changed = true;
    const copy = clonePlan(p);
    copy.记录ID列表 = copy.记录ID列表.filter((id) => !drop.has(id));
    copy.更新时间 = new Date().toISOString();
    return copy;
  });
  return changed ? next : null;
}

/* ------------------------------ 筛选支持 ------------------------------ */

/** 记录 ID → 所在清单 ID 集合（列表页按清单筛选用） */
export function buildPlanMembers(plans: PlanItem[]): Map<number, Set<string>> {
  const members = new Map<number, Set<string>>();
  for (const p of plans) {
    for (const id of p.记录ID列表) {
      let set = members.get(id);
      if (!set) { set = new Set(); members.set(id, set); }
      set.add(p.id);
    }
  }
  return members;
}

/* ------------------------------ 内容比对 ------------------------------ */

const PLAN_FIELDS: Array<keyof Omit<PlanItem, 'id' | '创建时间' | '更新时间'>> = ['名称', '记录ID列表'];

function sameField(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

function planChanged(base: PlanItem, other: PlanItem): boolean {
  return PLAN_FIELDS.some((f) => !sameField(base[f], other[f]));
}

/** 两份清单集合是否内容一致（顺序无关，按 id 对齐） */
export function plansEqual(a: PlanItem[], b: PlanItem[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((p) => [p.id, p]));
  for (const p of b) {
    const other = byId.get(p.id);
    if (!other || planChanged(other, p)) return false;
  }
  return true;
}

/** 清单存在但所有成员引用都指向不存在的记录 → 视为无内容的空清单，不写远端 */
export function plansHaveContent(plans: PlanItem[]): boolean {
  return plans.some((p) => p.名称 || p.记录ID列表.length);
}

/* ------------------------------ 同步合并 ------------------------------ */

export interface PlanFieldDiff {
  计划ID: string;
  名称: string;
  字段: string;
  基线值: unknown;
  一侧值: unknown;
  另一侧值: unknown;
}

export interface PlansMergeResult {
  plans: PlanItem[];
  /** 真冲突（双方改了同一清单的同一字段）——单-sided 合并策略下仍上报，供提示 */
  conflicts: PlanFieldDiff[];
  addedFromRemote: string[];
  addedFromLocal: string[];
  /** 基线来源 */
  baselineMode: 'persisted' | 'reconstructed';
}

function clonePlans(plans: PlanItem[]): PlanItem[] {
  return plans.map(clonePlan);
}

/** 有基线快照 → 清单级三方合并（语义与 sync/conflict.ts 的记录合并对齐） */
function mergeWithBaseline(
  baseline: PlanItem[], local: PlanItem[], remote: PlanItem[],
): PlansMergeResult {
  const baseById = new Map(baseline.map((p) => [p.id, p]));
  const localById = new Map(local.map((p) => [p.id, p]));
  const remoteById = new Map(remote.map((p) => [p.id, p]));
  const conflicts: PlanFieldDiff[] = [];
  const addedFromRemote: string[] = [];
  const addedFromLocal: string[] = [];
  const merged: PlanItem[] = [];

  const ids = [...new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()])]
    .sort();

  for (const id of ids) {
    const b = baseById.get(id);
    const l = localById.get(id);
    const r = remoteById.get(id);

    if (l && r) {
      if (!b) {
        // 双方各自新建：内容一致直接采用；不一致优先本地并上报冲突
        if (!planChanged(l, r)) {
          merged.push(clonePlan(l));
        } else {
          for (const f of PLAN_FIELDS) {
            if (!sameField(l[f], r[f])) {
              conflicts.push({ 计划ID: id, 名称: l.名称, 字段: String(f), 基线值: undefined, 一侧值: clonePlan(l)[f], 另一侧值: clonePlan(r)[f] });
            }
          }
          merged.push(clonePlan(l));
        }
        continue;
      }
      const out = clonePlan(l);
      for (const f of PLAN_FIELDS) {
        const localChanged = !sameField(b[f], l[f]);
        const remoteChanged = !sameField(b[f], r[f]);
        if (!localChanged && !remoteChanged) continue;
        if (localChanged && !remoteChanged) {
          (out as unknown as Record<string, unknown>)[f] = clonePlan(l)[f];
        } else if (!localChanged && remoteChanged) {
          (out as unknown as Record<string, unknown>)[f] = clonePlan(r)[f];
        } else if (!sameField(l[f], r[f])) {
          // 双方改成不同取值 → 保留本地并上报冲突
          conflicts.push({ 计划ID: id, 名称: l.名称, 字段: String(f), 基线值: clonePlan(b)[f], 一侧值: clonePlan(l)[f], 另一侧值: clonePlan(r)[f] });
        }
      }
      merged.push(out);
      continue;
    }

    if (l && !r) {
      if (!b) {
        // 本地新建、远端尚无 → 保留，随下一次写回带上
        merged.push(clonePlan(l));
        addedFromLocal.push(id);
        continue;
      }
      // 远端已删除该清单：本地未改 → 接受删除；本地改过 → 保留并上报冲突
      if (!planChanged(b, l)) continue;
      conflicts.push({ 计划ID: id, 名称: l.名称, 字段: '（清单删除）', 基线值: '（存在）', 一侧值: '（本地已修改）', 另一侧值: '（远端已删除）' });
      merged.push(clonePlan(l));
      continue;
    }

    if (!l && r) {
      if (!b) {
        // 远端新建（另一台设备）→ 合入
        merged.push(clonePlan(r));
        addedFromRemote.push(id);
        continue;
      }
      // 本地已删除：远端未改 → 尊重删除；远端改过 → 合入远端并上报冲突
      if (!planChanged(b, r)) continue;
      conflicts.push({ 计划ID: id, 名称: r.名称, 字段: '（清单删除）', 基线值: '（存在）', 一侧值: '（本地已删除）', 另一侧值: '（远端已修改）' });
      merged.push(clonePlan(r));
      continue;
    }
    // 双方都没有：跳过
  }

  return { plans: merged, conflicts, addedFromRemote, addedFromLocal, baselineMode: 'persisted' };
}

/** 从待同步队列里提取「用户动过的清单 ID」 */
export function touchedPlanIds(pending: PendingChange[]): Set<string> {
  const ids = new Set<string>();
  for (const c of pending) {
    const fields = c.字段 ?? [];
    if (fields[0] === PLAN_PENDING_FIELD && typeof fields[1] === 'string' && fields[1]) ids.add(fields[1]);
  }
  return ids;
}

/** 无基线快照 → 按待同步队列归属做两方合并：动过的清单按本地意图保留，其余以远端为准 */
function mergeWithoutBaseline(
  local: PlanItem[], remote: PlanItem[], pending: PendingChange[],
): PlansMergeResult {
  const localById = new Map(local.map((p) => [p.id, p]));
  const remoteById = new Map(remote.map((p) => [p.id, p]));
  const touched = touchedPlanIds(pending);
  const conflicts: PlanFieldDiff[] = [];
  const addedFromRemote: string[] = [];
  const addedFromLocal: string[] = [];
  const merged: PlanItem[] = [];

  const ids = [...new Set([...localById.keys(), ...remoteById.keys()])].sort();

  for (const id of ids) {
    const l = localById.get(id);
    const r = remoteById.get(id);

    if (touched.has(id)) {
      // 用户动过这份清单 → 本地意图优先
      if (l && r) {
        if (!planChanged(l, r)) {
          merged.push(clonePlan(l));
        } else {
          for (const f of PLAN_FIELDS) {
            if (!sameField(l[f], r[f])) {
              conflicts.push({ 计划ID: id, 名称: l.名称, 字段: String(f), 基线值: undefined, 一侧值: clonePlan(l)[f], 另一侧值: clonePlan(r)[f] });
            }
          }
          merged.push(clonePlan(l));
        }
      } else if (l) {
        merged.push(clonePlan(l));
        addedFromLocal.push(id);
      }
      // 动过且远端才有 = 本地显式删除 → 不复活
      continue;
    }

    // 没动过 → 以远端为准（远端删了就跟远端删了）
    if (r) {
      merged.push(clonePlan(r));
      if (!l) addedFromRemote.push(id);
    } else if (l) {
      // 远端已删除、本地未改 → 跟随远端删除
    }
  }

  return { plans: merged, conflicts, addedFromRemote, addedFromLocal, baselineMode: 'reconstructed' };
}

/**
 * 计划清单同步合并入口（与 syncPolicy.planRemoteSync 同构）。
 * 冲突不阻断主流程：合并结果优先保留本地版本，冲突以清单形式上报给调用方提示。
 */
export function planPlansSync(input: {
  local: PlanItem[];
  remote: PlanItem[];
  baseline: PlanItem[] | null;
  pending: PendingChange[];
}): PlansMergeResult {
  // 注意：空数组也是合法的已持久化基线（上次同步时远端就没有清单），只有 null 才走重建
  if (Array.isArray(input.baseline)) {
    return mergeWithBaseline(input.baseline, input.local, input.remote);
  }
  return mergeWithoutBaseline(input.local, input.remote, input.pending);
}
