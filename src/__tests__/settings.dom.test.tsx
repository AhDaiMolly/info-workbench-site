/**
 * v6 · 需求 1：设置页底部展示站点版本信息（界面级验证，jsdom）
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import { DEFAULT_SCHEMA } from '../schema';
import { BUILD_INFO } from '../version';

// v6.3（需求 2）：字段选项管理卡片需要的可变状态与动作
const { stateHolder, removeFieldOptionMock, restoreFieldOptionMock } = vi.hoisted(() => ({
  stateHolder: {
    records: [] as Array<Record<string, unknown>>,
    optionCandidates: {} as Record<string, string[]>,
    options: {} as Record<string, { added: string[]; removed: string[] }>,
  },
  removeFieldOptionMock: vi.fn(),
  restoreFieldOptionMock: vi.fn(),
}));

vi.mock('../store/store', () => ({
  useApp: () => ({
    records: stateHolder.records,
    plans: [],
    schema: DEFAULT_SCHEMA,
    config: null,
    connection: 'idle',
    syncStatus: 'idle',
    syncMessage: '',
    lastSyncedAt: 0,
    pending: [],
    actionLog: [],
    backupIntervalDays: 7,
    // v6.3（需求 2）：字段选项管理卡片依赖
    optionCandidates: stateHolder.optionCandidates,
    options: stateHolder.options,
    actions: {
      saveConfig: vi.fn(),
      testConnection: vi.fn(),
      clearConfigAction: vi.fn(),
      syncNow: vi.fn(),
      pull: vi.fn(),
      exportJson: vi.fn(),
      exportXlsx: vi.fn(),
      cleanupShellRecords: vi.fn(),
      setBackupInterval: vi.fn(),
      createPlanList: vi.fn(() => 'p1'),
      renamePlanList: vi.fn(),
      deletePlanList: vi.fn(),
      toggleRecordInPlan: vi.fn(),
      removeFieldOption: removeFieldOptionMock,
      restoreFieldOption: restoreFieldOptionMock,
    },
  }),
}));

// eslint-disable-next-line import/first
import { SettingsView } from '../features/settings/SettingsView';

/** v6.4（需求 2）：点二级导航切到指定分组（只渲染该分组的卡片） */
const openSettingsGroup = (id: string) => {
  const btn = document.querySelector(`[data-testid="iw-settings-nav-${id}"]`) as HTMLButtonElement | null;
  expect(btn).not.toBeNull();
  fireEvent.click(btn!);
};

beforeEach(() => {
  cleanup();
  stateHolder.records = [];
  stateHolder.optionCandidates = {};
  stateHolder.options = {};
  removeFieldOptionMock.mockClear();
  restoreFieldOptionMock.mockClear();
});

describe('v6 · 需求 1 设置页版本信息（v6.4 起在「版本信息」分组下）', () => {
  it('点导航「版本信息」后展示版本信息卡片', () => {
    render(<SettingsView />);
    openSettingsGroup('version');
    expect(document.querySelector('[data-testid="iw-version-info"]')).not.toBeNull();
  });

  it('版本文本包含当前构建版本号', () => {
    render(<SettingsView />);
    openSettingsGroup('version');
    const el = document.querySelector('[data-testid="iw-version-text"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain(BUILD_INFO.version);
  });

  it('同时展示版本号 / 构建日期 / 提交三项字段', () => {
    render(<SettingsView />);
    openSettingsGroup('version');
    const text = document.body.textContent ?? '';
    expect(text).toContain('版本号');
    expect(text).toContain('构建日期');
    expect(text).toContain('提交');
  });
});

describe('v6.4 · 需求 2 设置页二级导航（分组菜单）', () => {
  it('渲染 5 个分组导航：连接与同步 / 数据管理 / 计划清单 / 字段选项 / 版本信息', () => {
    render(<SettingsView />);
    const labels = Array.from(document.querySelectorAll('[data-testid^="iw-settings-nav-"]'))
      .map((el) => el.textContent);
    expect(labels).toEqual(['连接与同步', '数据管理', '计划清单', '字段选项', '版本信息']);
  });

  it('默认分组为「连接与同步」：展示数据仓库连接与同步和备份，其它分组卡片不渲染', () => {
    const { container } = render(<SettingsView />);
    expect(container.textContent).toContain('数据仓库连接');
    expect(container.textContent).toContain('同步和备份');
    expect(container.textContent).not.toContain('导出全部 JSON');
    expect(container.textContent).not.toContain('字段选项管理');
    expect(container.textContent).not.toContain('版本号');
  });

  it('每个分组点开后可达且互斥：数据管理 / 计划清单 / 字段选项 / 版本信息', () => {
    const { container } = render(<SettingsView />);

    openSettingsGroup('data');
    expect(container.textContent).toContain('导出全部 JSON');
    expect(container.textContent).not.toContain('数据仓库连接');

    openSettingsGroup('plans');
    expect(container.textContent).toContain('新建清单');
    expect(container.textContent).not.toContain('导出全部 JSON');

    openSettingsGroup('options');
    expect(container.textContent).toContain('字段选项管理');
    expect(container.textContent).not.toContain('新建清单');

    openSettingsGroup('version');
    expect(container.textContent).toContain('版本号');
    expect(container.textContent).not.toContain('字段选项管理');

    openSettingsGroup('connection');
    expect(container.textContent).toContain('数据仓库连接');
    expect(container.textContent).not.toContain('版本号');
  });
});

describe('v6.3 · 需求 2：设置页「字段选项管理」', () => {
  it('列出候选与在用记录数；已删候选可恢复；在用值删除时给出提示但仍允许删除', () => {
    stateHolder.records = [{ id: 1, 品牌: '晨雾' }];
    stateHolder.optionCandidates = { 品牌: ['晨雾', '新牌子'] };
    stateHolder.options = { 品牌: { added: ['新牌子'], removed: ['旧牌子'] } };

    render(<SettingsView />);
    openSettingsGroup('options');

    expect(document.querySelector('[data-testid="iw-options-admin"]')).not.toBeNull();
    // 每个候选展示「在用记录数」
    expect(document.body.textContent).toContain('（1 条记录在用）');
    expect(document.body.textContent).toContain('新牌子');
    // 已删除候选的恢复入口
    fireEvent.click(screen.getByLabelText('恢复选项：旧牌子'));
    expect(restoreFieldOptionMock).toHaveBeenCalledWith('品牌', '旧牌子');

    // 删除正在使用的候选：弹确认 + 在用提示，确认后执行删除
    fireEvent.click(screen.getAllByLabelText('删除选项：晨雾')[0]);
    const dialog = screen.getByRole('dialog', { name: '删除字段选项' });
    expect(dialog.textContent).toContain('当前有 1 条记录正在使用这个值');
    expect(dialog.textContent).toContain('历史记录仍保留原值');
    fireEvent.click(within(dialog).getByText('删除'));
    expect(removeFieldOptionMock).toHaveBeenCalledWith('品牌', '晨雾');
  });

  it('没有候选时给出引导文案', () => {
    stateHolder.optionCandidates = {};
    render(<SettingsView />);
    openSettingsGroup('options');
    expect(document.body.textContent).toContain('暂无候选选项');
  });
});
