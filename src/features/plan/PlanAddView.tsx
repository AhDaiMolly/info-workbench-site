/**
 * 信息汇总工作台 · 清单页签「＋」添加成员页（v6.9 需求 2）
 *
 * 路由 #/plan-add/:planId。布局与列表页一致：同款搜索框（SearchBox）、
 * 筛选面板（FilterPanel）、记录表格（iw-table）与分页器，可筛选和查找；
 * 记录可多选，确认后批量加入该清单；已在清单中的记录整行置灰且不可勾选，
 * 避免重复加入。完成后返回清单页并即时可见。
 *
 * 筛选与搜索是本页的本地状态（不写全局 filters），返回列表页不破坏列表页的筛选上下文。
 * 所有写操作只改 plans.json（清单与成员关系），绝不修改记录本身。
 */

import { useMemo, useState } from 'react';
import { useApp } from '../../store/store';
import { navigate } from '../../router';
import { applyQuery, sortRecords } from '../../store/selectors';
import { SearchBox } from '../list/SearchBox';
import { FilterPanel } from '../list/FilterPanel';
import { doneIcon } from '../list/derivedCells';
import type { Filters, RecordItem, SortSpec } from '../../types';
import { EMPTY_FILTERS } from '../../types';

const SORTABLE_COLS = ['记录ID', '名称'] as const;

const PAGE_SIZES = [20, 50, 100, 200];

export function PlanAddView({ planId }: { planId: string | null }) {
  const app = useApp();

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY_FILTERS }));
  const [sort, setSort] = useState<SortSpec>({ key: '名称', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [picked, setPicked] = useState<number[]>([]);

  const plan = useMemo(
    () => app.plans.find((p) => p.id === planId) ?? null,
    [app.plans, planId],
  );

  const memberIds = useMemo(() => new Set(plan?.记录ID列表 ?? []), [plan]);

  const filtered = useMemo(
    () => applyQuery(app.records, filters, query, app.indexes, app.planMembers),
    [app.records, filters, query, app.indexes, app.planMembers],
  );
  const sorted = useMemo(() => sortRecords(filtered, sort), [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSort = (key: 'id' | '名称') => {
    if (sort.key === key) setSort({ key, dir: sort.dir === 'desc' ? 'asc' : 'desc' });
    else setSort({ key, dir: '名称' === key ? 'asc' : 'desc' });
  };

  const togglePick = (id: number) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const backToPlans = () => navigate({ view: 'plans' });

  const confirmAdd = () => {
    if (!planId || !picked.length) return;
    app.actions.addRecordsToPlan(planId, picked);
    navigate({ view: 'plans' });
  };

  if (!plan) {
    return (
      <div data-testid="iw-plan-add-view">
        <div className="iw-settings-card">
          <div className="iw-field-hint" data-testid="iw-plan-add-missing">
            清单不存在或已被删除，请从「清单」页签重新进入。
          </div>
          <button className="iw-btn iw-btn-sm" type="button" onClick={backToPlans}>
            返回清单
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="iw-plan-add-view">
      <div className="iw-page-head">
        <div>
          <h1 className="iw-page-title" data-testid="iw-plan-add-title">加入清单</h1>
          <p className="iw-page-sub" data-testid="iw-plan-add-sub">
            往「{plan.名称}」批量添加记录 · 共 {app.records.length} 条记录，其中 {memberIds.size} 条已在清单 ·
            确认后返回清单页并即时可见。
          </p>
        </div>
        <div className="iw-actions-row">
          <button className="iw-btn iw-btn-sm" type="button" data-testid="iw-plan-add-back" onClick={backToPlans}>
            返回清单
          </button>
          <button
            className="iw-btn iw-btn-primary"
            type="button"
            data-testid="iw-plan-add-confirm"
            disabled={!picked.length}
            title={picked.length ? `把选中的 ${picked.length} 条记录加入「${plan.名称}」` : '先勾选要加入的记录'}
            onClick={confirmAdd}
          >
            加入清单（{picked.length}）
          </button>
        </div>
      </div>

      <div className="iw-toolbar">
        <SearchBox value={query} onChange={setQuery} resultCount={filtered.length} totalCount={app.records.length} />
        <span className="iw-result-count">
          当前结果 <b>{filtered.length}</b> 条 · 已选 <b>{picked.length}</b> 条
        </span>
        <div style={{ flex: 1 }} />
      </div>

      <FilterPanel
        filters={filters}
        schema={app.schema}
        onChange={setFilters}
        onClear={() => setFilters({ ...EMPTY_FILTERS })}
        presets={app.presets}
        onApplyPreset={(id) => {
          const preset = app.presets.find((p) => p.id === id);
          if (preset) setFilters(preset.filters);
        }}
        onSavePreset={app.actions.savePreset}
        onDeletePreset={app.actions.deletePreset}
        plans={app.plans.map((p) => ({ id: p.id, name: p.名称 }))}
        candidates={app.optionCandidates}
      />

      <div className="iw-table-wrap">
        <table className="iw-table" data-testid="iw-plan-add-table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>选</th>
              {SORTABLE_COLS.map((col) => {
                const key = col === '记录ID' ? 'id' : '名称';
                const sortable = true;
                return (
                  <th
                    key={col}
                    className={sortable ? 'iw-sortable' : undefined}
                    onClick={() => toggleSort(key as 'id' | '名称')}
                    aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {col}
                    {sort.key === key ? (
                      <span className="iw-sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                    ) : null}
                  </th>
                );
              })}
              <th>品牌</th>
              <th>款式</th>
              <th>季节</th>
              <th>做过</th>
              <th>清单</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="iw-empty">
                    <div className="iw-empty-title">没有符合条件的记录</div>
                    <div>试着清空筛选条件，或换一个搜索关键词。</div>
                  </div>
                </td>
              </tr>
            ) : pageRows.map((r: RecordItem) => {
              const inPlan = memberIds.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={inPlan ? 'iw-plan-add-row-in' : undefined}
                  data-testid={`iw-plan-add-row-${r.id}`}
                  onClick={() => { if (!inPlan) togglePick(r.id); }}
                  style={{ cursor: inPlan ? 'default' : 'pointer' }}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`选择：${String(r.名称 ?? '')}`}
                      data-testid={`iw-plan-add-check-${r.id}`}
                      checked={picked.includes(r.id)}
                      disabled={inPlan}
                      onChange={() => togglePick(r.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="iw-cell-muted">#{r.id}</td>
                  <td className="iw-col-name">{String(r.名称 ?? '')}</td>
                  <td>{String(r.品牌 ?? '')}</td>
                  <td>{String(r.款式 ?? '')}</td>
                  <td>{String(r.季节 ?? '')}</td>
                  <td>{doneIcon(r.做过) ? <span className="iw-icon-cell-item" title="做过">✓</span> : <span />}</td>
                  <td>
                    {inPlan ? (
                      <span className="iw-tag-pill" data-testid={`iw-plan-add-in-${r.id}`}>已在清单</span>
                    ) : (
                      <span className="iw-cell-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="iw-pager">
        <div className="iw-pager-right">
          <span>
            第 {currentPage} / {totalPages} 页，共 {sorted.length} 条
          </span>
          <select
            className="iw-select"
            style={{ width: 'auto', height: 28 }}
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            aria-label="每页条数"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} 条 / 页</option>)}
          </select>
        </div>
        <div className="iw-actions-row">
          <button className="iw-btn iw-btn-sm" type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
            上一页
          </button>
          <button className="iw-btn iw-btn-sm" type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
