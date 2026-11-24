/**
 * v6.9.2 · 拖拽修复（界面级验证，jsdom）
 *
 * 行为合同：
 *   1. 拖拽只从明确手柄发起：模块手柄（iw-plan-drag-*）与条目手柄
 *      （iw-plan-member-drag-*）带 draggable；模块卡、模块标题、条目行、
 *      条目名 / 品牌等文本元素一律不带 draggable；
 *   2. 视图根节点捕获 dragstart：非手柄（含文本选择）发起的拖拽被
 *      preventDefault 取消，杜绝浏览器把选中文字当负载弹出「搜索文本」；
 *      手柄发起的拖拽不被拦截；
 *   3. 模块整卡（含头部）都是落点：拖模块手柄放到目标卡的头部也回调
 *      reorderPlanList；
 *   4. 条目拖拽从行手柄发起 → drop 到目标行回调 reorderPlanMembers。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DEFAULT_SCHEMA } from '../schema';
import type { PlanItem, RecordItem } from '../types';

const holder = vi.hoisted(() => ({
  reorderPlanList: vi.fn(),
  reorderPlanMembers: vi.fn(),
  plans: [] as PlanItem[],
}));

function mkRecord(id: number, name: string): RecordItem {
  return {
    id, 名称: name, 品牌: '品牌甲',
    创建时间: '2026-01-01T00:00:00.000Z', 更新时间: '2026-01-02T00:00:00.000Z',
  } as unknown as RecordItem;
}

const records: RecordItem[] = [
  mkRecord(1, '棉麻衬衫'),
  mkRecord(2, '百褶裙'),
  mkRecord(3, '风衣'),
];

function plan(id: string, name: string, members: number[]): PlanItem {
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
      reorderPlanList: holder.reorderPlanList,
      reorderPlanMembers: holder.reorderPlanMembers,
    },
  }),
}));

vi.mock('../router', () => ({
  navigate: vi.fn(),
}));

// eslint-disable-next-line import/first
import { PlansBoardView } from '../features/plan/PlansBoardView';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  holder.plans = [plan('p1', '2026 春季', [1, 2]), plan('p2', '给宝宝做的', [3])];
});

describe('v6.9.2 · 拖拽只绑在明确手柄上', () => {
  it('模块手柄与条目手柄带 draggable；模块卡 / 模块标题 / 条目行不带 draggable', () => {
    render(<PlansBoardView />);
    expect(screen.getByTestId('iw-plan-drag-p1').getAttribute('draggable')).toBe('true');
    expect(screen.getByTestId('iw-plan-member-drag-p1-1').getAttribute('draggable')).toBe('true');
    expect(screen.getByTestId('iw-plan-member-drag-p1-2').getAttribute('draggable')).toBe('true');
    expect(screen.getByTestId('iw-plan-card-p1').getAttribute('draggable')).toBeNull();
    expect(screen.getByTestId('iw-plan-card-title-p1').getAttribute('draggable')).toBeNull();
    expect(screen.getByTestId('iw-plan-card-row-p1-1').getAttribute('draggable')).toBeNull();
    expect(screen.getByTestId('iw-plan-card-body-p1').getAttribute('draggable')).toBeNull();
  });

  it('手柄内文本不被选中干扰：两个手柄都有 user-select:none 的类名', () => {
    render(<PlansBoardView />);
    expect(screen.getByTestId('iw-plan-drag-p1').className).toContain('iw-plan-handle');
    expect(screen.getByTestId('iw-plan-member-drag-p1-1').className).toContain('iw-plan-member-handle');
  });
});

describe('v6.9.2 · 非手柄文本发起的拖拽被取消（防「搜索文本」弹页）', () => {
  it('模块标题上发起 dragstart → 事件被 preventDefault 取消', () => {
    render(<PlansBoardView />);
    const prevented: boolean[] = [];
    document.addEventListener('dragstart', (e) => {
      prevented.push(e.defaultPrevented);
    });
    fireEvent.dragStart(screen.getByTestId('iw-plan-card-title-p1'));
    expect(prevented).toEqual([true]);
  });

  it('条目名文本上发起 dragstart → 事件被 preventDefault 取消', () => {
    render(<PlansBoardView />);
    const prevented: boolean[] = [];
    document.addEventListener('dragstart', (e) => {
      prevented.push(e.defaultPrevented);
    });
    // row 的第 2 个子元素是编号/名称文本 span（第 1 个是行手柄）
    const idSpan = screen.getByTestId('iw-plan-card-row-p1-1').children[1] as Element;
    fireEvent.dragStart(idSpan);
    expect(prevented).toEqual([true]);
  });

  it('模块手柄 / 条目手柄发起 dragstart → 不被拦截（可正常拖拽）', () => {
    render(<PlansBoardView />);
    const prevented: boolean[] = [];
    document.addEventListener('dragstart', (e) => {
      prevented.push(e.defaultPrevented);
    });
    fireEvent.dragStart(screen.getByTestId('iw-plan-drag-p1'));
    fireEvent.dragStart(screen.getByTestId('iw-plan-member-drag-p1-1'));
    expect(prevented).toEqual([false, false]);
  });
});

describe('v6.9.2 · 拖拽落点与回调', () => {
  it('拖模块手柄放到目标卡头部（整卡落点）→ 回调 reorderPlanList', () => {
    render(<PlansBoardView />);
    const handle = screen.getByTestId('iw-plan-drag-p1');
    const targetCard = screen.getByTestId('iw-plan-card-p2');
    fireEvent.dragStart(handle);
    fireEvent.dragOver(targetCard);
    fireEvent.drop(targetCard);
    expect(holder.reorderPlanList).toHaveBeenCalledWith(['p2', 'p1']);
  });

  it('拖条目手柄放到目标行 → 回调 reorderPlanMembers', () => {
    render(<PlansBoardView />);
    fireEvent.dragStart(screen.getByTestId('iw-plan-member-drag-p1-1'));
    fireEvent.dragOver(screen.getByTestId('iw-plan-card-row-p1-2'));
    fireEvent.drop(screen.getByTestId('iw-plan-card-row-p1-2'));
    expect(holder.reorderPlanMembers).toHaveBeenCalledWith('p1', [2, 1]);
  });
});
