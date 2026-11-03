import { describe, expect, it } from 'vitest';
import { buildHash, parseHash } from '../router';
import { EMPTY_FILTERS } from '../types';
import type { Filters } from '../types';

function filters(patch: Partial<Filters> = {}): Filters {
  return { ...EMPTY_FILTERS, ...patch };
}

describe('hash 路由解析', () => {
  it('默认进入列表视图', () => {
    const r = parseHash('');
    expect(r.view).toBe('list');
    expect(r.page).toBe(1);
    expect(r.query).toBe('');
  });

  it('解析详情 / 编辑 / 看板 / 设置', () => {
    expect(parseHash('#/detail/12').view).toBe('detail');
    expect(parseHash('#/detail/12').id).toBe(12);
    expect(parseHash('#/editor/7').view).toBe('editor');
    expect(parseHash('#/editor/7').id).toBe(7);
    expect(parseHash('#/editor/new').view).toBe('editor');
    expect(parseHash('#/editor/new').id).toBeNull();
    expect(parseHash('#/dashboard').view).toBe('dashboard');
    expect(parseHash('#/settings').view).toBe('settings');
  });

  it('v4：回收站路由已移除，#/trash 落到列表视图', () => {
    expect(parseHash('#/trash').view).toBe('list');
  });

  it('v5：解析多选筛选与布尔三态（拥有形态为单个多选）', () => {
    const r = parseHash('#/list?brand=品牌甲~品牌乙&cat=女装&own=电子版~纸质版&done=1');
    expect(r.filters.品牌).toEqual(['品牌甲', '品牌乙']);
    expect(r.filters.分类).toEqual(['女装']);
    expect(r.filters.拥有形态).toEqual(['电子版', '纸质版']);
    expect(r.filters.做过).toBe(true);
  });

  it('v5：旧的 elec / paper 参数不再被识别', () => {
    const r = parseHash('#/list?elec=有&paper=有');
    expect(r.filters.拥有形态).toEqual([]);
    expect((r.filters as unknown as Record<string, unknown>).电子版).toBeUndefined();
  });

  it('解析搜索词、排序与页码', () => {
    const r = parseHash('#/list?q=羊毛&sort=名称&dir=asc&page=3');
    expect(r.query).toBe('羊毛');
    expect(r.sort).toEqual({ key: '名称', dir: 'asc' });
    expect(r.page).toBe(3);
  });

  it('非法页码回落到 1', () => {
    expect(parseHash('#/list?page=abc').page).toBe(1);
    expect(parseHash('#/list?page=-2').page).toBe(1);
  });
});

describe('hash 路由构造与往返', () => {
  it('默认列表不产生多余参数（v6：默认排序为「名称升序」）', () => {
    expect(buildHash({ view: 'list', filters: filters(), query: '', sort: { key: '名称', dir: 'asc' }, page: 1 }))
      .toBe('#/list');
    // 非默认排序才写进 URL 参数
    expect(buildHash({ view: 'list', filters: filters(), query: '', sort: { key: '更新时间', dir: 'desc' }, page: 1 }))
      .toContain('sort=');
    expect(buildHash({ view: 'list', filters: filters(), query: '', sort: { key: '更新时间', dir: 'desc' }, page: 1 }))
      .toContain('dir=desc');
  });

  it('筛选 / 搜索 / 排序 / 页码往返一致', () => {
    const original = {
      view: 'list' as const,
      filters: filters({
        品牌: ['品牌甲', '品牌乙'],
        分类: ['女装'],
        拥有形态: ['电子版'],
      }),
      query: '羊毛 外套',
      sort: { key: '名称' as const, dir: 'asc' as const },
      page: 4,
    };
    const hash = buildHash(original);
    const back = parseHash(hash);
    expect(back.filters.品牌).toEqual(['品牌甲', '品牌乙']);
    expect(back.filters.分类).toEqual(['女装']);
    expect(back.filters.拥有形态).toEqual(['电子版']);
    expect(back.query).toBe('羊毛 外套');
    expect(back.sort).toEqual({ key: '名称', dir: 'asc' });
    expect(back.page).toBe(4);
  });

  it('v5：拥有形态多选在 hash 中往返一致（含「任意拥有」）', () => {
    const original = {
      view: 'list' as const,
      filters: filters({ 拥有形态: ['电子版', '任意拥有'] }),
      query: '',
      sort: { key: '更新时间' as const, dir: 'desc' as const },
      page: 1,
    };
    const back = parseHash(buildHash(original));
    expect(back.filters.拥有形态).toEqual(['电子版', '任意拥有']);
  });

  it('详情页路径带记录 ID', () => {
    expect(buildHash({ view: 'detail', id: 33 })).toBe('#/detail/33');
  });

  it('新增记录路径为 editor/new', () => {
    expect(buildHash({ view: 'editor', id: null })).toBe('#/editor/new');
  });

  it('页码为 1 时不写入参数', () => {
    expect(buildHash({ view: 'list', page: 1 })).toBe('#/list');
  });
});
