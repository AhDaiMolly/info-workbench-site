import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildExportRows, buildJsonExport, buildStatsRows, buildXlsxBuffer, exportColumns,
  exportFilename, serializeJsonExport,
} from '../export/exporters';
import { DEFAULT_SCHEMA } from '../schema';
import type { RecordItem } from '../types';

/** 虚构占位数据，站点仓内不得出现真实记录值。 */

function makeRecord(over: Partial<RecordItem> & { id: number }): RecordItem {
  const { id, ...rest } = over;
  return {
    id,
    名称: `记录-${over.id}`,
    品牌: '品牌甲',
    分类: [],
    款式: '',
    季节: '',
    教程: '未知',
    电子版: '不确定',
    电子版尺码组: [],
    纸质版: '不确定',
    纸质版尺码: [],
    推荐: '未评价',
    做过: false,
    想做: '未标记',
    备注: '',
    创建时间: '2026-01-01T00:00:00.000Z',
    更新时间: '2026-01-01T00:00:00.000Z',
    ...rest,
  } as RecordItem;
}

const records: RecordItem[] = [
  makeRecord({
    id: 1, 名称: '条目一', 品牌: '品牌甲', 分类: ['女装'], 款式: '衬衣', 季节: '夏',
    教程: '有', 电子版: '有', 纸质版: '没有', 电子版尺码组: ['女士全码'], 推荐: '推荐', 做过: true,
    想做: '想做', 备注: '第一行备注',
  }),
  makeRecord({
    id: 2, 名称: '条目二', 品牌: '品牌乙', 分类: ['女装', '男装'], 电子版: '没有',
    纸质版: '有', 纸质版尺码: ['S', 'M'], 备注: '第二行备注'
  }),
];

describe('导出文件名（AC-25）', () => {
  it('统一模板 信息汇总工作台-数据-YYYYMMDD', () => {
    const d = new Date(2026, 0, 5);
    expect(exportFilename('json', d)).toBe('信息汇总工作台-数据-20260105.json');
    expect(exportFilename('xlsx', d)).toBe('信息汇总工作台-数据-20260105.xlsx');
  });
});

describe('JSON 导出（AC-13）', () => {
  it('结构与 records.json 同构并附加导出元信息', () => {
    const out = buildJsonExport(records, DEFAULT_SCHEMA, {
      scope: '当前筛选命中',
      exportedAt: '2026-06-01T00:00:00.000Z',
      count: records.length,
    }, 7);
    expect(out.schemaVersion).toBe(DEFAULT_SCHEMA.schemaVersion);
    expect(out.dataVersion).toBe(7);
    expect(out.recordCount).toBe(2);
    expect(out.records.length).toBe(2);
    expect(out.导出范围).toBe('当前筛选命中');
    expect(out.导出时间).toBe('2026-06-01T00:00:00.000Z');
    expect(out.记录数).toBe(2);
  });

  it('序列化后仍可被 JSON.parse 还原且记录完整', () => {
    const text = serializeJsonExport(records, DEFAULT_SCHEMA, {
      scope: '全部记录',
      exportedAt: '2026-06-01T00:00:00.000Z',
      count: records.length,
    });
    const back = JSON.parse(text);
    expect(back.records.length).toBe(2);
    expect(back.records[0].名称).toBe('条目一');
    expect(back.records[1].备注).toBe('第二行备注');
  });
});

describe('导出列与行（AC-14）', () => {
  it('列顺序跟随 schema，v4 不再有 deletedAt 列', () => {
    const cols = exportColumns(DEFAULT_SCHEMA);
    expect(cols[0]).toBe('id');
    expect(cols[1]).toBe('名称');
    expect(cols).toContain('品牌');
    expect(cols).toContain('备注');
  });

  it('v4：回收站移除后导出列不含 deletedAt', () => {
    const cols = exportColumns(DEFAULT_SCHEMA);
    expect(cols).not.toContain('deletedAt');
    expect(cols[cols.length - 1]).toBe('更新时间');
  });

  it('多值以「、」分隔、拥有形态按枚举原样导出', () => {
    const rows = buildExportRows(records, DEFAULT_SCHEMA);
    expect(rows[0].分类).toBe('女装');
    expect(rows[1].分类).toBe('女装、男装');
    expect(rows[0].电子版).toBe('有');
    expect(rows[1].电子版).toBe('没有');
    expect(rows[1].纸质版).toBe('有');
    expect(rows[1].纸质版尺码).toBe('S、M');
  });

  it('导出列不再包含已删除字段', () => {
    const cols = exportColumns(DEFAULT_SCHEMA);
    expect(cols).not.toContain('电子版缺码');
    expect(cols).not.toContain('关联');
    expect(cols).not.toContain('拥有电子版');
    expect(cols).toContain('电子版');
    expect(cols).toContain('纸质版');
  });

  it('行数等于记录数', () => {
    expect(buildExportRows(records, DEFAULT_SCHEMA).length).toBe(2);
  });
});

describe('Excel 导出', () => {
  it('生成可解析的 xlsx，工作表名为「数据」', () => {
    const buf = buildXlsxBuffer(records, DEFAULT_SCHEMA);
    const wb = XLSX.read(buf, { type: 'array' });
    expect(wb.SheetNames).toContain('数据');
    const sheet = wb.Sheets['数据'];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);
    expect(rows.length).toBe(2);
    expect(String(rows[0]['名称'])).toBe('条目一');
    expect(String(rows[1]['分类'])).toBe('女装、男装');
  });

  it('附带看板统计工作表', () => {
    const statsRows = buildStatsRows({
      brand: [{ name: '品牌甲', value: 1 }],
      brandOther: 0,
      category: [{ name: '女装', value: 2 }],
      categoryUncategorized: 0,
      style: [],
      styleOther: 0,
      season: [],
      seasonBlank: 1,
      ownership: [{ name: '仅电子版', value: 1 }],
      completion: [{ name: '做过', value: 1 }],
    });
    const buf = buildXlsxBuffer(records, DEFAULT_SCHEMA, statsRows);
    const wb = XLSX.read(buf, { type: 'array' });
    expect(wb.SheetNames).toContain('看板统计');
    const s = wb.Sheets['看板统计'];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(s);
    expect(rows.length).toBe(statsRows.length);
    expect(rows[0]['维度']).toBe('品牌分布');
  });

  it('统计行按维度分组且带未分类/未填归集', () => {
    const rows = buildStatsRows({
      brand: [{ name: '品牌甲', value: 1 }],
      brandOther: 2,
      category: [],
      categoryUncategorized: 1,
      style: [],
      styleOther: 0,
      season: [],
      seasonBlank: 1,
      ownership: [],
      completion: [],
    });
    expect(rows.find((r) => r['项目'] === '其他')?.['数量']).toBe('2');
    expect(rows.find((r) => r['项目'] === '未分类')?.['数量']).toBe('1');
    expect(rows.find((r) => r['项目'] === '未填')?.['数量']).toBe('1');
  });
});
