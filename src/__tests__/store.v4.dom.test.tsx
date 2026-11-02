/**
 * v4 store 级回归（jsdom）：
 *   · 空名称记录无法经任何入口产生（新增 / 编辑都被拦下）
 *   · 删除即物理删除 + 记一条「删除」待写回变更
 *   · 一键清理空壳记录：只删空壳，其余记录不动
 *   · 操作日志只保留最近 3 条，存在浏览器本地
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { AppProvider, useApp } from '../store/store';
import { STORAGE_KEYS, ACTION_LOG_LIMIT } from '../store/persist';
import { DEFAULT_SCHEMA } from '../schema';
import type { RecordItem } from '../types';

function makeRecord(over: Partial<RecordItem> & { id: number }): RecordItem {
  const { id, ...rest } = over;
  return {
    id,
    名称: `记录-${id}`,
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

function seedCache(records: RecordItem[]): void {
  window.localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify({
    schemaVersion: 3,
    dataVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    schema: DEFAULT_SCHEMA,
    records,
  }));
}

function setup(records: RecordItem[]) {
  seedCache(records);
  return renderHook(() => useApp(), {
    wrapper: ({ children }) => <AppProvider>{children}</AppProvider>,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  // jsdom 没有实现 Blob 下载所需的 URL API，这里补最小桩（导出走真实下载链路）
  if (!URL.createObjectURL) {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:stub';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
  }
});

afterEach(() => {
  cleanup();
});

describe('v4：空名称记录无法经任何入口产生', () => {
  it('新增时名称为空 → 拒绝创建，记录数不变', () => {
    const { result } = setup([makeRecord({ id: 1 })]);
    const before = result.current.records.length;

    let returned: number | null = 99;
    act(() => {
      returned = result.current.actions.addRecord({ 名称: '', 品牌: '品牌甲' });
    });

    expect(returned).toBeNull();
    expect(result.current.records.length).toBe(before);
    expect(result.current.records.some((r) => String(r.名称).trim() === '')).toBe(false);
  });

  it('新增时名称只有空白 → 同样拒绝创建', () => {
    const { result } = setup([makeRecord({ id: 1 })]);
    const before = result.current.records.length;

    act(() => {
      result.current.actions.addRecord({ 名称: '   ', 品牌: '品牌甲' });
    });

    expect(result.current.records.length).toBe(before);
    expect(result.current.records.some((r) => String(r.名称).trim() === '')).toBe(false);
  });

  it('新增时名称合法 → 正常创建，且名称被去掉首尾空白', () => {
    const { result } = setup([makeRecord({ id: 1 })]);
    let id: number | null = null;
    act(() => {
      id = result.current.actions.addRecord({ 名称: '  新条目  ', 品牌: '品牌甲' });
    });
    expect(id).not.toBeNull();
    const created = result.current.records.find((r) => r.id === id);
    expect(created?.名称).toBe('新条目');
    expect(result.current.records.some((r) => String(r.名称).trim() === '')).toBe(false);
  });

  it('编辑时把名称改成空白 → 拒绝保存，原记录名称不变', () => {
    const { result } = setup([makeRecord({ id: 1, 名称: '正常名称' })]);
    act(() => {
      result.current.actions.updateRecord(1, { 名称: '  ' });
    });
    expect(result.current.records.find((r) => r.id === 1)?.名称).toBe('正常名称');
  });
});

describe('v4：删除即物理删除（无回收站）', () => {
  it('删除后记录立刻从列表消失，并记一条「删除」待写回变更', () => {
    const { result } = setup([makeRecord({ id: 1 }), makeRecord({ id: 2 })]);
    act(() => {
      result.current.actions.deleteRecord(1);
    });
    expect(result.current.records.map((r) => r.id)).toEqual([2]);
    const del = result.current.pending.find((p) => p.动作 === '删除');
    expect(del).toBeTruthy();
    expect(del?.记录ID).toBe(1);
  });

  it('新记录的 ID 不复用已删除的号（发号水位）', () => {
    const { result } = setup([makeRecord({ id: 1 }), makeRecord({ id: 2 })]);
    act(() => {
      result.current.actions.deleteRecord(2);
    });
    let id: number | null = null;
    act(() => {
      id = result.current.actions.addRecord({ 名称: '新条目', 品牌: '品牌甲' });
    });
    expect(id).toBe(3);
  });
});

describe('v4：一键清理空壳记录', () => {
  it('只删空壳记录，其余记录不动，并生成「删除」变更', () => {
    const { result } = setup([
      makeRecord({ id: 1 }),
      makeRecord({ id: 795, 名称: '', 品牌: '品牌甲' }),
      makeRecord({ id: 2 }),
    ]);

    let count = 0;
    act(() => {
      count = result.current.actions.cleanupShellRecords();
    });

    expect(count).toBe(1);
    expect(result.current.records.map((r) => r.id)).toEqual([1, 2]);
    expect(result.current.pending.some((p) => p.动作 === '删除' && p.记录ID === 795)).toBe(true);
  });

  it('没有空壳记录时不做任何事', () => {
    const { result } = setup([makeRecord({ id: 1 })]);
    let count = 0;
    act(() => {
      count = result.current.actions.cleanupShellRecords();
    });
    expect(count).toBe(0);
    expect(result.current.records.length).toBe(1);
  });
});

describe('v4：操作日志只保留最近 3 条', () => {
  it('连续 5 次导出后，日志只剩 3 条（最新的在最前）', () => {
    const { result } = setup([makeRecord({ id: 1 })]);
    act(() => {
      for (let i = 0; i < 5; i += 1) result.current.actions.exportJson('all');
    });
    expect(result.current.actionLog.length).toBe(ACTION_LOG_LIMIT);
    expect(ACTION_LOG_LIMIT).toBe(3);
    expect(result.current.actionLog[0].类型).toBe('本地备份导出');
    expect(result.current.actionLog[0].结果).toBe('成功');
  });

  it('日志落在浏览器本地存储里（只存最近 3 条）', () => {
    const { result } = setup([makeRecord({ id: 1 })]);
    act(() => {
      for (let i = 0; i < 4; i += 1) result.current.actions.exportJson('all');
    });
    const raw = window.localStorage.getItem(STORAGE_KEYS.actionlog);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(3);
  });

  it('日志条目字段齐备（时间 / 类型 / 结果 / 说明）', () => {
    const { result } = setup([makeRecord({ id: 1 })]);
    act(() => {
      result.current.actions.exportJson('all');
    });
    const entry = result.current.actionLog[0];
    expect(entry.时间).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.类型).toBe('本地备份导出');
    expect(entry.结果).toBe('成功');
    expect(typeof entry.说明).toBe('string');
  });
});
