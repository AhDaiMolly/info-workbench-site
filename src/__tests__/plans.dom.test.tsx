/**
 * v6.2 · 需求 1 计划清单（界面级验证，jsdom）
 *
 * 行为合同（v6.8 更新）：
 *   1. 设置页不再有「计划清单」模块（二级导航无该分组、全卡片无清单管理区）；
 *   2. 记录详情页「计划清单」卡片：chip 点选 = 加入/移出（回调带清单 ID 与记录 ID）；
 *   3. 列表筛选面板「计划清单」块：chip 点选触发筛选变更（OR 语义，value 为清单 ID）。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DEFAULT_SCHEMA } from '../schema';
import type { PlanItem, RecordItem, Filters } from '../types';
import { EMPTY_FILTERS } from '../types';

const holder = vi.hoisted(() => ({
  createPlanList: vi.fn(() => 'p1'),
  renamePlanList: vi.fn(),
  deletePlanList: vi.fn(),
  toggleRecordInPlan: vi.fn(),
  plans: [] as PlanItem[],
  navigateMock: vi.fn(),
}));

const sampleRecord: RecordItem = {
  id: 7,
  名称: '占位名称',
  品牌: '品牌甲',
  分类: ['女装'],
  款式: '外套',
  季节: '春秋',
  教程: '有',
  拥有形态: ['电子版'],
  电子版尺码: [],
  纸质版尺码: [],
  推荐: '未评价',
  做过: false,
  计划: '未标记',
  备注: '占位备注',
  创建时间: '2026-01-01T00:00:00.000Z',
  更新时间: '2026-01-02T00:00:00.000Z',
} as RecordItem;

function plan(id: string, name: string, members: number[] = []): PlanItem {
  return {
    id, 名称: name, 记录ID列表: members,
    创建时间: '2026-11-01T00:00:00.000Z', 更新时间: '2026-11-01T00:00:00.000Z',
  };
}

vi.mock('../store/store', () => ({
  useApp: () => ({
    records: [sampleRecord],
    plans: holder.plans,
    schema: DEFAULT_SCHEMA,
    config: null,
    connection: 'idle',
    syncStatus: 'idle',
    syncMessage: '',
    lastSyncedAt: 0,
    pending: [],
    // v6.3（需求 2）：字段选项管理卡片依赖
    optionCandidates: {},
    options: {},
    actionLog: [],
    backupIntervalDays: 7,
    actions: {
      createPlanList: holder.createPlanList,
      renamePlanList: holder.renamePlanList,
      deletePlanList: holder.deletePlanList,
      toggleRecordInPlan: holder.toggleRecordInPlan,
      removeFieldOption: vi.fn(),
      restoreFieldOption: vi.fn(),
    },
  }),
}));

vi.mock('../router', () => ({
  navigate: holder.navigateMock,
}));

// eslint-disable-next-line import/first
import { SettingsView } from '../features/settings/SettingsView';
// eslint-disable-next-line import/first
import { DetailView } from '../features/detail/DetailView';
// eslint-disable-next-line import/first
import { FilterPanel } from '../features/list/FilterPanel';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** v6.4（需求 2）：点二级导航切组（v6.8 起仅 4 组）—— 先点导航再断言 */
const openSettingsGroup = (id: string) => {
  const btn = document.querySelector(`[data-testid="iw-settings-nav-${id}"]`) as HTMLButtonElement | null;
  expect(btn).not.toBeNull();
  fireEvent.click(btn!);
};

describe('v6.8 · 设置页不再有「计划清单」模块', () => {
  it('二级导航没有「计划清单」分组；逐组点开都没有清单管理区/新建清单入口', () => {
    holder.plans = [plan('p1', '2026 春季', [7])];
    render(<SettingsView />);
    expect(document.querySelector('[data-testid="iw-settings-nav-plans"]')).toBeNull();
    for (const g of ['connection', 'data', 'options', 'version']) {
      openSettingsGroup(g);
      expect(document.querySelector('[data-testid="iw-plans-admin"]')).toBeNull();
      expect(document.body.textContent ?? '').not.toContain('新建清单');
      expect(document.body.textContent ?? '').not.toContain('管理清单成员');
    }
  });
});

describe('v6.2 · 详情页记录加入/移出清单', () => {
  it('chip 展示清单与成员数，点击回调 toggleRecordInPlan(清单 ID, 记录 ID)', () => {
    holder.plans = [plan('p1', '2026 春季', [7]), plan('p2', '给宝宝做的')];
    render(<DetailView id={7} />);
    const card = screen.getByTestId('iw-plan-card');
    expect(card.textContent).toContain('计划清单');
    expect(card.textContent).toContain('当前共在 1 份清单里');

    const chip = screen.getByRole('button', { name: '计划清单：2026 春季' }) as HTMLButtonElement;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(holder.toggleRecordInPlan).toHaveBeenCalledWith('p1', 7);

    const chip2 = screen.getByRole('button', { name: '计划清单：给宝宝做的' }) as HTMLButtonElement;
    expect(chip2.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip2);
    expect(holder.toggleRecordInPlan).toHaveBeenCalledWith('p2', 7);
  });

  it('没有任何清单时给出引导提示（指向「清单」页签）', () => {
    holder.plans = [];
    render(<DetailView id={7} />);
    const card = screen.getByTestId('iw-plan-card');
    expect(card.textContent).toContain('还没有计划清单');
    expect(card.textContent).toContain('「清单」页签');
  });
});

