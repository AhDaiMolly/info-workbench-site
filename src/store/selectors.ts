/**
 * 信息汇总工作台 · 筛选 / 搜索 / 排序 / 看板统计（纯函数，无副作用）
 *
 * 口径与 PRD 第 5.4 / 5.5 / 6 节一致：
 *   · 多条件 AND：不同字段之间取交集
 *   · 同字段多值 OR：字段内命中任一选项即返回（分类为「选项级匹配」）
 *   · 搜索范围：名称、品牌、备注（PRD 第 5.5 节）
 *   · 看板：分类按「选项级计数」——多值记录在每个命中的选项各计 1 次
 *
 * v3 变更：
 *   · 「拥有电子版 / 拥有纸质版」布尔 → 「电子版 / 纸质版」枚举三态，索引与筛选口径同步改为字符串匹配
 *   · 删除「电子版缺码」相关索引与筛选（原统计口径整体移除）
 *   · 拥有形态看板新增「待确认」桶：电子版/纸质版 任一为「不确定」的记录单独归集，
 *     不混入「都没有」（否则三态信息被布尔口径吃掉）
 *
 * v5 变更（R5）：
 *   · 「电子版 / 纸质版」两个三态单选 → 单个「拥有形态」多选，索引与筛选口径同步改写
 *   · 筛选语义为「包含」：选中「电子版」= 拥有形态含「电子版」；「任意拥有」= 拥有形态非空
 *   · 看板「拥有形态分布」改为单字段四态：皆无 / 仅电子 / 仅纸质 / 双有（不再有「待确认」桶）
 */

import type { Filters, RecordItem, SortSpec } from '../types';
import { CATEGORY_ORDER, OWNERSHIP_ANY, SIZE_GROUP_ORDER } from '../schema';

/* ------------------------------- 全文索引 ------------------------------- */

export interface Indexes {
  /** 字段级倒排：字段 → 取值 → 记录 ID 列表 */
  field: Map<string, Map<string, number[]>>;
  /** 全文倒排：词元 → 记录 ID 列表 */
  tokens: Map<string, number[]>;
  /** 记录 ID → 小写可搜索文本（名称 / 品牌 / 备注，用不可见分隔符隔开，防止跨字段误命中） */
  blobs: Map<number, string>;
}

const FIELD_SEP = '';
const CJK = /[㐀-䶿一-鿿豈-﫿]/;
const LATIN_WORD = /[a-z0-9]+/g;

/** 把一段文本切成检索词元：CJK 取 1~3 字滑窗，拉丁/数字取整词 */
export function tokenize(text: string): string[] {
  const lower = String(text ?? '').toLowerCase();
  const out: string[] = [];
  // 拉丁字母与数字
  for (const m of lower.matchAll(LATIN_WORD)) out.push(m[0]);
  // CJK 滑窗
  const cjk = lower.replace(/[^㐀-䶿一-鿿豈-﫿]/g, ' ');
  for (const seg of cjk.split(/\s+/)) {
    if (!seg) continue;
    for (let len = 1; len <= 3; len += 1) {
      for (let i = 0; i + len <= seg.length; i += 1) out.push(seg.slice(i, i + len));
    }
  }
  return out;
}

/** 记录的可搜索文本 */
export function searchBlob(r: RecordItem): string {
  return [r.名称 ?? '', r.品牌 ?? '', r.备注 ?? '']
    .map((s) => String(s).toLowerCase())
    .join(FIELD_SEP);
}

function push(map: Map<string, number[]>, key: string, id: number) {
  const arr = map.get(key);
  if (arr) arr.push(id);
  else map.set(key, [id]);
}

/** 构建全部索引（O(n) 一次性构建） */
export function buildIndexes(records: RecordItem[]): Indexes {
  const field = new Map<string, Map<string, number[]>>();
  const tokens = new Map<string, number[]>();
  const blobs = new Map<number, string>();

  const fieldIndex = (key: string, value: string, id: number) => {
    let m = field.get(key);
    if (!m) { m = new Map(); field.set(key, m); }
    push(m, value, id);
  };

  for (const r of records) {
    fieldIndex('品牌', r.品牌 ?? '', r.id);
    fieldIndex('款式', r.款式 ?? '', r.id);
    fieldIndex('季节', r.季节 ?? '', r.id);
    fieldIndex('教程', r.教程 ?? '', r.id);
    fieldIndex('推荐', r.推荐 ?? '', r.id);
    fieldIndex('想做', r.想做 ?? '', r.id);
    fieldIndex('做过', r.做过 ? '是' : '否', r.id);
    // 多值字段：选项级索引（命中任一选项即返回）
    for (const c of r.分类 ?? []) fieldIndex('分类', c, r.id);
    for (const s of r.电子版尺码组 ?? []) fieldIndex('电子版尺码组', s, r.id);
    // v5（R5）：「拥有形态」多选，按选项级索引
    for (const o of r.拥有形态 ?? []) fieldIndex('拥有形态', o, r.id);

    const blob = searchBlob(r);
    blobs.set(r.id, blob);
    for (const t of new Set(tokenize(blob))) push(tokens, t, r.id);
  }

  return { field, tokens, blobs };
}

