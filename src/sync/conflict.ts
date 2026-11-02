/**
 * 信息汇总工作台 · 字段级差异与三方合并（架构 4.4 冲突分支）
 *
 * 冲突判定：只有「本地相对基线改了、远端相对基线也改了同一个字段」才是真冲突。
 * 其余情况自动取改过的一方。
 *
 * ⚠️ 基线（base）必须是「上次成功同步时的数据快照」（见 store/syncPolicy.ts）。
 *     把本地当前值当基线会让 localChanged 恒为 false —— 字段级冲突检测恒空、
 *     本地未同步改动被远端静默覆盖（质检 P1-1）。
 *
 * ⚠️ 合并必须遍历「基线 ∪ 本地 ∪ 远端」的并集。只遍历本地键集会让远端新增
 *     记录被直接丢弃（质检 P1-2）；只按「本地有就保留」处理会让远端已删除的
 *     记录被写回复活（质检 P1-3）。
 */

import type { RecordItem } from '../types';

export interface FieldDiff {
  记录ID: number;
  名称: string;
  字段: string;
  基线值: unknown;
  一侧值: unknown;
  另一侧值: unknown;
}

// v3：字段改名（拥有电子版 → 电子版、拥有纸质版 → 纸质版）；
//     「电子版缺码」「关联」随字段删除一并从比对集合中移除。
const COMPARE_FIELDS: Array<keyof RecordItem> = [
  '名称', '品牌', '分类', '款式', '季节', '教程', '电子版', '电子版尺码组',
  '纸质版', '纸质版尺码', '推荐', '做过', '想做', '备注',
];

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

/**
 * 浅拷贝：数组切片、普通对象展开，其余（字符串/布尔/数字）按值返回。
 * ⚠️ 必须真正复制记录对象，否则合并结果会改写调用方传入的 local/base 记录（污染 React state）。
 */
function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.slice() as unknown as T;
  if (v && typeof v === 'object') return { ...(v as Record<string, unknown>) } as unknown as T;
  return v;
}

/**
 * 记录相对基线是否发生过内容变化。
 * v4：回收站移除 —— 不再比对 deletedAt（软删标记已不存在，删除即物理删除）。
 */
export function recordChanged(base: RecordItem, other: RecordItem): boolean {
  for (const f of COMPARE_FIELDS) {
    if (!same(base[f], other[f])) return true;
  }
  return false;
}

/** 两条记录内容是否完全一致 */
export function recordsEqual(a: RecordItem, b: RecordItem): boolean {
  return !recordChanged(a, b);
}

/** 字段级差异清单（本地 vs 远端） */
export function diffRecords(left: RecordItem[], right: RecordItem[]): FieldDiff[] {
  const leftById = new Map(left.map((r) => [r.id, r]));
  const out: FieldDiff[] = [];
  for (const rec of right) {
    const l = leftById.get(rec.id);
    if (!l) {
      out.push({ 记录ID: rec.id, 名称: rec.名称, 字段: '（新增记录）', 基线值: undefined, 一侧值: undefined, 另一侧值: clone(rec.名称) });
      continue;
    }
    for (const f of COMPARE_FIELDS) {
      if (!same(l[f], rec[f])) {
        out.push({ 记录ID: rec.id, 名称: rec.名称, 字段: String(f), 基线值: clone(l[f]), 一侧值: clone(l[f]), 另一侧值: clone(rec[f]) });
      }
    }
  }
  return out;
}

export interface MergeResult {
  merged: RecordItem[];
  /** 真冲突：双方改了同一字段，需人工选择 */
  conflicts: FieldDiff[];
  /** 自动合并的字段数 */
  autoMerged: number;
  /** 远端新增、已合入本地的记录 ID */
  addedFromRemote: number[];
  /** 远端已删除、本地未改动因而一并移除的记录 ID */
  removedByRemote: number[];
  /** 本地新增、远端尚无因而会随写回带上的记录 ID */
  addedFromLocal: number[];
}

/**
 * 三方合并：基线 / 本地 / 远端。
 *
 * 遍历「基线 ∪ 本地 ∪ 远端」ID 并集，逐记录分八种归属关系处理：
 *
 *   基线  本地  远端  处理
 *   ✔     ✔     ✔     字段级三方合并（双方同改同值不算冲突）
 *   ✔     ✔     ✗     远端已删：本地未改 → 接受删除（不复活）；本地改过 → 冲突
 *   ✔     ✗     ✔     本地已删：远端未改 → 接受删除；远端改过 → 冲突
 *   ✔     ✗     ✗     双方都已删 → 丢弃
 *   ✗     ✔     ✔     双方各自新增：内容一致 → 直接采用；不一致 → 冲突
 *   ✗     ✔     ✗     本地新增、远端尚无 → 保留本地（写回时带上）
 *   ✗     ✗     ✔     远端新增 → 合入本地（质检 P1-2）
 *   ✗     ✗     ✗     不存在
 */
