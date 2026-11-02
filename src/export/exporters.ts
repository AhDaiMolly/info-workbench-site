/**
 * 信息汇总工作台 · 数据导出（架构第 6 章 / PRD 第 5.7 节）
 *
 * · JSON：与数据仓 records.json 同构，含全部字段，可再导入（AC-13）
 * · Excel：.xlsx，列顺序由 schema 驱动，多值以「、」分隔，行数 = 导出范围记录数（AC-14）
 * · 文件名统一模板：信息汇总工作台-数据-YYYYMMDD（AC-25）
 */

import * as XLSX from 'xlsx';
import type { RecordItem, RecordsFile, Schema } from '../types';
import { APP_NAME } from '../schema';
import { displayValue } from '../store/selectors';

export interface ExportMeta {
  /** 导出范围说明（全部 / 当前筛选命中） */
  scope: string;
  /** 导出时间 ISO 字符串 */
  exportedAt: string;
  /** 本次导出记录数 */
  count: number;
}

/** 文件名：信息汇总工作台-数据-YYYYMMDD */
export function exportFilename(ext: 'json' | 'xlsx', date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${APP_NAME}-数据-${y}${m}${d}.${ext}`;
}

/** 组装与 records.json 同构的导出对象（额外附加导出元信息，便于溯源，不影响再导入） */
export function buildJsonExport(
  records: RecordItem[],
  schema: Schema,
  meta: ExportMeta,
  dataVersion = 1,
): RecordsFile & { 导出范围: string; 导出时间: string; 记录数: number } {
  return {
    schemaVersion: schema.schemaVersion,
    dataVersion,
    updatedAt: meta.exportedAt,
    recordCount: records.length,
    records,
    导出范围: meta.scope,
    导出时间: meta.exportedAt,
    记录数: records.length,
  };
}

export function serializeJsonExport(
  records: RecordItem[],
  schema: Schema,
  meta: ExportMeta,
  dataVersion = 1,
): string {
  return JSON.stringify(buildJsonExport(records, schema, meta, dataVersion), null, 2);
}

/** 导出列顺序：schema 字段顺序在前（v4：不再有 deletedAt 列，回收站已移除） */
export function exportColumns(schema: Schema): string[] {
  return schema.fields.map((f) => f.jsonKey);
}

/** 生成 Excel 行数据（多值「、」分隔；布尔「是/否」） */
export function buildExportRows(records: RecordItem[], schema: Schema): Array<Record<string, string>> {
  const cols = exportColumns(schema);
  return records.map((r) => {
    const row: Record<string, string> = {};
    for (const c of cols) {
      row[c] = displayValue((r as unknown as Record<string, unknown>)[c]);
    }
    return row;
  });
}

/** 生成 xlsx 二进制（ArrayBuffer） */
export function buildXlsxBuffer(
  records: RecordItem[],
  schema: Schema,
  statsRows?: Array<Record<string, string>>,
): ArrayBuffer {
  const cols = exportColumns(schema);
  const rows = buildExportRows(records, schema);
  const sheet = XLSX.utils.json_to_sheet(rows, { header: cols });

  // 列宽（简约但不挤压）
  sheet['!cols'] = cols.map((c) => ({ wch: Math.min(40, Math.max(10, c.length * 2 + 6)) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, '数据');

  if (statsRows && statsRows.length) {
    const statCols = Object.keys(statsRows[0]);
    const statSheet = XLSX.utils.json_to_sheet(statsRows, { header: statCols });
    XLSX.utils.book_append_sheet(wb, statSheet, '看板统计');
  }

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return out;
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 释放对象 URL（延迟一拍，兼容 Safari）
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(
  records: RecordItem[],
  schema: Schema,
  meta: ExportMeta,
  dataVersion = 1,
): string {
  const text = serializeJsonExport(records, schema, meta, dataVersion);
  downloadBlob(
    new Blob([text], { type: 'application/json;charset=utf-8' }),
    exportFilename('json'),
  );
  return exportFilename('json');
}

export function downloadXlsx(
  records: RecordItem[],
  schema: Schema,
  statsRows?: Array<Record<string, string>>,
): string {
  const buffer = buildXlsxBuffer(records, schema, statsRows);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const name = exportFilename('xlsx');
  downloadBlob(blob, name);
  return name;
}

/** 导出迁移审计文件（AC-5） */
export function downloadAudit(audit: unknown): string {
  const text = JSON.stringify(audit, null, 2);
  const stamp = new Date();
  const y = stamp.getFullYear();
  const m = String(stamp.getMonth() + 1).padStart(2, '0');
  const d = String(stamp.getDate()).padStart(2, '0');
  const name = `${APP_NAME}-迁移审计-${y}${m}${d}.json`;
  downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), name);
  return name;
}

/** 把筛选结果与看板统计整理成「看板统计」工作表的行 */
export function buildStatsRows(stats: {
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
}): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const push = (维度: string, 项目: string, 数量: number | string) =>
    rows.push({ 维度, 项目, 数量: String(数量) });
  for (const b of stats.brand) push('品牌分布', b.name, b.value);
  if (stats.brandOther) push('品牌分布', '其他', stats.brandOther);
  for (const c of stats.category) push('分类分布', c.name, c.value);
  if (stats.categoryUncategorized) push('分类分布', '未分类', stats.categoryUncategorized);
  for (const s of stats.style) push('款式分布', s.name, s.value);
  if (stats.styleOther) push('款式分布', '其他', stats.styleOther);
  for (const s of stats.season) push('季节分布', s.name, s.value);
  if (stats.seasonBlank) push('季节分布', '未填', stats.seasonBlank);
  for (const o of stats.ownership) push('拥有形态', o.name, o.value);
  for (const c of stats.completion) push('完成与计划', c.name, c.value);
  return rows;
}
