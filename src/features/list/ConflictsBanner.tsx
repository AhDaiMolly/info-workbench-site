/**
 * 信息汇总工作台 · 待人工确认清单横幅（PRD 4.4 第 3 条 / AC-4）
 *
 * 19 条勾选矛盾记录 + 1 条空编号记录导入后生成清单，页面顶部提示并逐条可查。
 * 系统不自动翻转任何勾选值，用户确认后仅标记「已确认」。
 */

import type { ConflictEntry, SuggestionEntry } from '../../types';

interface Props {
  conflicts: ConflictEntry[];
  suggestions: SuggestionEntry[];
  resolved: number[];
  onResolve: (recordId: number) => void;
  onOpenRecord: (recordId: number) => void;
}

export function ConflictsBanner({ conflicts, suggestions, resolved, onResolve, onOpenRecord }: Props) {
  const open = conflicts.filter((c) => !resolved.includes(c.记录ID));
  if (!open.length && !suggestions.length) return null;

  return (
    <div className="iw-banner iw-banner-warn">
      <div style={{ flex: 1 }}>
        <div className="iw-banner-title">
          待人工确认清单：{open.length} 条矛盾记录
          {suggestions.length ? `，${suggestions.length} 条建议补全` : ''}
        </div>
        <div className="iw-banner-text" style={{ marginBottom: 10 }}>
          迁移时发现原始表格中「勾选状态」与「尺码信息」相互矛盾。系统<b>没有</b>自动修改任何值，请逐条确认后再手工调整。
        </div>
        {open.slice(0, 6).map((c) => (
          <div key={`${c.类型}-${c.记录ID}-${c.字段}`} className="iw-conflict-item">
            <div>
              <div className="iw-conflict-title">
                #{c.记录ID} {c.名称}
              </div>
              <div className="iw-conflict-detail">{c.详情}</div>
              {c.处理建议 ? <div className="iw-conflict-detail">{c.处理建议}</div> : null}
            </div>
            <div className="iw-banner-actions">
              <button className="iw-btn iw-btn-sm" type="button" onClick={() => onOpenRecord(c.记录ID)}>
                查看
              </button>
              <button className="iw-btn iw-btn-sm" type="button" onClick={() => onResolve(c.记录ID)}>
                标记已确认
              </button>
            </div>
          </div>
        ))}
        {open.length > 6 ? (
          <div className="iw-conflict-detail">其余 {open.length - 6} 条可在「设置 › 数据管理」导出的数据文件里逐条查看。</div>
        ) : null}
        {suggestions.map((s) => (
          <div key={`s-${s.记录ID}`} className="iw-conflict-item">
            <div>
              <div className="iw-conflict-title">#{s.记录ID} {s.名称}（建议补全）</div>
              <div className="iw-conflict-detail">{s.详情}</div>
              {s.处理建议 ? <div className="iw-conflict-detail">{s.处理建议}</div> : null}
            </div>
            <div className="iw-banner-actions">
              <button className="iw-btn iw-btn-sm" type="button" onClick={() => onOpenRecord(s.记录ID)}>
                查看
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
