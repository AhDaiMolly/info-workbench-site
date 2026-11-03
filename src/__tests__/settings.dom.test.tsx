/**
 * v6 · 需求 1：设置页底部展示站点版本信息（界面级验证，jsdom）
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { DEFAULT_SCHEMA } from '../schema';
import { BUILD_INFO } from '../version';

vi.mock('../store/store', () => ({
  useApp: () => ({
    records: [],
    schema: DEFAULT_SCHEMA,
    config: null,
    connection: 'idle',
    syncStatus: 'idle',
    syncMessage: '',
    lastSyncedAt: 0,
    pending: [],
    actionLog: [],
    backupIntervalDays: 7,
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
    },
  }),
}));

// eslint-disable-next-line import/first
import { SettingsView } from '../features/settings/SettingsView';

beforeEach(() => {
  cleanup();
});

describe('v6 · 需求 1 设置页版本信息', () => {
  it('底部信息区展示「版本信息」卡片', () => {
    render(<SettingsView />);
    expect(screen.getAllByText('版本信息').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-testid="iw-version-info"]')).not.toBeNull();
  });

  it('版本文本包含当前构建版本号', () => {
    render(<SettingsView />);
    const el = document.querySelector('[data-testid="iw-version-text"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain(BUILD_INFO.version);
  });

  it('同时展示版本号 / 构建日期 / 提交三项字段', () => {
    render(<SettingsView />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('版本号');
    expect(text).toContain('构建日期');
    expect(text).toContain('提交');
  });
});
