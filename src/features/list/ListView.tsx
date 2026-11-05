/**
 * 信息汇总工作台 · 列表视图（PRD 5.3 / AC-9 / AC-10 / AC-11）
 * 默认按名称拼音升序（v6 起调整）；支持按记录ID / 名称 / 更新时间排序；分页；显示列可配置。
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
import { DEFAULT_VISIBLE_COLUMNS, HIDDEN_UI_FIELDS } from '../../schema';
import { doneIcon, formatMarkIcon, rowAnnotation, tutorialIcon, truncateTags } from './derivedCells';
import type { RecordItem, SortKey } from '../../types';

const SORTABLE: SortKey[] = ['id', '名称', '更新时间'];

export function ListView() {
  const app = useApp();
  const { records, filters, query, sort, visibleColumns, page, pageSize } = app;
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  // v6.4：旧偏好（localStorage）里可能还存着已删除的「标记」列——渲染前过滤并去重；
  // v6.5（需求 1）：「推荐」「计划」全站隐藏，旧偏好里的这两列不再渲染；
  // v6.5（需求 9）：旧偏好里的「形态」派生列拆成「电子」「纸质」两列；
  // 清洗后为空则回落到默认列集。
  const visible = useMemo(() => {
    const expanded = visibleColumns.flatMap((c) => (c === '形态' ? ['电子', '纸质'] : [c]));
    const cleaned = Array.from(new Set(expanded.filter((c) => !HIDDEN_UI_FIELDS.includes(c))));
    return cleaned.length ? cleaned : DEFAULT_VISIBLE_COLUMNS;
  }, [visibleColumns]);

  const filtered = useMemo(
    () => applyQuery(records, filters, query, app.indexes, app.planMembers),
    [records, filters, query, app.indexes, app.planMembers],
  );

  const sorted = useMemo(() => sortRecords(filtered, sort), [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSort = (key: SortKey) => {
    if (sort.key === key) app.actions.setSort({ key, dir: sort.dir === 'desc' ? 'asc' : 'desc' });
    else app.actions.setSort({ key, dir: key === '名称' ? 'asc' : 'desc' });
  };

  /** v6.5（需求 8）：行标注色 —— 信息不全（灰）优先于无拥有形态（黄），两规则互不叠加 */
  const rowClass = (r: RecordItem): string | undefined => {
    const a = rowAnnotation(r);
    if (a === 'incomplete') return 'iw-row-incomplete';
    if (a === 'noformat') return 'iw-row-noformat';
    return undefined;
  };

  const renderCell = (col: string, r: RecordItem) => {
    if (col === '名称') {
      return (
        <span>
          {highlightParts(String(r.名称 ?? ''), query).map((p, i) => (
            p.hit ? <mark key={i} className="iw-highlight">{p.text}</mark> : <span key={i}>{p.text}</span>
          ))}
        </span>
      );
    }
    // v6.5（需求 9）：派生列「形态」拆成「电子」「纸质」两列 —— 各自按该记录是否勾选显示 ✓ / ×
    if (col === '电子' || col === '纸质') {
      const icon = formatMarkIcon(r.拥有形态, col === '电子' ? '电子版' : '纸质版');
      return <span className="iw-icon-cell-item" title={col === '电子' ? '电子版' : '纸质版'}>{icon}</span>;
    }
    // v6.4：「做过」列（替代原「标记」派生列）—— 做过 = ✓，其余留空
    if (col === '做过') {
      const icon = doneIcon(r.做过);
      if (!icon) return <span />;
      return <span className="iw-icon-cell-item" title="做过">{icon}</span>;
    }
    // v6.4：「教程」列三态 —— 有 = ✓ / 无 = ✗ / 未填或未知取值 = 留空
    if (col === '教程') {
      const icon = tutorialIcon(r.教程);
      if (!icon) return <span />;
      return <span className="iw-icon-cell-item" title={`教程：${String(r.教程 ?? '')}`}>{icon}</span>;
    }
    // v6.4（bug 修复）：未拥有对应形态时，尺码列留空（不再是「—」）；拥有但未填才走下方通用空态「—」
    if (col === '电子版尺码' && !(r.拥有形态 ?? []).includes('电子版')) return <span />;
    if (col === '纸质版尺码' && !(r.拥有形态 ?? []).includes('纸质版')) return <span />;
    // v5（R1）：分类列最多 2 个标签 + 「+n」
    if (col === '分类') {
      const { shown, extra } = truncateTags(r.分类);
      if (!shown.length) return <span className="iw-cell-muted">—</span>;
      return (
        <span className="iw-tag-cell">
          {shown.map((t) => <span key={t} className="iw-tag-pill">{t}</span>)}
          {extra > 0 ? <span className="iw-tag-more">+{extra}</span> : null}
        </span>
      );
    }
    const key = col === '记录ID' ? 'id' : col;
    const value = (r as unknown as Record<string, unknown>)[key];
    if (col === '备注') {
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
            共 {records.length} 条记录
            {app.pending.length ? `，${app.pending.length} 处改动未同步` : ''}
          </p>
        </div>
        <div className="iw-actions-row">
          {/* v4：导出入口统一移到「设置 › 数据管理」，列表页不再放导出按钮 */}
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
        ignoredKeys={app.ignoredChecks.map((e) => e.key)}
        onIgnore={app.actions.ignoreCheckItem}
        onIgnoreAll={app.actions.ignoreAllChecks}
        onOpenRecord={(id) => navigate({ view: 'detail', id, filters, query, sort })}
      />

      <div className="iw-toolbar">
        <SearchBox
          value={query}
          onChange={app.actions.setQuery}
          resultCount={filtered.length}
          totalCount={records.length}
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
        plans={app.plans.map((p) => ({ id: p.id, name: p.名称 }))}
        candidates={app.optionCandidates}
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
              <tr key={r.id} className={rowClass(r)}>
                {visible.map((col) => (
                    <td key={col} className={col === '名称' ? 'iw-col-name' : undefined}>
                      {col === '名称' ? (
                        <a
                          href={`#/detail/${r.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            navigate({ view: 'detail', id: r.id, filters, query, sort });
                          }}
                        >
                          {renderCell(col, r)}
                        </a>
                      ) : (
                        renderCell(col, r)
                      )}
                    </td>
                  ))}
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
        confirmText="删除"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete !== null) app.actions.deleteRecord(pendingDelete);
          setPendingDelete(null);
        }}
      >
        删除后<b>立即从数据中移除</b>（本版没有回收站，无法恢复）。下次同步会把这个删除写回仓库。
        如需保留副本，请先到「设置 › 数据管理」导出备份。
      </Modal>
    </>
  );
}
