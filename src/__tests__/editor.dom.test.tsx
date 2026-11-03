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
  电子版尺码: [],
  纸质版尺码: [],
  推荐: '未评价',
  做过: false,
  计划: '未标记',
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
      品牌: [], 分类: [], 款式: [], 季节: [], 教程: [], 推荐: [], 计划: [],
      电子版尺码: [], 拥有形态: [], 做过: undefined,
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
  // v6（需求 3）：纸质版尺码现在只在勾选「纸质版」后出现，测试需先勾选形态
  function enableOwnership(container: HTMLElement, label: string) {
    const group = container.querySelector('[role="group"][aria-label="拥有形态"]')!;
    const chip = Array.from(group.querySelectorAll('button')).find((b) => b.textContent === label)!;
    fireEvent.click(chip);
  }

  // v6.1（需求 3）：电子版尺码与纸质版尺码共用快捷标签，按 label 锚定具体字段容器再取组
  function sizeField(container: HTMLElement, label: string) {
    const field = Array.from(container.querySelectorAll('.iw-field')).find(
      (el) => (el.querySelector('.iw-label')?.textContent ?? '').startsWith(label),
    );
    return field as HTMLElement;
  }

  it('提供字母码与身高码两组快捷标签', () => {
    const { container } = render(<EditorForm recordId={7} />);
    enableOwnership(container, '纸质版');
    // 记录 7 同时勾着「电子版」，容器级查询会数到 4 组 —— 必须限定在纸质版尺码字段内
    const groups = Array.from(sizeField(container, '纸质版尺码').querySelectorAll('.iw-quick-tags'));
    expect(groups.length).toBe(2);
    expect(groups[0].querySelector('.iw-quick-tags-label')?.textContent).toBe('字母码');
    expect(groups[1].querySelector('.iw-quick-tags-label')?.textContent).toBe('身高码');
  });

  it('字母码覆盖 XS–4XL，身高码覆盖 100–180 步长 10', () => {
    const { container } = render(<EditorForm recordId={7} />);
    enableOwnership(container, '纸质版');
    const groups = Array.from(sizeField(container, '纸质版尺码').querySelectorAll('.iw-quick-tags'));
    const letters = Array.from(groups[0].querySelectorAll('button')).map((b) => b.textContent);
    expect(letters).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
    const heights = Array.from(groups[1].querySelectorAll('button')).map((b) => b.textContent);
    expect(heights).toEqual(['100', '110', '120', '130', '140', '150', '160', '170', '180']);
  });

  it('点选快捷标签即填入，再点一次取消', () => {
    const { container } = render(<EditorForm recordId={7} />);
    enableOwnership(container, '纸质版');
    const btn = screen.getByLabelText('纸质版尺码 快捷字母码 L');
    fireEvent.click(btn);
    expect(screen.getByLabelText('移除标签 L')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('移除标签 L'));
    expect(screen.queryByLabelText('移除标签 L')).toBeNull();
  });

  it('仍可自由补充自定义尺码', () => {
    const { container } = render(<EditorForm recordId={7} />);
    enableOwnership(container, '纸质版');
    const input = screen.getByPlaceholderText('输入纸质版尺码后回车') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '165' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByLabelText('移除标签 165')).toBeTruthy();
  });

  it('保存时把快捷标签选中的值写进纸质版尺码', () => {
    const { container } = render(<EditorForm recordId={7} />);
    enableOwnership(container, '纸质版');
    fireEvent.click(screen.getByLabelText('纸质版尺码 快捷身高码 150'));
    fireEvent.click(screen.getAllByText('保存')[0]);
    const payload = updateRecordMock.mock.calls[0][1];
    expect(payload.纸质版尺码).toEqual(['150']);
  });
});

