/**
 * 信息汇总工作台 · 待人工确认清单动态核对（v6.1.1）
 *
 * 背景：v1 导入时曾把矛盾项写成静态快照（数据仓 data/pending-conflicts.json），
 * 之后不再跟随数据更新 —— 用户修复记录后提醒永不消失，且措辞停留在旧字段口径。
 * v6.1.1 起改为打开工作台时按**当前记录数据**实时重算，本模块就是核对规则的唯一事实源。
 *
 * 规则集沿用 v1 迁移工具（tools/migrate.mjs）的 5 条，字段口径同步到 v6.1 schema：
 *   矛盾（勾选与信息矛盾）——
 *     1. 拥有形态未勾选「电子版」，但电子版尺码非空
 *        （v1 原文「拥有电子版=否，但电子版尺码组=[…]、电子版缺码=…」；
 *         「电子版缺码」字段 v3 已删除，动态版以「电子版尺码非空」为准）
 *     2. 拥有形态未勾选「纸质版」，但纸质版尺码非空
 *     3. 名称（原「编号」）为空 —— 关键字段缺失
 *   建议补全（信息缺失，非矛盾）——
 *     4. 拥有形态勾选了「电子版」，但电子版尺码为空
 *     5. 拥有形态勾选了「纸质版」，但纸质版尺码为空
 *
 * 系统不自动翻转任何勾选值、不自动填值；用户修复记录后条目自动从清单消失。
 */

import type { ConflictEntry, RecordItem, SuggestionEntry } from '../types';

export const OWNERSHIP_ELECTRONIC = '电子版';
export const OWNERSHIP_PAPER = '纸质版';

/** 清单项的稳定键：同一记录同一字段的问题在数据不变时键不变（忽略清单按此持久化） */
export function checkKey(类型: string, 字段: string, 记录ID: number): string {
  return `${类型}|${字段}|${记录ID}`;
}

export interface PendingChecks {
  conflicts: ConflictEntry[];
  suggestions: SuggestionEntry[];
}

/** 按当前记录实时核对，返回矛盾项与建议补全项（均按记录 ID 升序，保证展示顺序稳定） */
export function computePendingChecks(records: RecordItem[]): PendingChecks {
  const conflicts: ConflictEntry[] = [];
  const suggestions: SuggestionEntry[] = [];

  const byId = [...records].sort((a, b) => a.id - b.id);
  for (const r of byId) {
    const own = Array.isArray(r.拥有形态) ? r.拥有形态 : [];
    const esize = Array.isArray(r.电子版尺码) ? r.电子版尺码 : [];
    const psize = Array.isArray(r.纸质版尺码) ? r.纸质版尺码 : [];

    /* 规则 1：未勾电子版却填了电子版尺码 */
    if (!own.includes(OWNERSHIP_ELECTRONIC) && esize.length > 0) {
      conflicts.push({
        key: checkKey('勾选与信息矛盾', '电子版尺码', r.id),
        类型: '勾选与信息矛盾',
        字段: '电子版尺码',
        记录ID: r.id,
        名称: r.名称,
        详情: `拥有形态未勾选「电子版」，但电子版尺码=[${esize.join('、')}]`,
        处理建议: '请人工确认：是勾选漏填，还是尺码为占位信息。系统未自动翻转勾选值。',
      });
    }
    /* 规则 2：未勾纸质版却填了纸质版尺码 */
    if (!own.includes(OWNERSHIP_PAPER) && psize.length > 0) {
      conflicts.push({
        key: checkKey('勾选与信息矛盾', '纸质版尺码', r.id),
        类型: '勾选与信息矛盾',
        字段: '纸质版尺码',
        记录ID: r.id,
        名称: r.名称,
        详情: `拥有形态未勾选「纸质版」，但纸质版尺码=[${psize.join('、')}]`,
        处理建议: '请人工确认：是勾选漏填，还是尺码为占位信息。系统未自动翻转勾选值。',
      });
    }
    /* 规则 3：名称为空（关键字段缺失） */
    if (!String(r.名称 ?? '').trim()) {
      conflicts.push({
        key: checkKey('关键字段缺失', '名称', r.id),
        类型: '关键字段缺失',
        字段: '名称',
        记录ID: r.id,
        名称: '',
        详情: `名称为空，该记录仅有品牌=${r.品牌 || '（空）'}，其余关键字段为空`,
        处理建议: '请人工补全名称，或删除该条遗留记录。',
      });
    }
    /* 规则 4：勾了电子版但电子版尺码为空 */
    if (own.includes(OWNERSHIP_ELECTRONIC) && esize.length === 0) {
      suggestions.push({
        key: checkKey('建议补全', '电子版尺码', r.id),
        类型: '建议补全',
        字段: '电子版尺码',
        记录ID: r.id,
        名称: r.名称,
        详情: '拥有形态勾选了「电子版」，但电子版尺码为空',
        处理建议: '建议补全电子版尺码（未自动填值）。',
      });
    }
    /* 规则 5：勾了纸质版但纸质版尺码为空 */
    if (own.includes(OWNERSHIP_PAPER) && psize.length === 0) {
      suggestions.push({
        key: checkKey('建议补全', '纸质版尺码', r.id),
        类型: '建议补全',
        字段: '纸质版尺码',
        记录ID: r.id,
        名称: r.名称,
        详情: '拥有形态勾选了「纸质版」，但纸质版尺码为空',
        处理建议: '建议补全纸质版尺码（未自动填值）。',
      });
    }
  }

  return { conflicts, suggestions };
}

/** 忽略条目的本地持久化形态：键 + 摘要（设置页展示用）+ 忽略时间 */
export interface IgnoredCheckEntry {
  key: string;
  摘要: string;
  ignoredAt: string;
}

/** 把核对项转成忽略清单里的摘要文本 */
export function checkSummary(item: ConflictEntry | SuggestionEntry): string {
  const prefix = item.类型 === '建议补全' ? '建议补全' : '矛盾';
  return `#${item.记录ID} ${prefix}·${item.字段}${item.名称 ? `（${item.名称}）` : ''}`;
}