export function threeWayMerge(
  base: RecordItem[],
  local: RecordItem[],
  remote: RecordItem[],
): MergeResult {
  const baseById = new Map(base.map((r) => [r.id, r]));
  const localById = new Map(local.map((r) => [r.id, r]));
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const conflicts: FieldDiff[] = [];
  const addedFromRemote: number[] = [];
  const removedByRemote: number[] = [];
  const addedFromLocal: number[] = [];
  const merged: RecordItem[] = [];
  let autoMerged = 0;

  const ids = [...new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()])]
    .sort((a, b) => a - b);

  for (const id of ids) {
    const b = baseById.get(id);
    const l = localById.get(id);
    const r = remoteById.get(id);

    /* ---- 本地与远端都有 ---- */
    if (l && r) {
      if (!b) {
        // 双方各自新增同一条记录：内容一致直接采用，否则交人工裁决
        if (recordsEqual(l, r)) {
          merged.push(clone(l));
          autoMerged += 1;
        } else {
          conflicts.push({
            记录ID: id, 名称: l.名称, 字段: '（新增记录）',
            基线值: undefined, 一侧值: clone(l.名称), 另一侧值: clone(r.名称),
          });
          merged.push(clone(l));
        }
        continue;
      }

      const out = clone(l);
      for (const f of COMPARE_FIELDS) {
        const localChanged = !same(b[f], l[f]);
        const remoteChanged = !same(b[f], r[f]);
        if (!localChanged && !remoteChanged) continue;
        const bag = out as unknown as Record<string, unknown>;
        if (localChanged && !remoteChanged) {
          bag[f] = clone(l[f]);
          autoMerged += 1;
        } else if (!localChanged && remoteChanged) {
          bag[f] = clone(r[f]);
          autoMerged += 1;
        } else if (same(l[f], r[f])) {
          // 双方改成相同取值 → 不算冲突
          autoMerged += 1;
        } else {
          conflicts.push({
            记录ID: id,
            名称: l.名称,
            字段: String(f),
            基线值: clone(b[f]),
            一侧值: clone(l[f]),
            另一侧值: clone(r[f]),
          });
          // 合并结果暂取本地值，等用户在冲突面板裁决
        }
      }

      merged.push(out);
      continue;
    }

    /* ---- 只有本地有 ---- */
    if (l && !r) {
      if (!b) {
        // 本地新增、远端尚无 → 保留本地，随下一次写回带上
        merged.push(clone(l));
        addedFromLocal.push(id);
        continue;
      }
      // 基线有、远端没了 → 远端已删除该记录
      if (!recordChanged(b, l)) {
        // 本地未改动 → 接受远端删除，不复活该记录（质检 P1-3）
        removedByRemote.push(id);
        continue;
      }
      conflicts.push({
        记录ID: id, 名称: l.名称, 字段: '（记录删除）',
        基线值: '（存在）', 一侧值: '（本地已修改）', 另一侧值: '（远端已删除）',
      });
      merged.push(clone(l));
      continue;
    }

    /* ---- 只有远端有 ---- */
    if (!l && r) {
      if (!b) {
        // 远端新增（另一台设备录入）→ 合入本地（质检 P1-2）
        merged.push(clone(r));
        addedFromRemote.push(id);
        continue;
      }
      // 基线有、本地没了 → 本地已删除（v4：物理删除，无回收站）
      if (!recordChanged(b, r)) {
        // 远端未改动 → 尊重本地删除，不把记录带回来
        continue;
      }
      conflicts.push({
        记录ID: id, 名称: r.名称, 字段: '（记录删除）',
        基线值: '（存在）', 一侧值: '（本地已删除）', 另一侧值: '（远端已修改）',
      });
      merged.push(clone(r));
      continue;
    }

    // 双方都没有：跳过（基线有、双方都删了）
  }

  return { merged, conflicts, autoMerged, addedFromRemote, removedByRemote, addedFromLocal };
}

/** 判断两份数据是否完全一致（用于「未改动不产生新版本」，AC-7） */
export function hasContentDiff(a: RecordItem[], b: RecordItem[]): boolean {
  if (a.length !== b.length) return true;
  const aById = new Map(a.map((r) => [r.id, r]));
  for (const rec of b) {
    const other = aById.get(rec.id);
    if (!other) return true;
    if (recordChanged(other, rec)) return true;
  }
  return false;
}
