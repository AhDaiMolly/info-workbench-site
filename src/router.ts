/**
 * 信息汇总工作台 · hash 路由
 *
 * 自研 30 行级 hash 路由（架构 2.3 选型表）：单页仅 5 个视图，无需引入路由库。
 * 筛选与搜索条件编码进 query，保证「详情页返回不丢失筛选上下文」（AC-12）与可分享/收藏。
 */

import { useEffect, useState } from 'react';
import type { Filters, SortKey, SortSpec } from './types';
import { EMPTY_FILTERS } from './types';

export type ViewName = 'list' | 'detail' | 'dashboard' | 'settings' | 'editor';

export interface Route {
  view: ViewName;
  /** 详情 / 编辑的记录 ID */
  id: number | null;
  filters: Filters;
  query: string;
  sort: SortSpec;
  page: number;
}

const MULTI_KEYS: Array<keyof Filters> = [
  '品牌', '分类', '款式', '季节', '教程', '推荐', '想做', '电子版尺码组',
  // v5（R5）：电子版 / 纸质版 两个下拉合并为一个多选（电子版 / 纸质版 / 任意拥有）
  '拥有形态',
];
const BOOL_KEYS: Array<keyof Filters> = ['做过'];

const FILTER_PARAM: Record<string, string> = {
  品牌: 'brand',
  分类: 'cat',
  款式: 'style',
  季节: 'season',
  教程: 'tut',
  推荐: 'rec',
  想做: 'plan',
  电子版尺码组: 'size',
  拥有形态: 'own',
  做过: 'done',
};

function parseFilters(params: URLSearchParams): Filters {
  const filters: Filters = {
    ...EMPTY_FILTERS, 品牌: [], 分类: [], 款式: [], 季节: [], 教程: [], 推荐: [], 想做: [],
    电子版尺码组: [], 拥有形态: [],
  };
  for (const key of MULTI_KEYS) {
    const raw = params.get(FILTER_PARAM[key]);
    if (!raw) continue;
    const values = raw.split('~').filter(Boolean);
    (filters[key] as string[]) = values;
  }
  for (const key of BOOL_KEYS) {
    const raw = params.get(FILTER_PARAM[key]);
    if (raw === '1') (filters[key] as boolean | undefined) = true;
    else if (raw === '0') (filters[key] as boolean | undefined) = false;
    else (filters[key] as boolean | undefined) = undefined;
  }
  return filters;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/list';
  const [path, queryString = ''] = raw.split('?');
  const params = new URLSearchParams(queryString);
  const seg = path.split('/').filter(Boolean);

  let view: ViewName = 'list';
  let id: number | null = null;

  if (seg[0] === 'detail') { view = 'detail'; id = Number(seg[1]) || null; }
  else if (seg[0] === 'dashboard') view = 'dashboard';
  else if (seg[0] === 'settings') view = 'settings';
  else if (seg[0] === 'editor') { view = 'editor'; id = seg[1] && seg[1] !== 'new' ? Number(seg[1]) || null : null; }

  const sortKey = (params.get('sort') || '更新时间') as SortKey;
  const sortDir = params.get('dir') === 'asc' ? 'asc' : 'desc';

  return {
    view,
    id,
    filters: parseFilters(params),
    query: params.get('q') ?? '',
    sort: { key: sortKey, dir: sortDir },
    page: Math.max(1, Number(params.get('page') || '1') || 1),
  };
}

export function buildHash(route: Partial<Route> & { view: ViewName }): string {
  const params = new URLSearchParams();
  const filters = route.filters ?? EMPTY_FILTERS;
  for (const key of MULTI_KEYS) {
    const values = (filters[key] as string[]) ?? [];
    if (values.length) params.set(FILTER_PARAM[key], values.join('~'));
  }
  for (const key of BOOL_KEYS) {
    const v = filters[key] as boolean | undefined;
    if (v === true) params.set(FILTER_PARAM[key], '1');
    else if (v === false) params.set(FILTER_PARAM[key], '0');
  }
  if (route.query) params.set('q', route.query);
  const sort = route.sort ?? { key: '更新时间', dir: 'desc' };
  if (sort.key !== '更新时间' || sort.dir !== 'desc') {
    params.set('sort', sort.key);
    params.set('dir', sort.dir);
  }
  if (route.page && route.page > 1) params.set('page', String(route.page));

  const base = route.view === 'list' ? '/list'
    : route.view === 'detail' ? `/detail/${route.id ?? ''}`
      : route.view === 'editor' ? `/editor/${route.id ?? 'new'}`
        : `/${route.view}`;
  const qs = params.toString();
  return `#${base}${qs ? `?${qs}` : ''}`;
}

/** 订阅 hash 变化 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** 跳转（同时写入 URL，满足可分享与返回不丢上下文） */
export function navigate(route: Partial<Route> & { view: ViewName }): void {
  const next = buildHash(route);
  if (window.location.hash !== next) window.location.hash = next;
  else window.dispatchEvent(new HashChangeEvent('hashchange'));
}
