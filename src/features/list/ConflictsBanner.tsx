/**
 * 信息汇总工作台 · 待人工确认清单横幅（v6.1.1 动态核对版）
 *
 * v1 导入时曾用静态快照（数据仓 pending-conflicts.json）提示矛盾项，
 * 从不随数据更新、措辞也停在旧字段口径。v6.1.1 起按当前记录实时核对
 * （store/pendingChecks.ts，规则沿用当初迁移工具并同步到 v6.1 字段口径）：
 *   · 用户修复记录后，条目自动从清单消失；
 *   · 全部处理完（或全部忽略）时横幅不显示；
 *   · 每条支持「忽略」（浏览器本地持久化），「全部忽略」一键收起，
 *     已忽略项可在「设置 › 数据管理 › 待确认清单」查看与恢复。
 */

import type { ConflictEntry, SuggestionEntry } from '../../types';

interface Props {
  conflicts: ConflictEntry[];
  suggestions: SuggestionEntry[];
  ignoredKeys: string[];
  onIgnore: (item: ConflictEntry | SuggestionEntry) => void;
  onIgnoreAll: () => void;
  onOpenRecord: (recordId: number) => void;
}

export function ConflictsBanner({ conflicts, suggestions, ignoredKeys, onIgnore, onIgnoreAll, onOpenRecord }: Props) {
  const ignored = new Set(ignoredKeys);
  const openConflicts = conflicts.filter((c) => !ignored.has(c.key));
  const openSuggestions = suggestions.filter((s) => !ignored.has(s.key));
  if (!openConflicts.length && !openSuggestions.length) return null;

  return (
    <div className="iw-banner iw-banner-warn" data-testid="iw-conflicts-banner">
      <div style={{ flex: 1 }}>
        <div className="iw-banner-title">
          待人工确认清单：{openConflicts.length} 条矛盾记录
          {openSuggestions.length ? `，${openSuggestions.length} 条建议补全` : ''}
        </div>
        <div className="iw-banner-text" style={{ marginBottom: 10 }}>
          按当前数据实时核对得出：「拥有形态」的勾选与尺码填写相互矛盾，或勾选了形态但对应尺码为空。
          系统<b>没有</b>自动修改任何值；修复记录后条目会自动从清单消失。
        </div>
        {openConflicts.slice(0, 6).map((c) => (
          <div key={c.key} className="iw-conflict-item">
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
              <button
                className="iw-btn iw-btn-sm"
                type="button"
                data-testid={`iw-ignore-${c.key}`}
                onClick={() => onIgnore(c)}
              >
                忽略
              </button>
            </div>
          </div>
        ))}
        {openConflicts.length > 6 ? (
          <div className="iw-conflict-detail">
            其余 {openConflicts.length - 6} 条点「全部忽略」可一键收起，或修复对应记录后自动消失。
          </div>
        ) : null}
        {openSuggestions.map((s) => (
          <div key={s.key} className="iw-conflict-item">
            <div>
              <div className="iw-conflict-title">#{s.记录ID} {s.名称}（建议补全）</div>
              <div className="iw-conflict-detail">{s.详情}</div>
              {s.处理建议 ? <div className="iw-conflict-detail">{s.处理建议}</div> : null}
            </div>
            <div className="iw-banner-actions">
              <button className="iw-btn iw-btn-sm" type="button" onClick={() => onOpenRecord(s.记录ID)}>
                查看
              </button>
              <button
                className="iw-btn iw-btn-sm"
                type="button"
                data-testid={`iw-ignore-${s.key}`}
                onClick={() => onIgnore(s)}
              >
                忽略
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="iw-banner-actions" style={{ alignSelf: 'flex-start' }}>
        <button
          className="iw-btn iw-btn-sm"
          type="button"
          data-testid="iw-ignore-all"
          onClick={onIgnoreAll}
        >
          全部忽略
        </button>
      </div>
    </div>
  );
}
