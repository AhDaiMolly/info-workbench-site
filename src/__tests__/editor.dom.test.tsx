/**
 * v5 需求 R4 / R5 的界面级验证（jsdom）：
 *   · 新增/编辑表单与记录详情页都按五分区排版
 *   · 季节是下拉单选，选项 夏 / 春秋 / 冬（「春秋」不拆分）
 *   · v5（R5）：「电子版」「纸质版」两个下拉合并为单个多选「拥有形态」（0–2 项）
 *   · v5（R4）：「纸质版尺码」提供字母码 / 身高码快捷标签，点选即填、仍可自由补充
 *   · 已删除字段（关联 / 电子版缺码）不再出现在界面上
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DEFAULT_SCHEMA } from '../schema';
import type { RecordItem } from '../types';

// vi.hoisted：mock 工厂在模块导入阶段就会执行，常量必须提前初始化
const { navigateMock, updateRecordMock, addRecordMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  updateRecordMock: vi.fn(),
  addRecordMock: vi.fn(() => 99),
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
  电子版尺码组: [],
  纸质版尺码: [],
  推荐: '未评价',
  做过: false,
  想做: '未标记',
  备注: '占位备注',
  创建时间: '2026-01-01T00:00:00.000Z',
  更新时间: '2026-01-02T00:00:00.000Z',
} as RecordItem;

let records: RecordItem[] = [];

vi.mock('../store/store', () => ({
  useApp: () => ({
    records,
    schema: DEFAULT_SCHEMA,
    filters: {
      品牌: [], 分类: [], 款式: [], 季节: [], 教程: [], 推荐: [], 想做: [],
      电子版尺码组: [], 拥有形态: [], 做过: undefined,
    },
    query: '',
    sort: { key: '更新时间', dir: 'desc' },
    pending: [],
    actions: {
      addRecord: addRecordMock,
      updateRecord: updateRecordMock,
    },
  }),
}));

vi.mock('../router', () => ({
  navigate: navigateMock,
}));

// eslint-disable-next-line import/first
import { EditorForm } from '../features/editor/EditorForm';
// eslint-disable-next-line import/first
import { DetailView } from '../features/detail/DetailView';

const SECTION_TITLES = ['基础信息', '拥有形态', '状态及评价', '备注', '系统信息'];

beforeEach(() => {
  cleanup();
  records = [sampleRecord];
  navigateMock.mockClear();
  updateRecordMock.mockClear();
  addRecordMock.mockClear();
});

describe('编辑表单：五分区版面', () => {
  it('按 基础信息 / 拥有形态 / 状态及评价 / 备注 / 系统信息 五个分区渲染', () => {
    render(<EditorForm recordId={7} />);
    const titles = Array.from(document.querySelectorAll('.iw-detail-group-title')).map((el) => el.textContent);
    expect(titles).toEqual(SECTION_TITLES);
  });

  it('分区标题用 section 容器承载，便于详情页与表单页对齐', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const sections = container.querySelectorAll('.iw-form-section');
    expect(sections.length).toBe(SECTION_TITLES.length);
  });

  it('系统信息分区只读展示记录ID与时间，不提供可编辑控件', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const sysSection = container.querySelectorAll('.iw-form-section')[4];
    expect(sysSection.textContent).toContain('记录ID');
    expect(sysSection.textContent).toContain('2026-01-01');
    expect(sysSection.querySelectorAll('input, select, textarea').length).toBe(0);
  });

  it('已删除字段（关联 / 电子版缺码）不再出现在表单里', () => {
    const { container } = render(<EditorForm recordId={7} />);
    expect(container.textContent).not.toContain('电子版缺码');
    expect(container.textContent).not.toContain('关联');
  });
});

describe('编辑表单：下拉单选', () => {
  it('季节为下拉单选，选项为 夏 / 春秋 / 冬（含「春秋」独立项）', () => {
    render(<EditorForm recordId={7} />);
    const select = screen.getByLabelText('季节') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['', '夏', '春秋', '冬']);
  });

  it('季节当前值取自记录', () => {
    render(<EditorForm recordId={7} />);
    expect((screen.getByLabelText('季节') as HTMLSelectElement).value).toBe('春秋');
  });

  it('选择单选值后状态更新（单选交互）', () => {
    render(<EditorForm recordId={7} />);
    const select = screen.getByLabelText('季节') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '冬' } });
    expect((screen.getByLabelText('季节') as HTMLSelectElement).value).toBe('冬');
  });
});

describe('v5 · R5 拥有形态多选', () => {
  it('「拥有形态」渲染为多选组（不是下拉单选），选项为 电子版 / 纸质版', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const group = container.querySelector('[role="group"][aria-label="拥有形态"]');
    expect(group).not.toBeNull();
    const labels = Array.from(group!.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['电子版', '纸质版']);
    expect(container.querySelector('select[aria-label="拥有形态"]')).toBeNull();
    expect(container.querySelector('select[aria-label="电子版"]')).toBeNull();
    expect(container.querySelector('select[aria-label="纸质版"]')).toBeNull();
  });

  it('当前值回显为已选中的芯片', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const group = container.querySelector('[role="group"][aria-label="拥有形态"]')!;
    const chips = Array.from(group.querySelectorAll('button'));
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
    expect(chips[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('点选新增形态、再点取消（多选交互）', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const group = container.querySelector('[role="group"][aria-label="拥有形态"]')!;
    const chips = Array.from(group.querySelectorAll('button'));
    fireEvent.click(chips[1]);
    expect(chips[1].getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chips[1]);
    expect(chips[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('新建记录时拥有形态默认为空（皆无）', () => {
    const { container } = render(<EditorForm recordId={null} />);
    const group = container.querySelector('[role="group"][aria-label="拥有形态"]')!;
    const chips = Array.from(group.querySelectorAll('button'));
    expect(chips.every((c) => c.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('保存时把拥有形态数组写回记录', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const group = container.querySelector('[role="group"][aria-label="拥有形态"]')!;
    fireEvent.click(Array.from(group.querySelectorAll('button'))[1]);
    fireEvent.click(screen.getAllByText('保存')[0]);
    expect(updateRecordMock).toHaveBeenCalledTimes(1);
    const payload = updateRecordMock.mock.calls[0][1];
    expect(payload.拥有形态).toEqual(['电子版', '纸质版']);
    expect((payload as Record<string, unknown>).电子版).toBeUndefined();
    expect((payload as Record<string, unknown>).纸质版).toBeUndefined();
  });
});

describe('v5 · R4 纸质版尺码快捷标签', () => {
  it('提供字母码与身高码两组快捷标签', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const groups = Array.from(container.querySelectorAll('.iw-quick-tags'));
    expect(groups.length).toBe(2);
    expect(groups[0].querySelector('.iw-quick-tags-label')?.textContent).toBe('字母码');
    expect(groups[1].querySelector('.iw-quick-tags-label')?.textContent).toBe('身高码');
  });

  it('字母码覆盖 XS–4XL，身高码覆盖 100–180 步长 10', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const groups = Array.from(container.querySelectorAll('.iw-quick-tags'));
    const letters = Array.from(groups[0].querySelectorAll('button')).map((b) => b.textContent);
    expect(letters).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
    const heights = Array.from(groups[1].querySelectorAll('button')).map((b) => b.textContent);
    expect(heights).toEqual(['100', '110', '120', '130', '140', '150', '160', '170', '180']);
  });

  it('点选快捷标签即填入，再点一次取消', () => {
    render(<EditorForm recordId={7} />);
    const btn = screen.getByLabelText('纸质版尺码 快捷字母码 L');
    fireEvent.click(btn);
    expect(screen.getByLabelText('移除标签 L')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('移除标签 L'));
    expect(screen.queryByLabelText('移除标签 L')).toBeNull();
  });

  it('仍可自由补充自定义尺码', () => {
    render(<EditorForm recordId={7} />);
    const input = screen.getByPlaceholderText('输入纸质版尺码后回车') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '165' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByLabelText('移除标签 165')).toBeTruthy();
  });

  it('保存时把快捷标签选中的值写进纸质版尺码', () => {
    render(<EditorForm recordId={7} />);
    fireEvent.click(screen.getByLabelText('纸质版尺码 快捷身高码 150'));
    fireEvent.click(screen.getAllByText('保存')[0]);
    const payload = updateRecordMock.mock.calls[0][1];
    expect(payload.纸质版尺码).toEqual(['150']);
  });
});

describe('记录详情：五分区版面', () => {
  it('按同样五个分区渲染', () => {
    render(<DetailView id={7} />);
    const titles = Array.from(document.querySelectorAll('.iw-detail-group-title')).map((el) => el.textContent);
    expect(titles).toEqual(SECTION_TITLES);
  });

  it('展示 v5 字段名「拥有形态」与取值', () => {
    const { container } = render(<DetailView id={7} />);
    expect(container.textContent).toContain('拥有形态');
    expect(container.textContent).toContain('电子版');
    expect(container.textContent).not.toContain('拥有电子版');
    expect(container.textContent).not.toContain('拥有纸质版');
  });

  it('不再展示已删除字段', () => {
    const { container } = render(<DetailView id={7} />);
    expect(container.textContent).not.toContain('电子版缺码');
    expect(container.textContent).not.toContain('关联');
  });

  it('系统信息分区展示创建时间与更新时间', () => {
    const { container } = render(<DetailView id={7} />);
    expect(container.textContent).toContain('2026-01-01');
    expect(container.textContent).toContain('2026-01-02');
  });
});
