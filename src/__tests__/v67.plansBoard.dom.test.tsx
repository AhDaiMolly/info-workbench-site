/**
 * v6.7 · 需求 1~7「清单」一级页签（界面级验证，jsdom）
 *
 * 行为合同：
 *   1. 一级导航出现「清单」页签，路由 #/plans 渲染清单总览；
 *   2. 清单以模块形式排列，每两个平铺一行（两列栅格）；
 *   3. 模块内直接列出清单里的记录；
 *   4. 右上角「新增清单」→ 弹层内可搜索 / 按分类、季节筛选并挑选记录 → 创建时带上初始成员；
 *   5. 每个模块右上角「编辑」「删除」：编辑进清单管理页，删除二次确认且只解除关联；
 *   6. 清单之间可拖拽调整顺序；
 *   7. 清单内记录可拖拽调整顺序。
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

describe('v6.7 · 新增清单（弹层内筛选并挑选记录）', () => {
  it('填名称 + 搜索筛选 + 勾选记录 → 创建时带上初始成员', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plans-new'));

    fireEvent.change(screen.getByTestId('iw-new-plan-name'), { target: { value: '  2026 夏季  ' } });
    // 搜索：命中名称
    fireEvent.change(screen.getByTestId('iw-new-plan-search'), { target: { value: '裙' } });
    expect(screen.getByTestId('iw-new-plan-pick-2')).toBeTruthy();
    expect(screen.queryByTestId('iw-new-plan-pick-1')).toBeNull();

    fireEvent.click(screen.getByTestId('iw-new-plan-pick-2'));
    fireEvent.click(screen.getByRole('button', { name: '创建清单' }));
    expect(holder.createPlanList).toHaveBeenCalledWith('2026 夏季', [2]);
  });

  it('按分类筛选：点分类 chip 后候选只剩该分类', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plans-new'));
    fireEvent.click(screen.getByTestId('iw-new-plan-cat-上衣'));
    expect(screen.getByTestId('iw-new-plan-pick-1')).toBeTruthy();
    expect(screen.queryByTestId('iw-new-plan-pick-3')).toBeNull();
  });

  it('按季节筛选：点季节 chip 后候选只剩该季节', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plans-new'));
    fireEvent.click(screen.getByTestId('iw-new-plan-season-夏'));
    expect(screen.getByTestId('iw-new-plan-pick-2')).toBeTruthy();
    expect(screen.queryByTestId('iw-new-plan-pick-1')).toBeNull();
  });

  it('按品牌筛选：点品牌 chip 后候选只剩该品牌', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plans-new'));
    fireEvent.click(screen.getByTestId('iw-new-plan-brand-品牌乙'));
    expect(screen.getByTestId('iw-new-plan-pick-3')).toBeTruthy();
    expect(screen.queryByTestId('iw-new-plan-pick-1')).toBeNull();
    // 再点一次取消选中 → 候选恢复
    fireEvent.click(screen.getByTestId('iw-new-plan-brand-品牌乙'));
    expect(screen.getByTestId('iw-new-plan-pick-1')).toBeTruthy();
  });

  it('按款式筛选：点款式 chip 后候选只剩该款式', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plans-new'));
    fireEvent.click(screen.getByTestId('iw-new-plan-style-裙装'));
    expect(screen.getByTestId('iw-new-plan-pick-2')).toBeTruthy();
    expect(screen.queryByTestId('iw-new-plan-pick-1')).toBeNull();
  });

  it('按拥有形态筛选：纸质版只留同时有纸质版的记录，任意拥有恢复全部', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plans-new'));
    fireEvent.click(screen.getByTestId('iw-new-plan-own-纸质版'));
    expect(screen.getByTestId('iw-new-plan-pick-2')).toBeTruthy();
    expect(screen.queryByTestId('iw-new-plan-pick-1')).toBeNull();
    fireEvent.click(screen.getByTestId('iw-new-plan-own-纸质版'));
    fireEvent.click(screen.getByTestId('iw-new-plan-own-任意拥有'));
    // 三条记录都有拥有形态 → 全部回到候选里
    expect(screen.getByTestId('iw-new-plan-pick-1')).toBeTruthy();
    expect(screen.getByTestId('iw-new-plan-pick-3')).toBeTruthy();
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

describe('v6.7 · 模块右上角的编辑 / 删除', () => {
  it('点「编辑」跳到该清单的管理页', () => {
    render(<PlansBoardView />);
    fireEvent.click(screen.getByTestId('iw-plan-edit-p1'));
    expect(holder.navigateMock).toHaveBeenCalledWith(expect.objectContaining({ view: 'plan', planId: 'p1' }));
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
    const from = screen.getByTestId('iw-plan-card-row-p1-1');
    const to = screen.getByTestId('iw-plan-card-row-p1-2');
    fireEvent.dragStart(from);
    fireEvent.dragOver(to);
    fireEvent.drop(to);
    expect(holder.reorderPlanMembers).toHaveBeenCalledWith('p1', [2, 1]);
  });

  it('拖到自身不触发回调', () => {
    render(<PlansBoardView />);
    const row = screen.getByTestId('iw-plan-card-row-p1-1');
    fireEvent.dragStart(row);
    fireEvent.dragOver(row);
    fireEvent.drop(row);
    expect(holder.reorderPlanMembers).not.toHaveBeenCalled();
  });
});
