/**
 * 信息汇总工作台 · 同步策略（纯函数，无副作用，可单测）
 *
 * 把两件与 React 无关的决策从 store 里拆出来：
 *
 *   1. decideAutoPull  —— 质检 P0-1
 *      本地存在未同步改动时，禁止启动时自动拉取远端，改为引导用户处理。
 *      （原实现无条件 pull 并覆盖本地记录 + 清空离线暂存队列 → 用户改动永久丢失）
 *
 *   2. planRemoteSync  —— 质检 P1-1 / P1-2 / P1-3
 *      基于「持久化基线快照」（上次成功同步时的数据版本）做真三方合并：
 *        · P1-1 基线必须是基线快照，不能拿本地当前值当基线（否则 localChanged 恒 false）
 *        · P1-2 遍历「基线 ∪ 本地 ∪ 远端」并集，远端新增记录必须合入
 *        · P1-3 远端已删、本地未改动的记录不得被写回复活
 *
 * 基线快照缺失时（首次使用新版、或基线写入失败）退化为「按待同步队列归属」的两方合并：
 * 只有用户真正动过的记录才按本地意图保留，其余一律以远端为准 —— 宁可让差异暴露成冲突，
 * 也不静默覆盖本地数据。
 */

import type { RecordItem } from '../types';
import type { PendingChange } from './persist';
import {
  diffRecords, hasContentDiff, recordsEqual, threeWayMerge, type FieldDiff,
} from '../sync/conflict';

/* ------------------------------ 自动拉取守卫 ------------------------------ */

export interface AutoPullInput {
  /** 本地当前记录（来自缓存） */
  local: RecordItem[];
  /** 上次成功同步时的基线快照；没有则 null */
  baseline: RecordItem[] | null;
  /** 本地未同步改动条数 */
  pendingCount: number;
}

export type AutoPullBlockReason = 'pending-not-empty' | 'local-diverged';

export interface AutoPullDecision {
  /** 是否允许执行启动时自动拉取 */
  allow: boolean;
  /** 被拦截的原因；allow 为 true 时为 null */
  reason: AutoPullBlockReason | null;
  /** 面向用户的引导文案；allow 为 true 时为 null */
  message: string | null;
  /** 本地未同步改动条数 */
  pendingCount: number;
}

/** 本地是否已偏离基线（即存在未写回远端的改动） */
export function hasLocalDivergence(input: AutoPullInput): boolean {
  if (input.pendingCount > 0) return true;
  if (!input.baseline) return false;
  return hasContentDiff(input.local, input.baseline);
}

/**
 * 启动时是否允许自动拉取。
 * 允许的条件：本地没有任何未同步改动（队列为空，且与基线快照内容一致）。
 */
export function decideAutoPull(input: AutoPullInput): AutoPullDecision {
  if (input.pendingCount > 0) {
    return {
      allow: false,
      reason: 'pending-not-empty',
      pendingCount: input.pendingCount,
      message: `检测到 ${input.pendingCount} 处未同步的本地改动，已暂停启动时的自动拉取，避免覆盖你的改动。`
        + '请先点「一键备份」写回仓库，或先导出本地副本再处理远端更新。',
    };
  }
  if (input.baseline && hasContentDiff(input.local, input.baseline)) {
    return {
      allow: false,
      reason: 'local-diverged',
      pendingCount: input.pendingCount,
      message: '本地数据与上次成功同步的基线不一致，已暂停启动时的自动拉取，避免覆盖未同步的改动。'
        + '请先同步或导出本地副本，再处理远端更新。',
    };
  }
  return { allow: true, reason: null, pendingCount: input.pendingCount, message: null };
}

/* ------------------------------- 远端同步计划 ------------------------------ */

export type SyncPlanKind =
  /** 本地与远端内容一致：直接采用远端，基线可前移 */
  | 'fast-forward'
  /** 可自动合并：远端新增/删除已并入，本地改动保留，无真冲突 */
  | 'merge'
  /** 存在真冲突：需要用户在冲突面板裁决 */
  | 'conflict';

export interface SyncPlan {
  kind: SyncPlanKind;
  /** 合并后的记录集合（fast-forward 时等于远端内容） */
  records: RecordItem[];
  /** 真冲突清单（字段级） */
  conflicts: FieldDiff[];
  /** 远端新增、已合入本地的记录 ID */
  addedFromRemote: number[];
  /** 远端已删除、本地未改动因而一并移除的记录 ID */
  removedByRemote: number[];
  /** 本地新增、远端尚无因而会随写回带上的记录 ID */
  addedFromLocal: number[];
  /** 自动合并的字段数 */
  autoMerged: number;
  /** 基线来源：持久化基线 / 无基线时按待同步队列重建 */
  baselineMode: 'persisted' | 'reconstructed';
  /** 面向用户的一句话说明 */
  summary: string;
}

export interface SyncPlanInput {
  /** 本地当前记录 */
  local: RecordItem[];
  /** 远端拉取到的记录 */
  remote: RecordItem[];
  /** 上次成功同步时的基线快照；没有则 null */
  baseline: RecordItem[] | null;
  /** 本地未同步改动队列 */
  pending: PendingChange[];
}

function cloneRecord(r: RecordItem): RecordItem {
  return {
    ...r,
    分类: r.分类 ? [...r.分类] : [],
    电子版尺码组: r.电子版尺码组 ? [...r.电子版尺码组] : [],
    纸质版尺码: r.纸质版尺码 ? [...r.纸质版尺码] : [],
    关联: r.关联 ? [...r.关联] : [],
  } as RecordItem;
}

