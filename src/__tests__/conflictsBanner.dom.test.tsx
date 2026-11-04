/**
 * v6.1.1 · 待确认清单横幅（ConflictsBanner）+ 忽略清单持久化（界面级验证，jsdom）
 *
 * 行为合同：
 *   1. 横幅只显示未被忽略的条目，计数与之一致；
 *   2. 条目上的「忽略」回调带上该条目本身（key 供持久化）；
 *   3. 「全部忽略」一键回调；
 *   4. 全部条目被忽略（或本身没有条目）时横幅不渲染；
 *   5. 忽略清单写入 / 读取浏览器本地存储可往返（iw.ignoredChecks）。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ConflictEntry, SuggestionEntry } from '../types';
import { ConflictsBanner } from '../features/list/ConflictsBanner';
import { readIgnoredChecks, writeIgnoredChecks, STORAGE_KEYS } from '../store/persist';

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

const conflict: ConflictEntry = {
  key: '勾选与信息矛盾|电子版尺码|378',
  类型: '勾选与信息矛盾',
  字段: '电子版尺码',
  记录ID: 378,
  名称: '晨雾1361单排扣打格棉服',
  详情: '拥有形态未勾选「电子版」，但电子版尺码=[M]',
  处理建议: '请人工确认：是勾选漏填，还是尺码为占位信息。系统未自动翻转勾选值。',
};

const conflict2: ConflictEntry = {
  key: '关键字段缺失|名称|795',
  类型: '关键字段缺失',
  字段: '名称',
  记录ID: 795,
  名称: '',
  详情: '名称为空',
};

const suggestion: SuggestionEntry = {
  key: '建议补全|电子版尺码|4',
  类型: '建议补全',
  字段: '电子版尺码',
  记录ID: 4,
  名称: '晨雾1182-1坎肩',
  详情: '拥有形态勾选了「电子版」，但电子版尺码为空',
};

describe('v6.1.1 横幅 · 展示与忽略交互', () => {
  it('显示矛盾与建议补全的真实剩余条数，且提供「忽略」「全部忽略」', () => {
    const onIgnore = vi.fn();
    const onIgnoreAll = vi.fn();
    render(
      <ConflictsBanner
        conflicts={[conflict, conflict2]}
        suggestions={[suggestion]}
        ignoredKeys={[]}
        onIgnore={onIgnore}
        onIgnoreAll={onIgnoreAll}
        onOpenRecord={vi.fn()}
      />,
    );
    expect(screen.getByText(/待人工确认清单：2 条矛盾记录，1 条建议补全/)).toBeTruthy();
    expect(screen.getByText('#378 晨雾1361单排扣打格棉服')).toBeTruthy();
    expect(screen.getByTestId('iw-ignore-all')).toBeTruthy();
  });

  it('条目「忽略」回调携带该条目（key 可持久化）', () => {
    const onIgnore = vi.fn();
    render(
      <ConflictsBanner
        conflicts={[conflict]}
        suggestions={[]}
        ignoredKeys={[]}
        onIgnore={onIgnore}
        onIgnoreAll={vi.fn()}
        onOpenRecord={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId(`iw-ignore-${conflict.key}`));
    expect(onIgnore).toHaveBeenCalledTimes(1);
    expect(onIgnore.mock.calls[0][0]).toMatchObject({ key: conflict.key, 记录ID: 378 });
  });

  it('「全部忽略」按钮触发一键回调', () => {
    const onIgnoreAll = vi.fn();
    render(
      <ConflictsBanner
        conflicts={[conflict]}
        suggestions={[suggestion]}
        ignoredKeys={[]}
        onIgnore={vi.fn()}
        onIgnoreAll={onIgnoreAll}
        onOpenRecord={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('iw-ignore-all'));
    expect(onIgnoreAll).toHaveBeenCalledTimes(1);
  });

  it('被忽略的条目不再出现，计数只算剩余条目', () => {
    render(
      <ConflictsBanner
        conflicts={[conflict, conflict2]}
        suggestions={[suggestion]}
        ignoredKeys={[conflict.key, suggestion.key]}
        onIgnore={vi.fn()}
        onIgnoreAll={vi.fn()}
        onOpenRecord={vi.fn()}
      />,
    );
    expect(screen.getByText(/待人工确认清单：1 条矛盾记录$/)).toBeTruthy();
    expect(screen.queryByText('#378 晨雾1361单排扣打格棉服')).toBeNull();
    expect(screen.queryByText(/建议补全/)).toBeNull();
  });

  it('全部条目被忽略时横幅不渲染（用户处理完不打扰）', () => {
    const { container } = render(
      <ConflictsBanner
        conflicts={[conflict]}
        suggestions={[suggestion]}
        ignoredKeys={[conflict.key, suggestion.key]}
        onIgnore={vi.fn()}
        onIgnoreAll={vi.fn()}
        onOpenRecord={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="iw-conflicts-banner"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('零条目时横幅不渲染', () => {
    const { container } = render(
      <ConflictsBanner
        conflicts={[]}
        suggestions={[]}
        ignoredKeys={[]}
        onIgnore={vi.fn()}
        onIgnoreAll={vi.fn()}
        onOpenRecord={vi.fn()}
      />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('v6.1.1 忽略清单 · 浏览器本地持久化往返', () => {
  it('写入 iw.ignoredChecks 后可原样读回，重启页面后忽略状态仍在', () => {
    const entries = [
      { key: conflict.key, 摘要: '#378 矛盾·电子版尺码（晨雾1361单排扣打格棉服）', ignoredAt: '2026-11-04T02:00:00.000Z' },
      { key: suggestion.key, 摘要: '#4 建议补全·电子版尺码（晨雾1182-1坎肩）', ignoredAt: '2026-11-04T02:01:00.000Z' },
    ];
    writeIgnoredChecks(entries);
    expect(window.localStorage.getItem(STORAGE_KEYS.ignoredChecks)).toBeTruthy();
    expect(readIgnoredChecks()).toEqual(entries);
  });

  it('读取时对脏数据做结构兜底（非数组 / 缺 key 一律丢弃，不白屏）', () => {
    window.localStorage.setItem(STORAGE_KEYS.ignoredChecks, JSON.stringify([{ 摘要: '缺 key' }, 'bad', { key: 'k1', 摘要: '', ignoredAt: '' }]));
    expect(readIgnoredChecks()).toEqual([{ key: 'k1', 摘要: '', ignoredAt: '' }]);
    window.localStorage.setItem(STORAGE_KEYS.ignoredChecks, 'not-json');
    expect(readIgnoredChecks()).toEqual([]);
  });

  it('恢复 = 从清单里移除对应 key，写回本地存储', () => {
    const entries = [
      { key: 'a', 摘要: 'a', ignoredAt: 't1' },
      { key: 'b', 摘要: 'b', ignoredAt: 't2' },
    ];
    writeIgnoredChecks(entries);
    writeIgnoredChecks(entries.filter((e) => e.key !== 'a'));
    expect(readIgnoredChecks().map((e) => e.key)).toEqual(['b']);
  });
});
