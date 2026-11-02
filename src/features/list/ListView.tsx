/**
 * 信息汇总工作台 · 列表视图（PRD 5.3 / AC-9 / AC-10 / AC-11）
 * 默认按更新时间倒序；支持按记录ID / 名称 / 更新时间排序；分页；显示列可配置。
 */

import { useMemo, useState } from 'react';
import { useApp } from '../../store/store';
import { navigate } from '../../router';
import { applyQuery, highlightParts, sortRecords } from '../../store/selectors';
import { SearchBox } from './SearchBox';
import { FilterPanel } from './FilterPanel';
import { ColumnConfig } from './ColumnConfig';
import { ConflictsBanner } from './ConflictsBanner';
import { Modal } from '../../components/Modal';
import { DEFAULT_VISIBLE_COLUMNS } from '../../schema';
import type { SortKey } from '../../types';

const SORTABLE: SortKey[] = ['id', '名称', '更新时间'];

export function ListView() {
  const app = useApp();
  const { records, filters, query, sort, visibleColumns, page, pageSize } = app;
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const visible = visibleColumns.length ? visibleColumns : DEFAULT_VISIBLE_COLUMNS;

  const filtered = useMemo(
    () => applyQuery(records.filter((r) => !r.deletedAt), filters, query, app.indexes),
    [records, filters, query, app.indexes],
  );

  const sorted = useMemo(() => sortRecords(filtered, sort), [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSort = (key: SortKey) => {
    if (sort.key === key) app.actions.setSort({ key, dir: sort.dir === 'desc' ? 'asc' : 'desc' });
    else app.actions.setSort({ key, dir: key === '名称' ? 'asc' : 'desc' });
  };

  const renderCell = (key: string, value: unknown) => {
    if (key === '名称') {
      return (
        <span>
          {highlightParts(String(value ?? ''), query).map((p, i) => (
            p.hit ? <mark key={i} className="iw-highlight">{p.text}</mark> : <span key={i}>{p.text}</span>
          ))}
        </span>
      );
    }
    if (key === '备注') {
      const text = String(value ?? '');
      if (!text) return <span className="iw-cell-muted">—</span>;
      return (
        <span style={{ whiteSpace: 'normal', display: 'inline-block', minWidth: 180, maxWidth: 320 }}>
          {highlightParts(text.slice(0, 60), query).map((p, i) => (
            p.hit ? <mark key={i} className="iw-highlight">{p.text}</mark> : <span key={i}>{p.text}</span>
          ))}
          {text.length > 60 ? '…' : ''}
        </span>
      );
    }
    if (Array.isArray(value)) {
      if (!value.length) return <span className="iw-cell-muted">—</span>;
      return <span>{value.join('、')}</span>;
    }
    if (typeof value === 'boolean') {
      return <span className="iw-cell-muted">{value ? '是' : '否'}</span>;
    }
    if (value === '' || value === undefined || value === null) {
      return <span className="iw-cell-muted">—</span>;
    }
    return <span>{String(value)}</span>;
  };

  return (
    <>
      <div className="iw-page-head">
        <div>
          <h1 className="iw-page-title">记录列表</h1>
          <p className="iw-page-sub">
            共 {records.filter((r) => !r.deletedAt).length} 条未删除记录
            {app.pending.length ? `，${app.pending.length} 处改动未同步` : ''}
          </p>
        </div>
        <div className="iw-actions-row">
          <button className="iw-btn" type="button" onClick={() => app.actions.exportJson('filtered')}>
            导出 JSON
          </button>
          <button className="iw-btn" type="button" onClick={() => app.actions.exportXlsx('filtered')}>
            导出 Excel
          </button>
          <button
            className="iw-btn iw-btn-primary"
            type="button"
            onClick={() => navigate({ view: 'editor', id: null, filters, query, sort })}
          >
            + 新增记录
          </button>
        </div>
      </div>

      <ConflictsBanner
        conflicts={app.conflicts}
        suggestions={app.suggestions}
        resolved={app.resolvedConflicts}
        onResolve={app.actions.resolveConflictItem}
        onOpenRecord={(id) => navigate({ view: 'detail', id, filters, query, sort })}
      />

      <div className="iw-toolbar">
        <SearchBox
          value={query}
          onChange={app.actions.setQuery}
          resultCount={filtered.length}
          totalCount={records.filter((r) => !r.deletedAt).length}
        />
        <span className="iw-result-count">
          当前结果 <b>{filtered.length}</b> 条
        </span>
        <div style={{ flex: 1 }} />
        <ColumnConfig schema={app.schema} visible={visibleColumns} onChange={app.actions.setColumns} />
      </div>

      <FilterPanel
        filters={filters}
        schema={app.schema}
        onChange={app.actions.setFilters}
        onClear={app.actions.clearFilters}
        presets={app.presets}
        onApplyPreset={(id) => {
          const preset = app.presets.find((p) => p.id === id);
          if (preset) app.actions.setFilters(preset.filters);
        }}
        onSavePreset={app.actions.savePreset}
        onDeletePreset={app.actions.deletePreset}
      />

      <div className="iw-table-wrap">
        <table className="iw-table">
          <thead>
            <tr>
              {visible.map((col) => {
                const sortable = SORTABLE.includes(col as SortKey);
                return (
                  <th
                    key={col}
                    className={sortable ? 'iw-sortable' : undefined}
                    onClick={sortable ? () => toggleSort(col as SortKey) : undefined}
                    aria-sort={sort.key === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {col}
                    {sortable && sort.key === col ? (
                      <span className="iw-sort-arrow">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                    ) : null}
                  </th>
                );
              })}
              <th style={{ width: 96 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={visible.length + 1}>
                  <div className="iw-empty">
                    <div className="iw-empty-title">没有符合条件的记录</div>
                    <div>试着清空筛选条件，或换一个搜索关键词。</div>
                  </div>
                </td>
              </tr>
            ) : pageRows.map((r) => (
              <tr key={r.id}>
                {visible.map((col) => {
                  const key = col === '记录ID' ? 'id' : col;
                  return (
                    <td key={col} className={col === '名称' ? 'iw-col-name' : undefined}>
                      {col === '名称' ? (
                        <a
                          href={`#/detail/${r.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            navigate({ view: 'detail', id: r.id, filters, query, sort });
                          }}
                        >
                          {renderCell(col, r.名称)}
                        </a>
                      ) : (
                        renderCell(col, (r as unknown as Record<string, unknown>)[key])
                      )}
                    </td>
                  );
                })}
                <td>
                  <button
                    className="iw-btn iw-btn-sm iw-btn-ghost"
                    type="button"
                    onClick={() => navigate({ view: 'editor', id: r.id, filters, query, sort })}
                  >
                    编辑
                  </button>
                  <button
                    className="iw-btn iw-btn-sm iw-btn-ghost"
                    type="button"
                    style={{ color: 'var(--iw-danger)' }}
                    onClick={() => setPendingDelete(r.id)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
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
            onChange={(e) => app.actions.setPageSize(Number(e.target.value))}
            aria-label="每页条数"
          >
            {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n} 条 / 页</option>)}
          </select>
        </div>
        <div className="iw-actions-row">
          <button className="iw-btn iw-btn-sm" type="button" disabled={currentPage <= 1} onClick={() => app.actions.setPage(currentPage - 1)}>
            上一页
          </button>
          <button
            className="iw-btn iw-btn-sm"
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => app.actions.setPage(currentPage + 1)}
          >
            下一页
          </button>
        </div>
      </div>

      <Modal
        open={pendingDelete !== null}
        title="确认删除这条记录？"
        danger
        confirmText="移到回收站"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete !== null) app.actions.deleteRecord(pendingDelete);
          setPendingDelete(null);
        }}
      >
        删除后记录会进入回收站并保留 30 天，期间可以恢复。30 天后将被永久移除。
      </Modal>
    </>
  );
}
