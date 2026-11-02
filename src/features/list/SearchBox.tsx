/**
 * 信息汇总工作台 · 全文搜索框（PRD 5.5）
 * 即时匹配名称 / 品牌 / 备注；与筛选条件叠加生效；关键词在结果中高亮。
 */

import { useEffect, useState } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
  totalCount: number;
}

export function SearchBox({ value, onChange, resultCount, totalCount }: Props) {
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  // 即时生效（去抖 120ms，避免逐字重排全部结果）
  useEffect(() => {
    if (draft === value) return undefined;
    const timer = window.setTimeout(() => onChange(draft), 120);
    return () => window.clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <div className="iw-search">
      <span className="iw-search-icon" aria-hidden="true">🔍</span>
      <input
        className="iw-input"
        type="search"
        value={draft}
        placeholder="搜索名称、品牌、备注…"
        aria-label="全文搜索"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(''); onChange(''); } }}
      />
      {value ? (
        <span className="iw-result-count" style={{ position: 'absolute', right: 10, top: 7, fontSize: 12 }}>
          {resultCount} / {totalCount}
        </span>
      ) : null}
    </div>
  );
}
