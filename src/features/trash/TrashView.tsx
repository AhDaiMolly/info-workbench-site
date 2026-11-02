/**
 * 信息汇总工作台 · 回收站（PRD 5.2 / 3.6 / AC-8）
 * 软删除记录保留 30 天，可恢复；过期记录在写回时从数据文件中物理移除。
 */

import { useMemo } from 'react';
import { useApp } from '../../store/store';
import { navigate } from '../../router';

export function TrashView() {
  const app = useApp();
  const { filters, query, sort } = app;

  const deleted = useMemo(
    () => app.records
      .filter((r) => r.deletedAt)
      .sort((a, b) => (Date.parse(b.deletedAt ?? '') || 0) - (Date.parse(a.deletedAt ?? '') || 0)),
    [app.records],
  );

  const expireAt = (iso: string) => {
    const t = Date.parse(iso) + 30 * 24 * 3600 * 1000;
    return new Date(t).toLocaleDateString('zh-CN');
  };

  return (
    <>
      <div className="iw-page-head">
        <div>
          <h1 className="iw-page-title">回收站</h1>
          <p className="iw-page-sub">
            已删除的记录保留 30 天，到期后会在下次写回仓库时永久移除。当前 {deleted.length} 条。
          </p>
        </div>
        <div className="iw-actions-row">
          <button
            className="iw-btn"
            type="button"
            onClick={() => navigate({ view: 'list', filters, query, sort })}
          >
            返回列表
          </button>
        </div>
      </div>

      {app.conflicts.length ? (
        <div className="iw-banner">
          <div style={{ flex: 1 }}>
            <div className="iw-banner-title">待人工确认清单（{app.conflicts.filter((c) => !app.resolvedConflicts.includes(c.记录ID)).length} 条未确认）</div>
            <div className="iw-banner-text">
              迁移时检测到原始表格中勾选状态与尺码信息矛盾的记录。系统未自动翻转任何值，请逐条确认。
            </div>
            {app.conflicts.map((c) => {
              const done = app.resolvedConflicts.includes(c.记录ID);
              return (
                <div key={`${c.记录ID}-${c.字段}`} className={`iw-conflict-item${done ? ' iw-conflict-resolved' : ''}`}>
                  <div>
                    <div className="iw-conflict-title">#{c.记录ID} {c.名称}</div>
                    <div className="iw-conflict-detail">{c.详情}</div>
                    {c.处理建议 ? <div className="iw-conflict-detail">{c.处理建议}</div> : null}
                  </div>
                  <div className="iw-banner-actions">
                    <button
                      className="iw-btn iw-btn-sm"
                      type="button"
                      onClick={() => navigate({ view: 'detail', id: c.记录ID, filters, query, sort })}
                    >
                      查看
                    </button>
                    {!done ? (
                      <button className="iw-btn iw-btn-sm" type="button" onClick={() => app.actions.resolveConflictItem(c.记录ID)}>
                        标记已确认
                      </button>
                    ) : <span className="iw-result-count">已确认</span>}
                  </div>
                </div>
              );
            })}
            {app.suggestions.map((s) => (
              <div key={`s-${s.记录ID}`} className="iw-conflict-item">
                <div>
                  <div className="iw-conflict-title">#{s.记录ID} {s.名称}（建议补全）</div>
                  <div className="iw-conflict-detail">{s.详情}</div>
                  {s.处理建议 ? <div className="iw-conflict-detail">{s.处理建议}</div> : null}
                </div>
                <div className="iw-banner-actions">
                  <button
                    className="iw-btn iw-btn-sm"
                    type="button"
                    onClick={() => navigate({ view: 'detail', id: s.记录ID, filters, query, sort })}
                  >
                    查看
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="iw-table-wrap">
        <table className="iw-table">
          <thead>
            <tr>
              <th style={{ width: 80 }}>记录ID</th>
              <th>名称</th>
              <th>品牌</th>
              <th>删除时间</th>
              <th>到期移除</th>
              <th style={{ width: 100 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {deleted.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="iw-empty">
                    <div className="iw-empty-title">回收站是空的</div>
                    <div>被删除的记录会出现在这里，30 天内可以随时恢复。</div>
                  </div>
                </td>
              </tr>
            ) : deleted.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td className="iw-col-name">
                  <a
                    href={`#/detail/${r.id}`}
                    onClick={(e) => { e.preventDefault(); navigate({ view: 'detail', id: r.id, filters, query, sort }); }}
                  >
                    {r.名称}
                  </a>
                </td>
                <td>{r.品牌}</td>
                <td>{r.deletedAt ? new Date(r.deletedAt).toLocaleString('zh-CN') : '—'}</td>
                <td>{r.deletedAt ? expireAt(r.deletedAt) : '—'}</td>
                <td>
                  <button className="iw-btn iw-btn-sm" type="button" onClick={() => app.actions.restoreRecord(r.id)}>
                    恢复
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
