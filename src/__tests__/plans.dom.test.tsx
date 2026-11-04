/**
 * v6.2 · 需求 1 计划清单（界面级验证，jsdom）
 *
 * 行为合同：
 *   1. 设置页「计划清单」卡片：新建 / 重命名（弹窗）/ 删除（弹窗确认，文案说明只解除关联）；
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

describe('v6.2 · 设置页计划清单管理', () => {
  it('空态提示 + 新建清单调用 createPlanList（名称 trim 后传入）', () => {
    holder.plans = [];
    render(<SettingsView />);
    expect(screen.getByTestId('iw-plans-admin').textContent).toContain('还没有计划清单');
    const input = screen.getByTestId('iw-new-plan-name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  2026 春季  ' } });
    fireEvent.click(screen.getByTestId('iw-new-plan-submit'));
    expect(holder.createPlanList).toHaveBeenCalledWith('2026 春季');
  });

  it('空名不触发新建', () => {
    holder.plans = [];
    render(<SettingsView />);
    fireEvent.change(screen.getByTestId('iw-new-plan-name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('iw-new-plan-submit'));
    expect(holder.createPlanList).not.toHaveBeenCalled();
  });

  it('清单列表展示名称与成员数；重命名弹窗保存回调 renamePlanList', () => {
    holder.plans = [plan('p1', '2026 春季', [7, 9]), plan('p2', '给宝宝做的')];
    render(<SettingsView />);
    expect(screen.getByText(/2026 春季/)).toBeTruthy();
    expect(screen.getByText(/（2 条）/)).toBeTruthy();
    expect(screen.getByText(/（0 条）/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('iw-plan-rename-p1'));
    const dialog = screen.getByTestId('iw-rename-plan-input') as HTMLInputElement;
    expect(dialog.value).toBe('2026 春季');
    fireEvent.change(dialog, { target: { value: '2026 春夏' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(holder.renamePlanList).toHaveBeenCalledWith('p1', '2026 春夏');
  });

  it('删除弹窗文案说明只解除关联不删记录；确认回调 deletePlanList', () => {
    holder.plans = [plan('p1', '2026 春季', [7])];
    render(<SettingsView />);
    fireEvent.click(screen.getByTestId('iw-plan-delete-p1'));
    const hint = screen.getByTestId('iw-delete-plan-hint').textContent ?? '';
    expect(hint).toContain('2026 春季');
    expect(hint).toContain('只解除记录关联');
    expect(hint).toContain('不会删除任何记录本身');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(holder.deletePlanList).toHaveBeenCalledWith('p1');
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

  it('没有任何清单时给出引导提示（指向设置页）', () => {
    holder.plans = [];
    render(<DetailView id={7} />);
    const card = screen.getByTestId('iw-plan-card');
    expect(card.textContent).toContain('还没有计划清单');
    expect(card.textContent).toContain('设置');
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
});