/* -------------------------------- 筛选 -------------------------------- */

/** 判断单条记录是否命中全部筛选条件 */
export function matchesFilters(r: RecordItem, f: Filters): boolean {
  if (f.品牌.length && !f.品牌.includes(r.品牌 ?? '')) return false;
  if (f.款式.length && !f.款式.includes(r.款式 ?? '')) return false;
  if (f.季节.length && !f.季节.includes(r.季节 ?? '')) return false;
  if (f.教程.length && !f.教程.includes(r.教程 ?? '')) return false;
  if (f.推荐.length && !f.推荐.includes(r.推荐 ?? '')) return false;
  if (f.想做.length && !f.想做.includes(r.想做 ?? '')) return false;
  // 分类：命中任一选项即返回
  if (f.分类.length && !(r.分类 ?? []).some((c) => f.分类.includes(c))) return false;
  if (f.电子版尺码组.length && !(r.电子版尺码组 ?? []).some((s) => f.电子版尺码组.includes(s))) return false;
  // v5（R5）：「拥有形态」多选 —— 「包含」语义
  //   · 选中「电子版」/「纸质版」：该形态必须拥有（多项同时选中 = 都要有，即「双有」）
  //   · 选中「任意拥有」：拥有形态非空
  // 语义与旧的两个下拉等价（旧模型两个下拉之间是 AND），且额外支持「任意拥有」。
  if (f.拥有形态.length) {
    const own = r.拥有形态 ?? [];
    const formats = f.拥有形态.filter((o) => o !== OWNERSHIP_ANY);
    if (formats.length && !formats.every((o) => own.includes(o))) return false;
    if (f.拥有形态.includes(OWNERSHIP_ANY) && own.length === 0) return false;
  }
  // 布尔三态
  if (f.做过 !== undefined && r.做过 !== f.做过) return false;
  return true;
}

/** 是否有任何筛选条件生效 */
export function hasActiveFilters(f: Filters): boolean {
  return Boolean(
    f.品牌.length || f.分类.length || f.款式.length || f.季节.length || f.教程.length
    || f.推荐.length || f.想做.length || f.电子版尺码组.length
    || f.拥有形态.length
    || f.做过 !== undefined,
  );
}

/** 筛选（不含搜索） */
export function filterRecords(records: RecordItem[], f: Filters): RecordItem[] {
  if (!hasActiveFilters(f)) return records;
  return records.filter((r) => matchesFilters(r, f));
}

/* -------------------------------- 搜索 -------------------------------- */

/**
 * 全文搜索：返回命中的记录 ID 集合。
 * 索引负责缩小候选集（倒排求交），长关键词再用子串校验保证精确。
 */
export function searchIds(records: RecordItem[], query: string, idx?: Indexes): number[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return records.map((r) => r.id);

  const index = idx ?? buildIndexes(records);
  const segments = q.split(/[\s,，、]+/).filter(Boolean);
  if (!segments.length) return records.map((r) => r.id);

  let candidates: number[] | null = null;

  for (const seg of segments) {
    let segIds: number[] | null = null;
    if (CJK.test(seg)) {
      if (seg.length <= 3) {
        segIds = index.tokens.get(seg) ?? [];
      } else {
        // 长中文词：先用 3 字词元缩小候选，再用子串精确校验
        segIds = index.tokens.get(seg.slice(0, 3)) ?? [];
      }
    } else {
      segIds = index.tokens.get(seg) ?? [];
    }
    candidates = candidates === null ? segIds : intersect(candidates, segIds);
    if (candidates.length === 0) return [];
  }

  const hit = candidates ?? [];
  // 长关键词需子串精确校验
  return hit.filter((id) => {
    const blob = index.blobs.get(id) ?? '';
    return segments.every((seg) => blob.includes(seg));
  });
}

function intersect(a: number[], b: number[]): number[] {
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}

/** 筛选 + 搜索叠加 */
export function applyQuery(records: RecordItem[], f: Filters, query: string, idx?: Indexes): RecordItem[] {
  const filtered = filterRecords(records, f);
  const q = String(query ?? '').trim();
  if (!q) return filtered;
  const hits = new Set(searchIds(filtered, q, idx));
  return filtered.filter((r) => hits.has(r.id));
}

/* -------------------------------- 排序 -------------------------------- */

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

export function sortRecords(records: RecordItem[], sort: SortSpec): RecordItem[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const copy = records.slice();
  copy.sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case 'id':
        cmp = a.id - b.id;
        break;
      case '名称':
        cmp = collator.compare(a.名称 ?? '', b.名称 ?? '');
        break;
      case '品牌':
        cmp = collator.compare(a.品牌 ?? '', b.品牌 ?? '')
          || collator.compare(a.名称 ?? '', b.名称 ?? '');
        break;
      case '更新时间':
      default:
        cmp = (Date.parse(a.更新时间) || 0) - (Date.parse(b.更新时间) || 0);
        break;
    }
    // 时间相同时用记录 ID 兜底，保证顺序稳定且新增记录排在前面
    if (cmp === 0) cmp = a.id - b.id;
    return cmp * dir;
  });
  return copy;
}