function summarize(
  kind: SyncPlanKind,
  records: RecordItem[],
  addedFromRemote: number[],
  removedByRemote: number[],
  addedFromLocal: number[],
  conflicts: FieldDiff[],
): string {
  if (kind === 'conflict') {
    return `远端数据已更新，检测到 ${conflicts.length} 处字段级冲突，需要你确认后才能写回。`;
  }
  if (kind === 'fast-forward') {
    return `已从仓库拉取 ${records.length} 条记录，本地与远端一致。`;
  }
  const parts: string[] = [`已合入远端更新，共 ${records.length} 条记录`];
  if (addedFromRemote.length) parts.push(`合入远端新增 ${addedFromRemote.length} 条`);
  if (removedByRemote.length) parts.push(`移除远端已删 ${removedByRemote.length} 条`);
  if (addedFromLocal.length) parts.push(`保留本地新增 ${addedFromLocal.length} 条`);
  return `${parts.join('，')}。`;
}

/** 有基线快照 → 真三方合并 */
function planWithBaseline(baseline: RecordItem[], input: SyncPlanInput): SyncPlan {
  const { local, remote } = input;
  const res = threeWayMerge(baseline, local, remote);
  // 合并结果与远端内容完全一致 → 本地没有任何需要保留的差异，可直接采用远端
  const sameAsRemote = !hasContentDiff(res.merged, remote);
  const kind: SyncPlanKind = res.conflicts.length
    ? 'conflict'
    : (sameAsRemote ? 'fast-forward' : 'merge');
  return {
    kind,
    records: res.merged,
    conflicts: res.conflicts,
    addedFromRemote: res.addedFromRemote,
    removedByRemote: res.removedByRemote,
    addedFromLocal: res.addedFromLocal,
    autoMerged: res.autoMerged,
    baselineMode: 'persisted',
    summary: summarize(kind, res.merged, res.addedFromRemote, res.removedByRemote, res.addedFromLocal, res.conflicts),
  };
}

/** 无基线快照 → 按待同步队列归属做两方合并 */
function planWithoutBaseline(input: SyncPlanInput): SyncPlan {
  const { local, remote, pending } = input;
  const localById = new Map(local.map((r) => [r.id, r]));
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const pendingById = new Map<number, PendingChange>();
  for (const c of pending) pendingById.set(c.记录ID, c);

  const conflicts: FieldDiff[] = [];
  const addedFromRemote: number[] = [];
  const removedByRemote: number[] = [];
  const addedFromLocal: number[] = [];
  const records: RecordItem[] = [];

  const ids = [...new Set([...localById.keys(), ...remoteById.keys()])].sort((a, b) => a - b);

  for (const id of ids) {
    const l = localById.get(id);
    const r = remoteById.get(id);
    const change = pendingById.get(id);

    if (change && l && r) {
      // 用户动过这条记录，远端也变了 → 无法判定归属，暴露成冲突而不是静默覆盖
      if (recordsEqual(l, r)) {
        records.push(cloneRecord(l));
      } else {
        conflicts.push(...diffRecords([l], [r]));
        records.push(cloneRecord(l));
      }
      continue;
    }
    if (change && l && !r) {
      if (change.动作 === '新增') {
        records.push(cloneRecord(l));
        addedFromLocal.push(id);
      } else {
        conflicts.push({
          记录ID: id, 名称: l.名称, 字段: '（记录删除）',
          基线值: '（存在）', 一侧值: '（本地已修改）', 另一侧值: '（远端已删除）',
        });
        records.push(cloneRecord(l));
      }
      continue;
    }
    if (change && !l && r) {
      conflicts.push({
        记录ID: id, 名称: r.名称, 字段: '（记录删除）',
        基线值: '（存在）', 一侧值: '（本地已删除）', 另一侧值: '（远端已修改）',
      });
      records.push(cloneRecord(r));
      continue;
    }

    // 没有本地改动 → 以远端为准
    if (r) {
      records.push(cloneRecord(r));
      if (!l) addedFromRemote.push(id);
    } else if (l) {
      // 远端已删除、本地未改动 → 跟随远端删除，不复活
      removedByRemote.push(id);
    }
  }

  const sameAsRemote = !hasContentDiff(records, remote);
  const kind: SyncPlanKind = conflicts.length
    ? 'conflict'
    : (sameAsRemote ? 'fast-forward' : 'merge');
  return {
    kind,
    records,
    conflicts,
    addedFromRemote,
    removedByRemote,
    addedFromLocal,
    autoMerged: 0,
    baselineMode: 'reconstructed',
    summary: summarize(kind, records, addedFromRemote, removedByRemote, addedFromLocal, conflicts),
  };
}

/**
 * 远端同步计划：给定本地 / 远端 / 基线快照，算出「该采用什么、该合什么、哪里有冲突」。
 *
 * 三种结果：
 *   · fast-forward —— 与远端一致，直接采用（基线可前移，待同步队列可清空）
 *   · merge        —— 可自动合并：远端新增合入、远端删除生效、本地改动保留
 *   · conflict     —— 有真冲突，交由用户裁决，不得自动写回
 */
export function planRemoteSync(input: SyncPlanInput): SyncPlan {
  if (input.baseline && input.baseline.length) return planWithBaseline(input.baseline, input);
  return planWithoutBaseline(input);
}
