/**
 * v6.6 界面级回归（jsdom）：
 *   · 需求 2：列表新增「清单」列 —— 多值「、」连接、无清单留空、title 悬浮全量
 *   · 需求 3：行标注色新口径 —— 清单为空至少标黄；分类/款式/季节缺则灰优先
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Filters, PlanItem, RecordItem } from '../types';

const { recordsHolder, plansHolder, stateHolder, setQueryMock } = vi.hoisted(() => {
  const emptyFilters = () => ({
    品牌: [], 分类: [], 款式: [], 季节: [], 教程: [],
    推荐: [], 计划: [], 电子版尺码: [], 拥有形态: [], 计划清单: [],
    做过: undefined,
  });
  return {
    recordsHolder: { records: [] as RecordItem[] },
    plansHolder: { plans: [] as PlanItem[] },
    stateHolder: {
      filters: emptyFilters() as Filters,
      query: '',
      visibleColumns: [] as string[],
      plans: [] as PlanItem[],
    },
    setQueryMock: vi.fn(),
  };
});

vi.mock('../store/store', async () => {
  const { DEFAULT_SCHEMA } = await vi.importActual<typeof import('../schema')>('../schema');
  const { buildPlanMembers } = await vi.importActual<typeof import('../store/plans')>('../store/plans');
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
      planMembers: buildPlanMembers(plansHolder.plans),
      schema: DEFAULT_SCHEMA,
      optionCandidates: { 品牌: ['晨雾'], 款式: ['外套'], 电子版尺码: ['M'], 纸质版尺码: ['M'] },
      conflicts: [],
      suggestions: [],
      ignoredChecks: [],
      presets: [],
      plans: plansHolder.plans,
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

function plan(id: string, name: string, members: number[]): PlanItem {
  return {
    id, 名称: name, 记录ID列表: members,
    创建时间: '2026-11-01T00:00:00.000Z', 更新时间: '2026-11-01T00:00:00.000Z',
  };
}

const headText = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('thead th')).map((el) => el.textContent);

const rowByName = (container: HTMLElement, name: string): HTMLElement => {
  const rows = Array.from(container.querySelectorAll('tbody tr'));
  const hit = rows.find((tr) => tr.querySelector('td a')?.textContent === name);
  if (!hit) throw new Error(`未找到名称为「${name}」的行`);
  return hit as HTMLElement;
};

beforeEach(() => {
  cleanup();
  setQueryMock.mockClear();
  stateHolder.filters = { ...EMPTY_FILTERS } as Filters;
  stateHolder.query = '';
  stateHolder.visibleColumns = [...DEFAULT_VISIBLE_COLUMNS];
  plansHolder.plans = [
    plan('p1', '2026春季', [1]),
    plan('p2', '给宝宝做的', [1, 2]),
  ];
  recordsHolder.records = [
    // 1：双清单 + 三者齐 + 有形态 → 无标注色
    rec({ id: 1, 名称: '双清单齐全', 分类: ['女装'], 款式: '外套', 季节: '夏', 拥有形态: ['电子版'] }),
    // 2：单清单 + 三者齐 + 无形态 → 黄（旧规则）
    rec({ id: 2, 名称: '单清单无形态', 分类: ['女装'], 款式: '外套', 季节: '夏', 拥有形态: [] }),
    // 3：无清单 + 三者齐 + 有形态 → 黄（新规则：清单为空至少标黄）
    rec({ id: 3, 名称: '无清单齐全', 分类: ['女装'], 款式: '外套', 季节: '夏', 拥有形态: ['纸质版'] }),
    // 4：无清单 + 分类缺 → 灰（灰优先于黄）
    rec({ id: 4, 名称: '无清单缺分类', 分类: [], 款式: '外套', 季节: '夏', 拥有形态: ['电子版'] }),
    // 5：在清单里 + 分类缺 → 灰（旧灰规则）
    rec({ id: 5, 名称: '在清单缺季节', 分类: ['女装'], 款式: '外套', 季节: '', 拥有形态: [] }),
  ];
  // 5 号也放进 p2，验证「在清单里但三要素缺 → 仍灰」
  plansHolder.plans[1].记录ID列表.push(5);
});

describe('v6.6（需求 2）：列表「清单」列', () => {
  it('表头含「清单」列（默认列集）', () => {
    const { container } = render(<ListView />);
    expect(headText(container)).toContain('清单');
  });

  it('多清单记录展示全部清单名（、连接），title 含全量', () => {
    const { container } = render(<ListView />);
    const heads = headText(container);
    const ci = heads.indexOf('清单');
    const row = rowByName(container, '双清单齐全');
    const cell = row.children[ci] as HTMLElement;
    expect(cell.textContent).toBe('2026春季、给宝宝做的');
    expect(cell.querySelector('.iw-plans-cell')?.getAttribute('title')).toBe('2026春季、给宝宝做的');
  });

  it('单清单记录只显示一份；无清单记录留空（不是「—」）', () => {
    const { container } = render(<ListView />);
    const heads = headText(container);
    const ci = heads.indexOf('清单');
    expect((rowByName(container, '单清单无形态').children[ci] as HTMLElement).textContent).toBe('给宝宝做的');
    const empty = (rowByName(container, '无清单齐全').children[ci] as HTMLElement).textContent;
    expect(empty).toBe('');
  });
});

describe('行标注色（v6.8 单规则：不在任何清单 → 浅黄，其余不填色）', () => {
  it('不在任何清单 → 浅黄（无论信息齐全与否、是否有形态）', () => {
    const { container } = render(<ListView />);
    expect(rowByName(container, '无清单齐全').className).toContain('iw-row-noformat');
    expect(rowByName(container, '无清单缺分类').className).toContain('iw-row-noformat');
  });

  it('在清单里 → 无标注色（即使信息缺或无形态）', () => {
    const { container } = render(<ListView />);
    expect(rowByName(container, '双清单齐全').className).not.toContain('iw-row-noformat');
    expect(rowByName(container, '单清单无形态').className).not.toContain('iw-row-noformat');
    expect(rowByName(container, '在清单缺季节').className).not.toContain('iw-row-noformat');
  });
});
