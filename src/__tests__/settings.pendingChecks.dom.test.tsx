/**
 * v6.1.1 · 设置页「待确认清单」区（界面级验证，jsdom）
 *
 * 行为合同：
 *   1. 设置页数据管理区新增「待确认清单」块，展示当前核对结果与已忽略条数；
 *   2. 已忽略条目逐条列出，标注「仍存在 / 已检测不到」两种状态；
 *   3. 每条「恢复」回调带 key；「全部恢复」一键回调；
 *   4. 无已忽略条目时展示空态提示，恢复按钮禁用。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DEFAULT_SCHEMA } from '../schema';
import type { ConflictEntry } from '../types';

/* 可变 mock 状态：vi.hoisted 保证它在 vi.mock 工厂里可用 */
const holder = vi.hoisted(() => ({
  restoreIgnoredCheck: vi.fn(),
  restoreAllIgnoredChecks: vi.fn(),
  ignoredChecks: [
    { key: '勾选与信息矛盾|电子版尺码|378', 摘要: '#378 矛盾·电子版尺码（晨雾1361单排扣打格棉服）', ignoredAt: '2026-11-04T02:00:00.000Z' },
    { key: '建议补全|纸质版尺码|500', 摘要: '#500 建议补全·纸质版尺码（栗栗MF26拿铁裙）', ignoredAt: '2026-11-04T02:01:00.000Z' },
  ],
}));

vi.mock('../store/store', () => ({
  useApp: () => ({
    records: [],
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
    conflicts: [
      {
        key: '勾选与信息矛盾|电子版尺码|378',
        类型: '勾选与信息矛盾', 字段: '电子版尺码', 记录ID: 378,
        名称: '晨雾1361单排扣打格棉服', 详情: '拥有形态未勾选「电子版」，但电子版尺码=[M]',
      } as ConflictEntry,
    ],
    suggestions: [],
    ignoredChecks: holder.ignoredChecks,
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
      ignoreCheckItem: vi.fn(),
      ignoreAllChecks: vi.fn(),
      restoreIgnoredCheck: holder.restoreIgnoredCheck,
      restoreAllIgnoredChecks: holder.restoreAllIgnoredChecks,
      createPlanList: vi.fn(() => 'p1'),
      renamePlanList: vi.fn(),
      deletePlanList: vi.fn(),
      toggleRecordInPlan: vi.fn(),
    },
  }),
}));

// eslint-disable-next-line import/first
import { SettingsView } from '../features/settings/SettingsView';

const DEFAULT_IGNORED = [
  { key: '勾选与信息矛盾|电子版尺码|378', 摘要: '#378 矛盾·电子版尺码（晨雾1361单排扣打格棉服）', ignoredAt: '2026-11-04T02:00:00.000Z' },
  { key: '建议补全|纸质版尺码|500', 摘要: '#500 建议补全·纸质版尺码（栗栗MF26拿铁裙）', ignoredAt: '2026-11-04T02:01:00.000Z' },
];

beforeEach(() => {
  cleanup();
  holder.restoreIgnoredCheck.mockClear();
  holder.restoreAllIgnoredChecks.mockClear();
  holder.ignoredChecks = DEFAULT_IGNORED;
});

describe('v6.1.1 设置页「待确认清单」区', () => {
  it('展示当前核对结果与已忽略条数', () => {
    render(<SettingsView />);
    const block = document.querySelector('[data-testid="iw-pending-checks-block"]');
    expect(block).not.toBeNull();
    expect(block!.textContent).toContain('1 条矛盾记录');
    expect(block!.textContent).toContain('2 条已被你忽略');
  });

  it('已忽略条目逐条列出并标注当前状态（仍存在 / 已检测不到）', () => {
    render(<SettingsView />);
    const items = screen.getAllByTestId('iw-ignored-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('#378 矛盾·电子版尺码（晨雾1361单排扣打格棉服）');
    expect(items[0].textContent).toContain('仍存在');
    expect(items[1].textContent).toContain('#500 建议补全·纸质版尺码（栗栗MF26拿铁裙）');
    expect(items[1].textContent).toContain('已检测不到');
  });

  it('每条「恢复」回调带对应 key；「全部恢复」一键回调', () => {
    render(<SettingsView />);
    const buttons = screen.getAllByRole('button', { name: '恢复' });
    expect(buttons).toHaveLength(2); // 两条单条「恢复」（「全部恢复」按钮名不同）
    fireEvent.click(buttons[0]);
    expect(holder.restoreIgnoredCheck).toHaveBeenCalledWith('勾选与信息矛盾|电子版尺码|378');
    fireEvent.click(screen.getByRole('button', { name: /全部恢复/ }));
    expect(holder.restoreAllIgnoredChecks).toHaveBeenCalledTimes(1);
  });

  it('无已忽略条目时展示空态提示，恢复按钮禁用', () => {
    holder.ignoredChecks = [];
    render(<SettingsView />);
    const block = document.querySelector('[data-testid="iw-pending-checks-block"]');
    expect(block).not.toBeNull();
    expect(block!.textContent).toContain('没有已忽略的条目');
    expect(screen.queryAllByTestId('iw-ignored-item')).toHaveLength(0);
    const all = screen.getByRole('button', { name: /全部恢复/ }) as HTMLButtonElement;
    expect(all.disabled).toBe(true);
  });
});
