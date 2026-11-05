/**
 * v6.5 界面级回归（jsdom）：
 *   · 列表「电子 / 纸质」两列（√ / ×）、行标注色（灰优先于黄）
 *   · 搜索框「×」清空后恢复未筛选的完整列表
 *   · 筛选面板「尺码」标题 +「均没有」选项
 *   · 列表列里不再有「推荐」「计划」
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Filters, RecordItem } from '../types';

// vi.hoisted 先于 import 求值，回调里只能用字面量；真实 EMPTY_FILTERS / DEFAULT_VISIBLE_COLUMNS 在 beforeEach 里回填
const { recordsHolder, stateHolder, setQueryMock } = vi.hoisted(() => {
  const emptyFilters = () => ({
    品牌: [], 分类: [], 款式: [], 季节: [], 教程: [],
    推荐: [], 计划: [], 电子版尺码: [], 拥有形态: [], 计划清单: [],
    做过: undefined,
  });
  return {
    recordsHolder: { records: [] as RecordItem[] },
    stateHolder: {
      filters: emptyFilters() as Filters,
      query: '89',
      visibleColumns: [] as string[],
    },
    setQueryMock: vi.fn(),
  };
});

vi.mock('../store/store', async () => {
  const { DEFAULT_SCHEMA } = await vi.importActual<typeof import('../schema')>('../schema');
  return {
    useApp: () => ({
    records: recordsHolder.records,
    filters: stateHolder.filters,
    query: stateHolder.query,
    sort: { key: '名称', dir: 'asc' },
    visibleColumns: stateHolder.visibleColumns,
    page: 1,
    pageSize: 50,
    pending: [],
    indexes: undefined,
    planMembers: undefined,
    schema: DEFAULT_SCHEMA,
    optionCandidates: { 品牌: ['晨雾'], 款式: ['外套'], 电子版尺码: ['M'], 纸质版尺码: ['M'] },
    conflicts: [],
    suggestions: [],
    ignoredChecks: [],
    presets: [],
    plans: [],
    actions: {
      setSort: vi.fn(),
      setQuery: setQueryMock,
      setFilters: vi.fn(),
      clearFilters: vi.fn(),
      setPage: vi.fn(),
      setPageSize: vi.fn(),
      setColumns: vi.fn(),
      ignoreCheckItem: vi.fn(),
      ignoreAllChecks: vi.fn(),
      savePreset: vi.fn(),
      deletePreset: vi.fn(),
    },
    }),
  };
});

vi.mock('../router', () => ({ navigate: vi.fn() }));

// eslint-disable-next-line import/first
import { ListView } from '../features/list/ListView';
// eslint-disable-next-line import/first
import { DEFAULT_VISIBLE_COLUMNS } from '../schema';
// eslint-disable-next-line import/first
import { EMPTY_FILTERS } from '../types';

function rec(over: Partial<RecordItem> & { id: number }): RecordItem {
  const { id, ...rest } = over;
  return {
    id,
    名称: `记录-${id}`,
    品牌: '',
    分类: [],
    款式: '',
    季节: '',
    教程: '未知',
    电子版尺码: [],
    拥有形态: [],
    纸质版尺码: [],
    推荐: '未评价',
    做过: false,
    计划: '未标记',
    备注: '',
    创建时间: '2026-01-01T00:00:00.000Z',
    更新时间: '2026-01-01T00:00:00.000Z',
    ...rest,
  } as RecordItem;
}

const headText = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('thead th')).map((el) => el.textContent);

/** 按名称单元格定位行（不依赖排序顺序） */
const rowByName = (container: HTMLElement, name: string): HTMLElement => {
  const rows = Array.from(container.querySelectorAll('tbody tr'));
  const hit = rows.find((tr) => tr.querySelector('td a')?.textContent === name);
  if (!hit) throw new Error(`未找到名称为「${name}」的行，现有：${rows.map((r) => r.querySelector('td a')?.textContent).join(' | ')}`);
  return hit as HTMLElement;
};

