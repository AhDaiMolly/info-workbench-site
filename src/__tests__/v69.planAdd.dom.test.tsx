/**
 * v6.9 · 需求 2「＋ 添加记录」挑选页（界面级验证，jsdom）
 *
 * 行为合同：
 *   1. 路由 #/plan-add/:id 渲染挑选页，标题写明目标清单；
 *   2. 布局与列表页一致：同款搜索框 + 筛选面板 + 记录表格 + 分页器；
 *   3. 已在清单中的记录整行置灰、勾选框禁用并带「已在清单」标识（不可重复加入）；
 *   4. 记录可多选（点行 / 点勾选框都生效），确认按钮显示已选数量且未选时禁用；
 *   5. 确认 → 回调 addRecordsToPlan(planId, ids) 并返回清单页；
 *   6. 清单不存在 → 引导空态 + 返回按钮。
 *
 * 搜索 / 筛选是本地状态：本页变更不会写入全局 filters。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { DEFAULT_SCHEMA } from '../schema';
import type { Filters, PlanItem, RecordItem } from '../types';

const holder = vi.hoisted(() => ({
  addRecordsToPlan: vi.fn(),
  plans: [] as PlanItem[],
  navigateMock: vi.fn(),
}));

function mkRecord(
  id: number,
  name: string,
  cat: string,
  season: string,
  brand = '品牌甲',
  style = '外套',
  own: string[] = ['电子版'],
): RecordItem {
  return {
    id,
    名称: name,
    品牌: brand,
    分类: [cat],
    款式: style,
    季节: season,
    教程: '有',
    拥有形态: own,
    电子版尺码: [],
    纸质版尺码: [],
    推荐: '未评价',
    做过: false,
    计划: '未标记',
    备注: '',
    创建时间: '2026-01-01T00:00:00.000Z',
    更新时间: '2026-01-02T00:00:00.000Z',
  } as unknown as RecordItem;
}

const records: RecordItem[] = [
  mkRecord(1, '棉麻衬衫', '上衣', '春秋'),
  mkRecord(2, '百褶裙', '下装', '夏', '品牌甲', '裙装', ['电子版', '纸质版']),
  mkRecord(3, '风衣', '外套', '春秋', '品牌乙'),
];

vi.mock('../store/store', async () => {
  const { buildPlanMembers } = await vi.importActual<typeof import('../store/plans')>('../store/plans');
  return {
    useApp: () => ({
      records,
      plans: holder.plans,
      planMembers: buildPlanMembers(holder.plans),
      schema: DEFAULT_SCHEMA,
      optionCandidates: { 品牌: ['品牌甲', '品牌乙'], 款式: ['外套', '裙装'], 电子版尺码: ['M'], 纸质版尺码: ['M'] },
      presets: [],
      indexes: undefined,
      filters: {} as Filters,
      query: '',
      sort: { key: '名称', dir: 'asc' },
      actions: {
        addRecordsToPlan: holder.addRecordsToPlan,
        savePreset: vi.fn(),
        deletePreset: vi.fn(),
      },
    }),
  };
});

vi.mock('../router', () => ({
  navigate: holder.navigateMock,
}));

// eslint-disable-next-line import/first
import { PlanAddView } from '../features/plan/PlanAddView';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  holder.plans = [
    { id: 'p1', 名称: '2026 春季', 记录ID列表: [1], 创建时间: '2026-11-01T00:00:00.000Z', 更新时间: '2026-11-01T00:00:00.000Z' },
    { id: 'p2', 名称: '给宝宝做的', 记录ID列表: [], 创建时间: '2026-11-01T00:00:00.000Z', 更新时间: '2026-11-01T00:00:00.000Z' },
  ];
});

describe('v6.9 · 挑选页布局与标题', () => {
  it('渲染挑选页，标题与说明写明目标清单与统计', () => {
    render(<PlanAddView planId="p1" />);
    expect(screen.getByTestId('iw-plan-add-view')).toBeTruthy();
    expect(screen.getByTestId('iw-plan-add-title').textContent).toBe('加入清单');
    const sub = screen.getByTestId('iw-plan-add-sub').textContent ?? '';
    expect(sub).toContain('2026 春季');
    expect(sub).toContain('1 条已在清单');
  });

  it('布局与列表页一致：搜索框 + 筛选面板 + 表格 + 分页器都渲染', () => {
    const { container } = render(<PlanAddView planId="p1" />);
    expect(container.querySelector('.iw-toolbar input')).toBeTruthy();
    expect(container.querySelector('.iw-filter-panel')).toBeTruthy();
    expect(screen.getByTestId('iw-plan-add-table')).toBeTruthy();
    expect(container.querySelector('.iw-pager')).toBeTruthy();
  });

  it('清单不存在 → 空态引导 + 返回按钮', () => {
    render(<PlanAddView planId="pX" />);
    expect(screen.getByTestId('iw-plan-add-missing').textContent).toContain('清单不存在');
    fireEvent.click(screen.getByRole('button', { name: '返回清单' }));
    expect(holder.navigateMock).toHaveBeenCalledWith({ view: 'plans' });
  });
});

describe('v6.9 · 已在清单的记录置灰且不可重复加入', () => {
  it('已在清单的行：置灰类 + 勾选框禁用 +「已在清单」标识；不在的行可勾', () => {
    render(<PlanAddView planId="p1" />);
    const rowIn = screen.getByTestId('iw-plan-add-row-1');
    expect(rowIn.className).toContain('iw-plan-add-row-in');
    expect((screen.getByTestId('iw-plan-add-check-1') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('iw-plan-add-in-1').textContent).toBe('已在清单');
    expect(screen.queryByTestId('iw-plan-add-in-2')).toBeNull();
    expect((screen.getByTestId('iw-plan-add-check-2') as HTMLInputElement).disabled).toBe(false);
  });

  it('点已在清单的行不改变已选数；点普通行勾选', () => {
    render(<PlanAddView planId="p1" />);
    fireEvent.click(screen.getByTestId('iw-plan-add-row-1'));
    expect(screen.getByTestId('iw-plan-add-confirm').textContent).toBe('加入清单（0）');
    fireEvent.click(screen.getByTestId('iw-plan-add-row-2'));
    expect(screen.getByTestId('iw-plan-add-confirm').textContent).toBe('加入清单（1）');
  });
});

describe('v6.9 · 多选与批量加入', () => {
  it('勾选多条（点行 / 点勾选框两种方式）→ 确认回调 addRecordsToPlan 并返回清单页', () => {
    render(<PlanAddView planId="p2" />);
    fireEvent.click(screen.getByTestId('iw-plan-add-row-2'));
    fireEvent.click(screen.getByTestId('iw-plan-add-check-3'));
    const confirm = screen.getByTestId('iw-plan-add-confirm') as HTMLButtonElement;
    expect(confirm.textContent).toBe('加入清单（2）');
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(holder.addRecordsToPlan).toHaveBeenCalledWith('p2', [2, 3]);
    expect(holder.navigateMock).toHaveBeenCalledWith({ view: 'plans' });
  });

  it('再点一次取消勾选；未选任何记录时确认按钮禁用', () => {
    render(<PlanAddView planId="p2" />);
    const confirm = screen.getByTestId('iw-plan-add-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('iw-plan-add-check-2'));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(screen.getByTestId('iw-plan-add-check-2'));
    expect(confirm.disabled).toBe(true);
    expect(confirm.textContent).toBe('加入清单（0）');
  });

  it('搜索过滤本地生效：输入关键词后只剩命中行（不写全局 filters）', async () => {
    render(<PlanAddView planId="p1" />);
    const search = screen
      .getByTestId('iw-plan-add-view')
      .querySelector('.iw-toolbar input') as HTMLInputElement;
    fireEvent.change(search, { target: { value: '风衣' } });
    // 搜索框 120ms 去抖后本地 query 生效
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.getByTestId('iw-plan-add-row-3')).toBeTruthy();
    expect(screen.queryByTestId('iw-plan-add-row-1')).toBeNull();
    expect(screen.queryByTestId('iw-plan-add-row-2')).toBeNull();
  });
});

describe('v6.9 · 表格列', () => {
  it('表头含「选 / 记录ID / 名称 / 品牌 / 款式 / 季节 / 做过 / 清单」', () => {
    const { container } = render(<PlanAddView planId="p1" />);
    const heads = Array.from(container.querySelectorAll('thead th')).map((el) => el.textContent ?? '');
    const joined = heads.join('|');
    expect(joined).toContain('选');
    expect(joined).toContain('记录ID');
    expect(joined).toContain('名称');
    expect(joined).toContain('品牌');
    expect(joined).toContain('季节');
    expect(joined).toContain('做过');
    expect(joined).toContain('清单');
  });

  it('行内含 #编号 与名称', () => {
    render(<PlanAddView planId="p1" />);
    const row = within(screen.getByTestId('iw-plan-add-row-2'));
    expect(row.getByText('#2')).toBeTruthy();
    expect(row.getByText('百褶裙')).toBeTruthy();
  });
});