describe('v6 · 需求 3 形态-尺码联动', () => {
  function chips(container: HTMLElement) {
    const group = container.querySelector('[role="group"][aria-label="拥有形态"]')!;
    return Array.from(group.querySelectorAll('button'));
  }

  it('只勾选「电子版」时：显示电子版尺码、隐藏纸质版尺码', () => {
    const { container } = render(<EditorForm recordId={7} />);
    expect(container.textContent).toContain('电子版尺码');
    expect(container.textContent).not.toContain('纸质版尺码');
    expect(container.querySelector('input[placeholder="输入纸质版尺码后回车"]')).toBeNull();
  });

  it('勾选「纸质版」后：纸质版尺码输入出现', () => {
    const { container } = render(<EditorForm recordId={7} />);
    fireEvent.click(chips(container)[1]);
    expect(container.querySelector('input[placeholder="输入纸质版尺码后回车"]')).not.toBeNull();
  });

  it('取消勾选「纸质版」后：尺码输入隐藏，但已填值保留并给出提示', () => {
    const { container } = render(<EditorForm recordId={7} />);
    fireEvent.click(chips(container)[1]);
    const input = screen.getByPlaceholderText('输入纸质版尺码后回车') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '165' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // 取消勾选纸质版
    fireEvent.click(chips(container)[1]);
    expect(container.querySelector('input[placeholder="输入纸质版尺码后回车"]')).toBeNull();
    const hint = container.querySelector('[data-testid="iw-kept-纸质版尺码"]');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('已保留');
  });

  it('取消勾选后保存：已填尺码仍在提交内容里（不被静默清空）', () => {
    const { container } = render(<EditorForm recordId={7} />);
    fireEvent.click(chips(container)[1]);
    const input = screen.getByPlaceholderText('输入纸质版尺码后回车') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '165' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(chips(container)[1]);
    fireEvent.click(screen.getAllByText('保存')[0]);
    const payload = updateRecordMock.mock.calls[0][1];
    expect(payload.纸质版尺码).toEqual(['165']);
    expect(payload.拥有形态).toEqual(['电子版']);
  });

  it('新建记录时形态全不选：两个尺码输入都不出现', () => {
    const { container } = render(<EditorForm recordId={null} />);
    expect(container.textContent).not.toContain('电子版尺码');
    expect(container.textContent).not.toContain('纸质版尺码');
  });

  it('新建记录勾选「电子版」后：只出现电子版尺码', () => {
    const { container } = render(<EditorForm recordId={null} />);
    fireEvent.click(chips(container)[0]);
    expect(container.textContent).toContain('电子版尺码');
    expect(container.textContent).not.toContain('纸质版尺码');
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

/* ------------------------------------------------------------------
 * v6.1 新增用例：需求 1（表单分区顺序）与需求 2/3（新字段交互）
 * ------------------------------------------------------------------ */
describe('v6.1 · 需求 1 「拥有形态」分区字段顺序', () => {
  it('拥有形态多选在尺码字段之前：拥有形态 → 电子版尺码 → 纸质版尺码', () => {
    const { container } = render(<EditorForm recordId={7} />);
    // 勾选「纸质版」，让两个尺码输入都展示出来，才能断言完整的字段顺序
    const group = container.querySelector('[role="group"][aria-label="拥有形态"]')!;
    const paperChip = Array.from(group.querySelectorAll('button')).find((b) => b.textContent === '纸质版')!;
    fireEvent.click(paperChip);
    const section = container.querySelectorAll('.iw-form-section')[1]; // 「拥有形态」分区
    const labels = Array.from(section.querySelectorAll('.iw-label')).map((el) => el.textContent);
    expect(labels.indexOf('拥有形态')).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf('拥有形态')).toBeLessThan(labels.indexOf('电子版尺码'));
    expect(labels.indexOf('电子版尺码')).toBeLessThan(labels.indexOf('纸质版尺码'));
  });

  it('「状态及评价」分区顺序：做过 → 推荐 → 计划', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const section = container.querySelectorAll('.iw-form-section')[2]; // 「状态及评价」分区
    const text = section.textContent ?? '';
    expect(text.indexOf('做过')).toBeLessThan(text.indexOf('推荐'));
    expect(text.indexOf('推荐')).toBeLessThan(text.indexOf('计划'));
    // 旧选项值已消失（「不想做」是合法新枚举，不能被「想做」子串断言误伤）
    const selectValues = Array.from(section.querySelectorAll('select option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(selectValues).not.toContain('想做');
    expect(selectValues).not.toContain('不确定');
    expect(selectValues).toContain('不想做');
  });
});

describe('v6.1 · 需求 3 电子版尺码快捷标签与联动', () => {
  it('勾选「电子版」后：电子版尺码提供字母码 / 身高码两组快捷标签', () => {
    const { container } = render(<EditorForm recordId={7} />);
    const groups = Array.from(container.querySelectorAll('.iw-quick-tags'));
    expect(groups.length).toBe(2);
    expect(groups[0].querySelector('.iw-quick-tags-label')?.textContent).toBe('字母码');
    expect(groups[1].querySelector('.iw-quick-tags-label')?.textContent).toBe('身高码');
  });

  it('点选电子版快捷标签即填入，保存时写进「电子版尺码」', () => {
    const { container } = render(<EditorForm recordId={7} />);
    fireEvent.click(screen.getByLabelText('电子版尺码 快捷字母码 M'));
    expect(screen.getByLabelText('移除标签 M')).toBeTruthy();
    fireEvent.click(screen.getAllByText('保存')[0]);
    const payload = updateRecordMock.mock.calls[0][1];
    expect(payload.电子版尺码).toContain('M');
  });

  it('取消勾选「电子版」后：输入隐藏但已填的电子版尺码保留并给出提示', () => {
    const { container } = render(<EditorForm recordId={7} />);
    fireEvent.click(screen.getByLabelText('电子版尺码 快捷身高码 120'));
    const chips = Array.from(
      container.querySelector('[role="group"][aria-label="拥有形态"]')!.querySelectorAll('button'),
    );
    fireEvent.click(chips[0]); // 取消「电子版」
    const hint = container.querySelector('[data-testid="iw-kept-电子版尺码"]');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('已保留');
    // 保存不清空
    fireEvent.click(screen.getAllByText('保存')[0]);
    const payload = updateRecordMock.mock.calls[0][1];
    expect(payload.电子版尺码).toContain('120');
    expect(payload.拥有形态).toEqual([]);
  });
});

describe('v6.1 · 需求 2 「计划」字段表单交互', () => {
  it('「计划」下拉选项为 在计划中 / 不想做 / 不是现在 / 未标记（旧选项消失）', () => {
    const { container } = render(<EditorForm recordId={7} />);
    // 直接用 id 定位「计划」下拉（分区里第一个 select 是「推荐」，不能用 section.querySelector('select')）
    const select = container.querySelector('#fld-计划') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    const options = Array.from(select!.options).map((o) => o.value);
    // 枚举下拉首位是占位「（未填）」
    expect(options).toEqual(['', '在计划中', '不想做', '不是现在', '未标记']);
    expect(options).not.toContain('想做');
    expect(options).not.toContain('不确定');
  });
});