describe('v6.2 · 筛选面板按计划清单筛选', () => {
  const baseProps = {
    schema: DEFAULT_SCHEMA,
    presets: [],
    onApplyPreset: vi.fn(),
    onSavePreset: vi.fn(),
    onDeletePreset: vi.fn(),
  };

  /** 折叠面板：先展开再断言 chip */
  const openPanel = () => {
    fireEvent.click(screen.getByRole('button', { name: /^筛选条件/ }));
  };

  it('点选清单 chip → onChange 收到含清单 ID 的筛选（value 为 ID 非名称）', () => {
    const onChange = vi.fn();
    const filters: Filters = { ...EMPTY_FILTERS };
    render(
      <FilterPanel
        {...baseProps}
        filters={filters}
        onChange={onChange}
        onClear={() => {}}
        plans={[{ id: 'p1', name: '2026 春季' }, { id: 'p2', name: '给宝宝做的' }]}
      />,
    );
    openPanel();
    const chip = screen.getByRole('button', { name: '计划清单：2026 春季' }) as HTMLButtonElement;
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].计划清单).toEqual(['p1']);
  });

  it('已选中的清单 chip 再点一次 → 从筛选中移除', () => {
    const onChange = vi.fn();
    const filters: Filters = { ...EMPTY_FILTERS, 计划清单: ['p1'] };
    render(
      <FilterPanel
        {...baseProps}
        filters={filters}
        onChange={onChange}
        onClear={() => {}}
        plans={[{ id: 'p1', name: '2026 春季' }]}
      />,
    );
    openPanel();
    const chip = screen.getByRole('button', { name: '计划清单：2026 春季' }) as HTMLButtonElement;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(onChange.mock.calls[0][0].计划清单).toEqual([]);
  });

  it('没有可选清单时展示引导提示', () => {
    render(
      <FilterPanel
        {...baseProps}
        filters={{ ...EMPTY_FILTERS }}
        onChange={() => {}}
        onClear={() => {}}
        plans={[]}
      />,
    );
    openPanel();
    expect(screen.getByText(/还没有计划清单/)).toBeTruthy();
  });

  it('v6.4 · 需求 7：筛选面板不再出现「推荐」「计划」筛选项（计划清单保留）', () => {
    render(
      <FilterPanel
        {...baseProps}
        filters={{ ...EMPTY_FILTERS }}
        onChange={() => {}}
        onClear={() => {}}
        plans={[{ id: 'p1', name: '2026 春季' }]}
      />,
    );
    openPanel();
    const names = screen
      .getAllByRole('button')
      .map((b) => (b as HTMLButtonElement).getAttribute('aria-label') ?? b.textContent ?? '');
    expect(names.some((n) => n.includes('推荐'))).toBe(false);
    // 「计划」只允许以「计划清单」形式出现
    expect(names.some((n) => n.includes('计划') && !n.includes('计划清单'))).toBe(false);
    expect(names.some((n) => n.includes('计划清单'))).toBe(true);
  });
});

describe('v6.8 · 筛选面板清单入口不再依赖设置页', () => {
  const baseProps = {
    schema: DEFAULT_SCHEMA,
    presets: [],
    onApplyPreset: vi.fn(),
    onSavePreset: vi.fn(),
    onDeletePreset: vi.fn(),
  };
  const openPanel = () => {
    fireEvent.click(screen.getByRole('button', { name: /^筛选条件/ }));
  };

  it('「管理清单…」未选中清单时跳「清单」一级页签（不是设置页）', () => {
    render(
      <FilterPanel
        {...baseProps}
        filters={{ ...EMPTY_FILTERS }}
        onChange={() => {}}
        onClear={() => {}}
        plans={[{ id: 'p1', name: '2026 春季' }, { id: 'p2', name: '给宝宝做的' }]}
      />,
    );
    openPanel();
    fireEvent.click(screen.getByTestId('iw-filter-manage-plans'));
    expect(holder.navigateMock).toHaveBeenCalledWith(expect.objectContaining({ view: 'plans' }));
    const calls = holder.navigateMock.mock.calls.map((c) => c[0] as { view?: string });
    expect(calls.every((c) => c.view !== 'settings')).toBe(true);
  });

  it('「管理清单…」恰好选中一份清单时进该清单管理页', () => {
    render(
      <FilterPanel
        {...baseProps}
        filters={{ ...EMPTY_FILTERS, 计划清单: ['p1'] } as Filters}
        onChange={() => {}}
        onClear={() => {}}
        plans={[{ id: 'p1', name: '2026 春季' }]}
      />,
    );
    openPanel();
    fireEvent.click(screen.getByTestId('iw-filter-manage-plans'));
    expect(holder.navigateMock).toHaveBeenCalledWith(expect.objectContaining({ view: 'plan', planId: 'p1' }));
  });

  it('没有清单时「去创建」跳「清单」一级页签', () => {
    render(
      <FilterPanel
        {...baseProps}
        filters={{ ...EMPTY_FILTERS }}
        onChange={() => {}}
        onClear={() => {}}
        plans={[]}
      />,
    );
    openPanel();
    expect(screen.getByText(/还没有计划清单/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('iw-filter-goto-plans'));
    expect(holder.navigateMock).toHaveBeenCalledWith(expect.objectContaining({ view: 'plans' }));
  });
});
