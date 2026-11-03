/**
 * 信息汇总工作台 · 记录版面分区契约（v3 需求 1）
 *
 * 「新增/编辑表单」与「记录详情页」共用同一套分区，保证两处版面完全一致：
 *
 *   基础信息 / 拥有形态 / 状态及评价 / 备注 / 系统信息
 *
 * 分区归属由字段 key 决定（与数据文件里的键名一致）：
 *   · 基础信息 —— 名称、品牌、分类、款式、季节
 *   · 拥有形态 —— 教程、拥有形态、电子版尺码组、纸质版尺码
 *   · 状态及评价 —— 推荐、做过、想做
 *   · 备注 —— 备注
 *   · 系统信息 —— 记录ID、创建时间、更新时间（只读）
 *
 * 远端 schema 可能带来内置之外的新字段：未登记归属的业务字段落到「基础信息」，
 * 系统字段（system = true）一律落到「系统信息」。
 */

import type { FieldDef, Schema } from './types';

export const SECTION_TITLES = ['基础信息', '拥有形态', '状态及评价', '备注', '系统信息'] as const;

export type SectionTitle = typeof SECTION_TITLES[number];

/** 字段 → 分区归属表 */
export const FIELD_SECTION: Record<string, SectionTitle> = {
  名称: '基础信息',
  品牌: '基础信息',
  分类: '基础信息',
  款式: '基础信息',
  季节: '基础信息',
  教程: '拥有形态',
  // v6.1（需求 3）：「电子版尺码组」改名「电子版尺码」，仍归「拥有形态」区
  电子版尺码: '拥有形态',
  // 旧键保留登记（防御：旧缓存 schema 若仍带旧键，不至于落到错误分区）
  电子版尺码组: '拥有形态',
  // v5（R5）：「电子版」「纸质版」合并为「拥有形态」，分区归属随之合并
  拥有形态: '拥有形态',
  纸质版尺码: '拥有形态',
  推荐: '状态及评价',
  做过: '状态及评价',
  // v6.1（需求 2）：「想做」改名「计划」，仍归「状态及评价」区
  计划: '状态及评价',
  // 旧键保留登记（防御：旧缓存 schema 若仍带旧键，不至于落到错误分区）
  想做: '状态及评价',
  备注: '备注',
  创建时间: '系统信息',
  更新时间: '系统信息',
};

/** 字段归属的分区 */
export function sectionOfField(key: string, isSystem = false): SectionTitle {
  if (isSystem) return '系统信息';
  return FIELD_SECTION[key] ?? '基础信息';
}

export interface SectionPlan {
  title: SectionTitle;
  fields: FieldDef[];
}

/**
 * 按五分区把 schema 字段分组（详情页与表单页共用）。
 * 顺序：分区按 SECTION_TITLES 固定，分区内按 schema 字段顺序。
 */
export function buildSectionPlan(schema: Schema): SectionPlan[] {
  const buckets = new Map<SectionTitle, FieldDef[]>(
    SECTION_TITLES.map((t) => [t, [] as FieldDef[]]),
  );
  for (const f of schema.fields) {
    const title = sectionOfField(f.key, Boolean(f.system));
    buckets.get(title)!.push(f);
  }
  return SECTION_TITLES.map((title) => ({ title, fields: buckets.get(title)! }));
}

/** 表单页用：只保留可编辑字段（排除系统字段与只读字段） */
export function editableFieldsOf(schema: Schema): FieldDef[] {
  return schema.fields.filter((f) => !f.system && !f.readonly);
}

/** 表单页用：系统信息分区里要展示的只读字段 */
export function systemFieldsOf(schema: Schema): FieldDef[] {
  return schema.fields.filter((f) => f.system);
}
