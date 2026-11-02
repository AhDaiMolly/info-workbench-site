/**
 * v3 需求 1 / 5 / 6 / 7 的界面级验证（jsdom）：
 *   · 新增/编辑表单与记录详情页都按五分区排版
 *   · 季节是下拉单选，选项 夏 / 春秋 / 冬（「春秋」不拆分）
 *   · 电子版 / 纸质版 由复选框改为下拉单选，取值 有 / 没有 / 不确定
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
  电子版: '有',
  电子版尺码组: [],
  纸质版: '没有',
  纸质版尺码: [],
  推荐: '未评价',
  做过: false,
  想做: '未标记',
  备注: '占位备注',
  创建时间: '2026-01-01T00:00:00.000Z',
  更新时间: '2026-01-02T00:00:00.000Z',
  deletedAt: null,
} as RecordItem;

let records: RecordItem[] = [];

vi.mock('../store/store', () => ({
  useApp: () => ({
    records,
    schema: DEFAULT_SCHEMA,
    filters: { 品牌: [], 分类: [], 款式: [], 季节: [], 教程: [], 推荐: [], 想做: [], 电子版尺码组: [], 电子版: [], 纸质版: [], 做过: undefined },
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

  it('电子版为下拉单选（三态），不是复选框', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const select = screen.getByLabelText('电子版') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', '有', '没有', '不确定']);
    expect(container.querySelector('input[type="checkbox"][id="bool-电子版"]')).toBeNull();
  });

  it('纸质版为下拉单选（三态），不是复选框', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const select = screen.getByLabelText('纸质版') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', '有', '没有', '不确定']);
    expect(container.querySelector('input[type="checkbox"][id="bool-纸质版"]')).toBeNull();
  });

  it('新建记录时电子版 / 纸质版 默认「不确定」，季节不默认成最后一个选项', () => {
    render(<EditorForm recordId={null} />);
    expect((screen.getByLabelText('电子版') as HTMLSelectElement).value).toBe('不确定');
    expect((screen.getByLabelText('纸质版') as HTMLSelectElement).value).toBe('不确定');
    expect((screen.getByLabelText('季节') as HTMLSelectElement).value).toBe('');
  });

  it('选择单选值后状态更新（单选交互）', () => {
    render(<EditorForm recordId={7} />);
    const select = screen.getByLabelText('电子版') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '不确定' } });
    expect((screen.getByLabelText('电子版') as HTMLSelectElement).value).toBe('不确定');
  });

  it('保存时把单选结果写回记录', () => {
    render(<EditorForm recordId={7} />);
    fireEvent.change(screen.getByLabelText('纸质版'), { target: { value: '不确定' } });
    fireEvent.click(screen.getAllByText('保存')[0]);
    expect(updateRecordMock).toHaveBeenCalledTimes(1);
    const payload = updateRecordMock.mock.calls[0][1];
    expect(payload.纸质版).toBe('不确定');
    expect(payload.电子版).toBe('有');
  });
});

describe('记录详情：五分区版面', () => {
  it('按同样五个分区渲染', () => {
    render(<DetailView id={7} />);
    const titles = Array.from(document.querySelectorAll('.iw-detail-group-title')).map((el) => el.textContent);
    expect(titles).toEqual(SECTION_TITLES);
  });

  it('展示改名后的字段名与取值', () => {
    const { container } = render(<DetailView id={7} />);
    expect(container.textContent).toContain('电子版');
    expect(container.textContent).toContain('纸质版');
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