/* ------------------------------ 看板统计 ------------------------------ */

export interface Stats {
  total: number;
  做过: number;
  想做: number;
  brand: Array<{ name: string; value: number }>;
  brandOther: number;
  category: Array<{ name: string; value: number }>;
  categoryUncategorized: number;
  style: Array<{ name: string; value: number }>;
  styleOther: number;
  season: Array<{ name: string; value: number }>;
  seasonBlank: number;
  ownership: Array<{ name: string; value: number }>;
  completion: Array<{ name: string; value: number }>;
}

function tallyBy(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

/** 看板统计：口径与 PRD 第 6 节基线一致 */
export function computeStats(records: RecordItem[]): Stats {
  const brandMap = tallyBy(records.map((r) => r.品牌 ?? ''));
  const brandSorted = [...brandMap.entries()]
    .filter(([k]) => k !== '')
    .sort((a, b) => b[1] - a[1]);
  const brand = brandSorted.slice(0, 10).map(([name, value]) => ({ name, value }));
  const brandOther = brandSorted.slice(10).reduce((s, [, v]) => s + v, 0);

  // 分类：选项级计数（多值记录在每个命中选项各计 1 次）
  const catMap = new Map<string, number>();
  for (const r of records) {
    for (const c of new Set(r.分类 ?? [])) catMap.set(c, (catMap.get(c) ?? 0) + 1);
  }
  const category = CATEGORY_ORDER
    .filter((c) => catMap.has(c))
    .map((name) => ({ name, value: catMap.get(name) ?? 0 }));
  for (const [name, value] of [...catMap.entries()].filter(([k]) => !CATEGORY_ORDER.includes(k))) {
    category.push({ name, value });
  }
  const categoryUncategorized = records.filter((r) => !(r.分类 ?? []).length).length;

  const styleMap = tallyBy(records.map((r) => r.款式 ?? ''));
  const styleSorted = [...styleMap.entries()].filter(([k]) => k !== '').sort((a, b) => b[1] - a[1]);
  const style = styleSorted.slice(0, 10).map(([name, value]) => ({ name, value }));
  const styleOther = styleSorted.slice(10).reduce((s, [, v]) => s + v, 0);

  const seasonMap = tallyBy(records.map((r) => r.季节 ?? ''));
  const season = ['夏', '春秋', '冬']
    .filter((s) => seasonMap.has(s))
    .map((name) => ({ name, value: seasonMap.get(name) ?? 0 }));
  const seasonBlank = seasonMap.get('') ?? 0;

  // v5（R5）：拥有形态由两字段三态 → 单字段四态（皆无 / 仅电子 / 仅纸质 / 双有）
  const ownsE = (r: RecordItem) => (r.拥有形态 ?? []).includes('电子版');
  const ownsP = (r: RecordItem) => (r.拥有形态 ?? []).includes('纸质版');
  const ownership = [
    { name: '皆无', value: records.filter((r) => !ownsE(r) && !ownsP(r)).length },
    { name: '仅电子', value: records.filter((r) => ownsE(r) && !ownsP(r)).length },
    { name: '仅纸质', value: records.filter((r) => !ownsE(r) && ownsP(r)).length },
    { name: '双有', value: records.filter((r) => ownsE(r) && ownsP(r)).length },
  ];

  const completionMap = tallyBy(records.map((r) => r.想做 ?? ''));
  const completion = ['想做', '不确定', '不想做', '未标记']
    .filter((k) => completionMap.has(k))
    .map((name) => ({ name, value: completionMap.get(name) ?? 0 }));

  return {
    total: records.length,
    做过: records.filter((r) => r.做过).length,
    想做: records.filter((r) => r.想做 === '想做').length,
    brand,
    brandOther,
    category,
    categoryUncategorized,
    style,
    styleOther,
    season,
    seasonBlank,
    ownership,
    completion,
  };
}

/* ------------------------------ 高亮工具 ------------------------------ */

export interface HighlightPart {
  text: string;
  hit: boolean;
}

/** 把文本按查询词切成「命中 / 未命中」片段，用于搜索结果高亮 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const src = String(text ?? '');
  const q = String(query ?? '').trim();
  if (!q) return [{ text: src, hit: false }];
  const lowerSrc = src.toLowerCase();
  const lowerQ = q.toLowerCase();
  const parts: HighlightPart[] = [];
  let i = 0;
  while (i < src.length) {
    const found = lowerSrc.indexOf(lowerQ, i);
    if (found === -1) {
      parts.push({ text: src.slice(i), hit: false });
      break;
    }
    if (found > i) parts.push({ text: src.slice(i, found), hit: false });
    parts.push({ text: src.slice(found, found + q.length), hit: true });
    i = found + q.length;
  }
  return parts.length ? parts : [{ text: src, hit: false }];
}

/** 导出用：多值字段以「、」分隔 */
export function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value === null || value === undefined) return '';
  return String(value);
}

export { SIZE_GROUP_ORDER };
