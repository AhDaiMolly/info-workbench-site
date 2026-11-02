/**
 * 信息汇总工作台 · 内置兜底字段定义
 *
 * ⚠️ 安全约束（架构 7.1 / 7.2 第 5 条）：本文件与站点仓内任何文件都不得包含真实记录值。
 * 因此「品牌」「款式」的选项集在兜底 schema 中为空——它们由数据仓的 schema.json 提供，
 * 只有连接数据仓后才会有真实选项。
 *
 * 这里内置的仅是「产品定义型」选项集（分类 / 季节 / 教程 / 推荐 / 想做 / 电子版尺码组），
 * 这些来自 PRD 第 4.2 节的需求定义，与具体数据无关，可以安全地出现在公开站点仓中。
 */

import type { FieldDef, Schema } from './types';

export const APP_NAME = '信息汇总工作台';

export const CATEGORY_ORDER = ['女装', '男装', '童装', '婴童', '通用'];
export const SIZE_GROUP_ORDER = ['女士全码', '男士全码', '大小童全码', '仅小童'];

export const DEFAULT_FIELDS: FieldDef[] = [
  { key: '记录ID', jsonKey: 'id', type: 'number', label: '记录ID', readonly: true, system: true },
  { key: '名称', jsonKey: '名称', type: 'text', label: '名称', required: true },
  { key: '品牌', jsonKey: '品牌', type: 'enum', label: '品牌', required: true, options: [], allowNew: true },
  { key: '分类', jsonKey: '分类', type: 'multi', label: '分类', options: CATEGORY_ORDER, ordered: true },
  { key: '款式', jsonKey: '款式', type: 'enum', label: '款式', options: [], allowNew: true },
  { key: '季节', jsonKey: '季节', type: 'enum', label: '季节', options: ['夏', '春秋', '冬'] },
  { key: '教程', jsonKey: '教程', type: 'enum', label: '教程', options: ['有', '无', '未知'] },
  { key: '拥有电子版', jsonKey: '拥有电子版', type: 'boolean', label: '拥有电子版' },
  { key: '电子版尺码组', jsonKey: '电子版尺码组', type: 'multi', label: '电子版尺码组', options: SIZE_GROUP_ORDER, ordered: true },
  { key: '电子版缺码', jsonKey: '电子版缺码', type: 'boolean', label: '电子版缺码' },
  { key: '拥有纸质版', jsonKey: '拥有纸质版', type: 'boolean', label: '拥有纸质版' },
  { key: '纸质版尺码', jsonKey: '纸质版尺码', type: 'tags', label: '纸质版尺码' },
  { key: '推荐', jsonKey: '推荐', type: 'enum', label: '推荐', options: ['推荐', '不推荐', '未评价'] },
  { key: '做过', jsonKey: '做过', type: 'boolean', label: '做过' },
  { key: '想做', jsonKey: '想做', type: 'enum', label: '想做', options: ['想做', '不想做', '不确定', '未标记'] },
  { key: '关联', jsonKey: '关联', type: 'refs', label: '关联', multiple: true },
  { key: '备注', jsonKey: '备注', type: 'text', label: '备注', long: true },
  { key: '创建时间', jsonKey: '创建时间', type: 'datetime', label: '创建时间', readonly: true, system: true },
  { key: '更新时间', jsonKey: '更新时间', type: 'datetime', label: '更新时间', readonly: true, system: true },
];

export const DEFAULT_SCHEMA: Schema = {
  schemaVersion: 1,
  appName: APP_NAME,
  fields: DEFAULT_FIELDS,
  systemFields: ['id', '创建时间', '更新时间', 'deletedAt'],
};

/**
 * 合并远端 schema 与内置 schema：
 * 远端提供真实选项集（品牌 23 项 / 款式 24 项），内置提供字段结构与兜底选项。
 * 远端新增字段会被追加（只做加法迁移，不改既有字段）。
 */
export function mergeSchema(base: Schema, remote: Partial<Schema> | null | undefined): Schema {
  if (!remote || !Array.isArray(remote.fields) || remote.fields.length === 0) return base;
  const byKey = new Map(base.fields.map((f) => [f.key, f]));
  for (const rf of remote.fields) {
    const existing = byKey.get(rf.key);
    if (existing) {
      byKey.set(rf.key, { ...existing, ...rf, options: rf.options ?? existing.options });
    } else {
      byKey.set(rf.key, rf);
    }
  }
  return {
    ...base,
    ...remote,
    appName: base.appName,
    fields: [...byKey.values()],
    systemFields: remote.systemFields ?? base.systemFields,
  };
}

/** 列表默认显示的列（PRD 第 5.3 节） */
export const DEFAULT_VISIBLE_COLUMNS = [
  '名称', '品牌', '分类', '款式', '季节', '教程', '推荐', '做过', '想做',
];
