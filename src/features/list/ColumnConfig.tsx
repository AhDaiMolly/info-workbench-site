/**
 * 信息汇总工作台 · 显示列配置（PRD 5.3 / AC-9）
 * 个人配置显示列并持久记忆（存 localStorage 的 iw.prefs）。
 */

import { useState } from 'react';
import type { Schema } from '../../types';
import { DEFAULT_VISIBLE_COLUMNS, DERIVED_LIST_COLUMNS } from '../../schema';

interface Props {
  schema: Schema;
  visible: string[];
  onChange: (columns: string[]) => void;
}

/**
 * 列表可选列（系统字段与多值标签不进列表，避免表格过宽）。
 *
 * v5（R1）：默认列收敛到 8 列；「形态」「标记」是派生列（由拥有形态 / 计划-做过-推荐渲染），
 * 不在 schema.fields 里，因此这里单独放行。
 * 其余字段（电子版尺码 / 纸质版尺码 / 备注 / 推荐 / 做过 / 计划 / 拥有形态）仍可按需勾选。
 */
const LIST_COLUMNS = [
  '名称', '品牌', '分类', '款式', '季节', '形态', '教程', '标记',
  '拥有形态', '电子版尺码', '纸质版尺码', '推荐', '做过', '计划', '备注',
];

export function ColumnConfig({ schema, visible, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const effective = visible.length ? visible : DEFAULT_VISIBLE_COLUMNS;

  const toggle = (key: string) => {
    const next = effective.includes(key)
      ? effective.filter((c) => c !== key)
      : [...effective, key];
    onChange(next.length ? next : DEFAULT_VISIBLE_COLUMNS);
  };

  const available = LIST_COLUMNS.filter(
    (c) => DERIVED_LIST_COLUMNS.includes(c) || schema.fields.some((f) => f.key === c),
  );

  return (
    <div style={{ position: 'relative' }}>
      <button className="iw-btn iw-btn-sm" type="button" onClick={() => setOpen((v) => !v)}>
        显示列
      </button>
      {open ? (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 30 }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="iw-settings-card"
            style={{
              position: 'absolute',
              right: 0,
              top: 34,
              zIndex: 31,
              width: 280,
              maxWidth: '80vw',
              margin: 0,
              padding: 16,
              boxShadow: '0 10px 30px rgba(16,18,22,0.14)',
            }}
          >
            <div className="iw-filter-block-title">勾选要显示的列</div>
            <div className="iw-chip-group">
              {available.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`iw-chip${effective.includes(c) ? ' iw-chip-on' : ''}`}
                  onClick={() => toggle(c)}
                  aria-pressed={effective.includes(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                className="iw-btn iw-btn-sm iw-btn-ghost"
                type="button"
                onClick={() => onChange(DEFAULT_VISIBLE_COLUMNS)}
              >
                恢复默认
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
