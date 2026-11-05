/**
 * 信息汇总工作台 · 全文搜索框（PRD 5.5）
 * 即时匹配名称 / 品牌 / 备注；与筛选条件叠加生效；关键词在结果中高亮。
 *
 * v6.5（需求 7）：新增显式「×」清空按钮 —— 点它清空输入并立即恢复未筛选的完整列表。
 * 原生 type="search" 的清空按钮被徽标挡住（点击落到徽标上不生效），
 * 因此隐藏原生按钮、统一由自绘按钮负责清空。
 */

import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
  totalCount: number;
}

export function SearchBox({ value, onChange, resultCount, totalCount }: Props) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setDraft(value); }, [value]);

  // 即时生效（去抖 120ms，避免逐字重排全部结果）
  useEffect(() => {
    if (draft === value) return undefined;
    const timer = window.setTimeout(() => onChange(draft), 120);
    return () => window.clearTimeout(timer);
  }, [draft, value, onChange]);

  /** v6.5（需求 7）：清空输入 → 立即把 query 置空 → 列表恢复未筛选的完整列表 */
  const clear = () => {
    setDraft('');
    onChange('');
    inputRef.current?.focus();
  };

  return (
    <div className="iw-search">
      <span className="iw-search-icon" aria-hidden="true">🔍</span>
      <input
        ref={inputRef}
        className="iw-input"
        type="search"
        value={draft}
        placeholder="搜索名称、品牌、备注、编号…"
        aria-label="全文搜索"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') clear(); }}
      />
      {draft ? (
        <button
          type="button"
          className="iw-search-clear"
          onClick={clear}
          aria-label="清空搜索"
          title="清空搜索"
          data-testid="iw-search-clear"
        >
          ×
        </button>
      ) : null}
      {value ? (
        <span className="iw-result-count iw-search-count" style={{ position: 'absolute', right: 34, top: 7, fontSize: 12 }}>
          {resultCount} / {totalCount}
        </span>
      ) : null}
    </div>
  );
}
