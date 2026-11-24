/**
 * v6.7 · 需求 1~7「清单」一级页签（界面级验证，jsdom）
 *
 * 行为合同：
 *   1. 一级导航出现「清单」页签，路由 #/plans 渲染清单总览；
 *   2. 清单以模块形式排列，每两个平铺一行（两列栅格）；
 *   3. 模块内直接列出清单里的记录；
 *   4. 右上角「新增清单」→ 弹层内可搜索 / 按分类、季节筛选并挑选记录 → 创建时带上初始成员；
 *   5. 每个模块右上角「删除」（v6.8 移除「编辑」入口）：删除二次确认且只解除关联；
 *   6. 清单之间可拖拽调整顺序；
 *   7. 清单内记录可拖拽调整顺序。
 *
 * v6.8 增补：
 *   8. 模块无「编辑」入口；清单名后有编辑图标，点击只重命名该清单；
 *   9. 模块内条目可「移出清单」——右键菜单入口，只改成员关系。
 *
 * v6.9 增补：
 *   10. 「新增清单」弹层简化为只填名称（创建为空清单），无搜索 / 筛选 / 挑选内容；
 *   11. 模块右上「＋ 添加记录」入口跳转挑选页（#/plan-add/:id）；
 *   12. 条目右键菜单新增「加入其他清单…」（迁移语义：加入目标并从当前移出）；
 *   13. v6.9.1：条目常显「移出」按钮已删除；移出统一走右键菜单「移出清单」（v6.8 悬停「×」按钮亦不存在）。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DEFAULT_SCHEMA } from '../schema';
import type { PlanItem, RecordItem } from '../types';

const holder = vi.hoisted(() => ({
  createPlanList: vi.fn(() => 'p9'),
  renamePlanList: vi.fn(),
  deletePlanList: vi.fn(),
  toggleRecordInPlan: vi.fn(),
  reorderPlanList: vi.fn(),
  reorderPlanMembers: vi.fn(),
  addRecordsToPlan: vi.fn(),
  moveRecordToPlan: vi.fn(),
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

function plan(id: string, name: string, members: number[] = []): PlanItem {
  return {
    id, 名称: name, 记录ID列表: members,
    创建时间: '2026-11-01T00:00:00.000Z', 更新时间: '2026-11-01T00:00:00.000Z',
  };
}

vi.mock('../store/store', () => ({
  useApp: () => ({
    records,
    plans: holder.plans,
    schema: DEFAULT_SCHEMA,
    config: null,
    connection: 'idle',
    syncStatus: 'idle',
    syncMessage: '',
    lastSyncedAt: 0,
    pending: [],
    optionCandidates: {},
    options: {},
    actionLog: [],
    backupIntervalDays: 7,
    filters: {},
    query: '',
    sort: { key: '名称', dir: 'asc' },
    actions: {
      createPlanList: holder.createPlanList,
      renamePlanList: holder.renamePlanList,
      deletePlanList: holder.deletePlanList,
      toggleRecordInPlan: holder.toggleRecordInPlan,
      reorderPlanList: holder.reorderPlanList,
      reorderPlanMembers: holder.reorderPlanMembers,
      addRecordsToPlan: holder.addRecordsToPlan,
      moveRecordToPlan: holder.moveRecordToPlan,
      removeFieldOption: vi.fn(),
      restoreFieldOption: vi.fn(),
    },
  }),
}));

vi.mock('../router', () => ({
  navigate: holder.navigateMock,
}));

// eslint-disable-next-line import/first
import { PlansBoardView } from '../features/plan/PlansBoardView';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  holder.plans = [plan('p1', '2026 春季', [1, 2]), plan('p2', '给宝宝做的', [3])];
});

describe('v6.7 · 清单总览页布局', () => {
  it('每个清单渲染成一个模块，标题、条数与成员记录都在模块里', () => {
    render(<PlansBoardView />);
    expect(screen.getByTestId('iw-plans-grid')).toBeTruthy();
    expect(screen.getByTestId('iw-plan-card-p1')).toBeTruthy();
    expect(screen.getByTestId('iw-plan-card-p2')).toBeTruthy();
    expect(screen.getByTestId('iw-plan-card-title-p1').textContent).toContain('2026 春季');
    // 模块内直接列出清单里的记录
    expect(screen.getByTestId('iw-plan-card-row-p1-1').textContent).toContain('棉麻衬衫');
    expect(screen.getByTestId('iw-plan-card-row-p1-2').textContent).toContain('百褶裙');
    expect(screen.queryByTestId('iw-plan-card-row-p2-1')).toBeNull();
  });

  it('两个清单平铺一行：栅格为两列', () => {
    render(<PlansBoardView />);
    const grid = screen.getByTestId('iw-plans-grid');
    expect(grid.className).toContain('iw-plans-grid');
    // 样式表里 .iw-plans-grid 定义了 grid-template-columns: repeat(2, minmax(0,1fr))
    expect(grid.className).toBe('iw-plans-grid');
  });

  it('没有任何清单时给出引导空态', () => {
    holder.plans = [];
    render(<PlansBoardView />);
    expect(screen.getByTestId('iw-plans-empty').textContent).toContain('新增清单');
  });

  it('空清单模块显示占位提示', () => {
    holder.plans = [plan('p1', '空清单')];
    render(<PlansBoardView />);
    expect(screen.getByTestId('iw-plan-card-empty-p1')).toBeTruthy();
  });
});

describe('新增清单（v6.9：只需名称，创建为空清单）', () => {
  it('填名称 → 创建时只带名称一个参数（空清单），不再传初始成员', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plans-new'));

    fireEvent.change(screen.getByTestId('iw-new-plan-name'), { target: { value: '  2026 夏季  ' } });
    fireEvent.click(screen.getByRole('button', { name: '创建清单' }));
    expect(holder.createPlanList).toHaveBeenCalledWith('2026 夏季');
    expect(holder.createPlanList).toHaveBeenCalledTimes(1);
  });

  it('弹层里没有搜索框 / 筛选 chips / 候选挑选列表（v6.9 移除挑选流程）', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plans-new'));
    expect(screen.queryByTestId('iw-new-plan-search')).toBeNull();
    expect(screen.queryAllByTestId(/^iw-new-plan-pick-/)).toEqual([]);
    expect(screen.queryAllByTestId(/^iw-new-plan-cat-/)).toEqual([]);
    expect(screen.queryAllByTestId(/^iw-new-plan-season-/)).toEqual([]);
    expect(screen.queryAllByTestId(/^iw-new-plan-brand-/)).toEqual([]);
    expect(screen.queryAllByTestId(/^iw-new-plan-style-/)).toEqual([]);
    expect(screen.queryAllByTestId(/^iw-new-plan-own-/)).toEqual([]);
    // 弹层文案明确「空清单」与后续入口
    expect(screen.getByRole('dialog').textContent).toContain('空清单');
    expect(screen.getByRole('dialog').textContent).toContain('＋ 添加记录');
  });

  it('名称为空不创建；取消弹层不创建', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plans-new'));
    fireEvent.change(screen.getByTestId('iw-new-plan-name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '创建清单' }));
    expect(holder.createPlanList).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(holder.createPlanList).not.toHaveBeenCalled();
  });
});

describe('v6.7 · 模块右上角的删除（v6.8 移除「编辑」入口）', () => {
  it('模块没有「编辑」入口（iw-plan-edit-* 不渲染）', () => {
    render(<PlansBoardView />);
    expect(screen.queryByTestId('iw-plan-edit-p1')).toBeNull();
    expect(screen.queryByTestId('iw-plan-edit-p2')).toBeNull();
    expect(document.body.textContent ?? '').not.toContain('编辑');
  });

  it('点「删除」弹二次确认，文案说明只解除关联；确认后回调 deletePlanList', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plan-delete-p1'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('只解除记录关联');
    expect(dialog.textContent).toContain('不会被删除或修改');
    fireEvent.click(screen.getByRole('button', { name: '删除清单' }));
    expect(holder.deletePlanList).toHaveBeenCalledWith('p1');
  });

  it('删除弹层取消 → 不删除', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plan-delete-p2'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(holder.deletePlanList).not.toHaveBeenCalled();
  });
});

describe('v6.7 · 拖拽排序', () => {
  it('拖拽清单模块 → 回调 reorderPlanList（新的 id 顺序）', () => {
    render(<PlansBoardView />);
    const handle = screen.getByTestId('iw-plan-drag-p1');
    const target = screen.getByTestId('iw-plan-card-body-p2');
    fireEvent.dragStart(handle);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    expect(holder.reorderPlanList).toHaveBeenCalledWith(['p2', 'p1']);
  });

  it('拖拽清单内记录 → 回调 reorderPlanMembers（新的记录顺序）', () => {
    render(<PlansBoardView />);
    const from = screen.getByTestId('iw-plan-member-drag-p1-1');
    const to = screen.getByTestId('iw-plan-card-row-p1-2');
    fireEvent.dragStart(from);
    fireEvent.dragOver(to);
    fireEvent.drop(to);
    expect(holder.reorderPlanMembers).toHaveBeenCalledWith('p1', [2, 1]);
  });

  it('拖到自身不触发回调', () => {
    render(<PlansBoardView />);
    const handle = screen.getByTestId('iw-plan-member-drag-p1-1');
    const row = screen.getByTestId('iw-plan-card-row-p1-1');
    fireEvent.dragStart(handle);
    fireEvent.dragOver(row);
    fireEvent.drop(row);
    expect(holder.reorderPlanMembers).not.toHaveBeenCalled();
  });
});

describe('v6.8 · 清单名后的编辑图标（只重命名）', () => {
  it('清单名后渲染编辑图标，点击弹重命名弹层，保存回调 renamePlanList', () => {
    render(<PlansBoardView />);
    const icon = screen.getByTestId('iw-plan-card-rename-p1');
    expect(icon.getAttribute('aria-label')).toBe('重命名清单：2026 春季');
    fireEvent.click(icon);
    const input = screen.getByTestId('iw-plan-card-rename-input') as HTMLInputElement;
    expect(input.value).toBe('2026 春季');
    fireEvent.change(input, { target: { value: ' 2026 春夏 ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(holder.renamePlanList).toHaveBeenCalledWith('p1', '2026 春夏');
  });

  it('重命名弹层取消 → 不改名称', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plan-card-rename-p1'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(holder.renamePlanList).not.toHaveBeenCalled();
  });
});

describe('v6.8/v6.9 · 条目移出清单（右键菜单为唯一入口）', () => {
  it('条目右键 → 弹出菜单含「移出清单」与「加入其他清单…」；点移出回调 toggleRecordInPlan 且不跳详情页', () => {
    render(<PlansBoardView />);
    const row = screen.getByTestId('iw-plan-card-row-p1-1');
    fireEvent.contextMenu(row);
    expect(screen.getByTestId('iw-plan-ctx-menu')).toBeTruthy();
    expect(screen.getByTestId('iw-plan-ctx-remove').textContent).toBe('移出清单');
    expect(screen.getByTestId('iw-plan-ctx-move').textContent).toBe('加入其他清单…');
    fireEvent.click(screen.getByTestId('iw-plan-ctx-remove'));
    expect(holder.toggleRecordInPlan).toHaveBeenCalledWith('p1', 1);
    expect(holder.navigateMock).not.toHaveBeenCalled();
  });

  it('右键菜单点遮罩关闭，不触发移出', () => {
    render(<PlansBoardView />);
    fireEvent.contextMenu(screen.getByTestId('iw-plan-card-row-p1-1'));
    fireEvent.click(screen.getByTestId('iw-plan-ctx-overlay'));
    expect(screen.queryByTestId('iw-plan-ctx-menu')).toBeNull();
    expect(holder.toggleRecordInPlan).not.toHaveBeenCalled();
  });

  it('v6.9.1：条目上无常显「移出」按钮；右键「移出清单」可用，回调 toggleRecordInPlan 且不触发跳详情', () => {
    render(<PlansBoardView />);
    // 常显「移出」按钮已删除（v6.9.1）：任何成员条目上都不渲染
    expect(screen.queryByTestId('iw-plan-member-remove-p1-1')).toBeNull();
    expect(screen.queryByTestId('iw-plan-member-remove-p1-2')).toBeNull();
    expect(screen.queryByTestId('iw-plan-member-remove-p2-3')).toBeNull();
    // 移出能力统一走右键菜单
    fireEvent.contextMenu(screen.getByTestId('iw-plan-card-row-p1-2'));
    expect(screen.getByTestId('iw-plan-ctx-remove').textContent).toBe('移出清单');
    fireEvent.click(screen.getByTestId('iw-plan-ctx-remove'));
    expect(holder.toggleRecordInPlan).toHaveBeenCalledWith('p1', 2);
    expect(holder.navigateMock).not.toHaveBeenCalled();
  });

  it('v6.9：v6.8 的悬停「×」按钮已删除（iw-plan-card-remove-* 不再渲染）', () => {
    render(<PlansBoardView />);
    expect(screen.queryByTestId('iw-plan-card-remove-p1-1')).toBeNull();
    expect(screen.queryByTestId('iw-plan-card-remove-p1-2')).toBeNull();
    expect(screen.queryByTestId('iw-plan-card-remove-p2-3')).toBeNull();
  });
});

describe('v6.9 · 条目「加入其他清单」（迁移语义）', () => {
  it('右键 →「加入其他清单…」弹层：文案写明「加入目标并从当前移出」，候选排除已在清单', () => {
    render(<PlansBoardView />);
    fireEvent.contextMenu(screen.getByTestId('iw-plan-card-row-p1-1'));
    fireEvent.click(screen.getByTestId('iw-plan-ctx-move'));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('加入目标清单，并同时从当前清单移出');
    expect(dialog.textContent).toContain('不会被删除或修改');
    // 记录 1 已在 p1 → 候选只剩 p2；p1 不出现在选项里
    expect(screen.getByTestId('iw-plan-move-option-p2')).toBeTruthy();
    expect(screen.queryByTestId('iw-plan-move-option-p1')).toBeNull();
  });

  it('点目标清单选项 → 回调 moveRecordToPlan(当前清单, 目标清单, 记录)，弹层关闭', () => {
    render(<PlansBoardView />);
    fireEvent.contextMenu(screen.getByTestId('iw-plan-card-row-p1-1'));
    fireEvent.click(screen.getByTestId('iw-plan-ctx-move'));
    fireEvent.click(screen.getByTestId('iw-plan-move-option-p2'));
    expect(holder.moveRecordToPlan).toHaveBeenCalledWith('p1', 'p2', 1);
    expect(holder.toggleRecordInPlan).not.toHaveBeenCalled();
    expect(screen.queryByTestId('iw-plan-move-option-p2')).toBeNull();
  });

  it('关闭弹层不迁移', () => {
    render(<PlansBoardView />);
    fireEvent.contextMenu(screen.getByTestId('iw-plan-card-row-p1-1'));
    fireEvent.click(screen.getByTestId('iw-plan-ctx-move'));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(holder.moveRecordToPlan).not.toHaveBeenCalled();
  });
});

describe('v6.9 · 模块「＋ 添加记录」入口', () => {
  it('每个模块右上渲染「＋ 添加记录」按钮，点击跳转挑选页路由', () => {
    render(<PlansBoardView />);
    const add1 = screen.getByTestId('iw-plan-card-add-p1');
    expect(add1.textContent).toBe('＋ 添加记录');
    fireEvent.click(add1);
    expect(holder.navigateMock).toHaveBeenCalledWith({ view: 'plan-add', planId: 'p1' });
    fireEvent.click(screen.getByTestId('iw-plan-card-add-p2'));
    expect(holder.navigateMock).toHaveBeenCalledWith({ view: 'plan-add', planId: 'p2' });
  });
});