beforeEach(() => {
  cleanup();
  setQueryMock.mockClear();
  stateHolder.filters = { ...EMPTY_FILTERS } as Filters;
  stateHolder.query = '89';
  stateHolder.visibleColumns = [...DEFAULT_VISIBLE_COLUMNS];
  recordsHolder.records = [
    rec({ id: 1, 名称: '896文艺套装-上衣', 分类: ['女装'], 款式: '外套', 季节: '夏', 拥有形态: ['电子版'] }),
    rec({ id: 2, 名称: '信息不全的记录', 分类: [], 款式: '', 季节: '' }),
    rec({ id: 3, 名称: '齐全但无形态', 分类: ['女装'], 款式: '外套', 季节: '夏', 拥有形态: [] }),
  ];
});

describe('v6.5（需求 9）：列表「电子 / 纸质」两列', () => {
  it('表头含「电子」「纸质」，不含「形态」「推荐」「计划」', () => {
    const { container } = render(<ListView />);
    const heads = headText(container);
    expect(heads).toContain('电子');
    expect(heads).toContain('纸质');
    expect(heads).not.toContain('形态');
    expect(heads).not.toContain('推荐');
    expect(heads).not.toContain('计划');
  });

  it('按拥有形态分别显示 √ / ×', () => {
    stateHolder.query = '';
    const { container } = render(<ListView />);
    const heads = headText(container);
    const ei = heads.indexOf('电子');
    const pi = heads.indexOf('纸质');
    const r1 = rowByName(container, '896文艺套装-上衣');
    const r2 = rowByName(container, '信息不全的记录');
    expect(r1.children[ei].textContent).toBe('✓');
    expect(r1.children[pi].textContent).toBe('×');
    expect(r2.children[ei].textContent).toBe('×');
  });
});

describe('v6.5（需求 8）：行标注色', () => {
  it('信息不全的行是浅灰（iw-row-incomplete）', () => {
    stateHolder.query = '';
    const { container } = render(<ListView />);
    const row = rowByName(container, '信息不全的记录');
    expect(row.className).toContain('iw-row-incomplete');
    expect(row.className).not.toContain('iw-row-noformat');
  });

  it('信息齐全但没有拥有形态的行是浅黄（iw-row-noformat）', () => {
    stateHolder.query = '';
    const { container } = render(<ListView />);
    const row = rowByName(container, '齐全但无形态');
    expect(row.className).toContain('iw-row-noformat');
    expect(row.className).not.toContain('iw-row-incomplete');
  });

  it('信息齐全且有形态的行没有标注色', () => {
    stateHolder.query = '';
    const { container } = render(<ListView />);
    const row = rowByName(container, '896文艺套装-上衣');
    expect(row.className).not.toContain('iw-row-incomplete');
    expect(row.className).not.toContain('iw-row-noformat');
  });
});

describe('v6.5（需求 7）：搜索框「×」清空', () => {
  it('有输入时渲染清空按钮，点它清空输入并把 query 置空（恢复完整列表）', () => {
    const { container } = render(<ListView />);
    const btn = container.querySelector('[data-testid="iw-search-clear"]');
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);
    expect(setQueryMock).toHaveBeenCalledWith('');
  });

  it('无输入时不渲染清空按钮', () => {
    stateHolder.query = '';
    const { container } = render(<ListView />);
    expect(container.querySelector('[data-testid="iw-search-clear"]')).toBeNull();
  });
});

describe('v6.5（需求 4 / 5）：筛选面板', () => {
  it('筛选项标题为「尺码」，拥有形态里有「均没有」', () => {
    const { container } = render(<ListView />);
    fireEvent.click(container.querySelector('.iw-filter-panel .iw-btn') as HTMLButtonElement);
    const titles = Array.from(container.querySelectorAll('.iw-filter-block-title')).map((el) => el.textContent);
    expect(titles).toContain('尺码');
    expect(titles).not.toContain('电子版尺码');
    const own = Array.from(container.querySelectorAll('.iw-filter-block-title'))
      .find((el) => el.textContent === '拥有形态')?.nextElementSibling;
    expect(own?.textContent).toContain('均没有');
  });
});
