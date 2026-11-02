/**
 * 信息汇总工作台 · 录入 / 编辑表单（PRD 5.1 / 5.2 / AC-6 / AC-7）
 * 表单控件由 schema.json 驱动（架构 3.3）：枚举一律下拉/多选，杜绝手写变体。
 * 必填仅「名称」「品牌」两项。
 */

import { useMemo, useState } from 'react';
import { useApp } from '../../store/store';
import { navigate } from '../../router';
import type { FieldDef, RecordItem } from '../../types';

interface Props {
  recordId: number | null;
}

export function EditorForm({ recordId }: Props) {
  const app = useApp();
  const { filters, query, sort } = app;
  const existing = recordId === null ? null : app.records.find((r) => r.id === recordId) ?? null;

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    if (!existing) {
      const init: Record<string, unknown> = {};
      for (const f of app.schema.fields) {
        if (f.system) continue;
        init[f.jsonKey] = f.type === 'multi' || f.type === 'tags' || f.type === 'refs' ? []
          : f.type === 'boolean' ? false
            : f.type === 'enum' && f.options?.length ? f.options[f.options.length - 1] : '';
      }
      return init;
    }
    const init: Record<string, unknown> = {};
    for (const f of app.schema.fields) {
      init[f.jsonKey] = (existing as unknown as Record<string, unknown>)[f.jsonKey];
    }
    return init;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tagDraft, setTagDraft] = useState('');

  const editableFields = useMemo(
    () => app.schema.fields.filter((f) => !f.system && !f.readonly),
    [app.schema.fields],
  );

  const setValue = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    for (const f of editableFields) {
      const v = values[f.jsonKey];
      if (f.required) {
        const empty = v === '' || v === undefined || v === null
          || (Array.isArray(v) && v.length === 0);
        if (empty) next[f.jsonKey] = `「${f.label}」为必填项`;
      }
      if (f.type === 'enum' && v && f.options?.length && !f.options.includes(String(v))) {
        next[f.jsonKey] = `「${f.label}」只能从已有选项中选择`;
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = () => {
    if (!validate()) {
      const first = document.querySelector('.iw-field-error') as HTMLElement | null;
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const payload = { ...values } as Partial<RecordItem>;
    if (existing) {
      app.actions.updateRecord(existing.id, payload);
      navigate({ view: 'detail', id: existing.id, filters, query, sort });
    } else {
      const newId = app.actions.addRecord(payload);
      navigate({ view: 'detail', id: newId, filters, query, sort });
    }
  };

  const renderControl = (f: FieldDef) => {
    const value = values[f.jsonKey];
    switch (f.type) {
      case 'enum': {
        const options = f.options ?? [];
        if (f.allowNew) {
          return (
            <>
              <select
                className="iw-select"
                value={options.includes(String(value)) ? String(value) : '__custom__'}
                onChange={(e) => {
                  if (e.target.value === '__custom__') setValue(f.jsonKey, '');
                  else setValue(f.jsonKey, e.target.value);
                }}
              >
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
                <option value="__custom__">＋ 其他（手动输入）</option>
              </select>
              {!options.includes(String(value)) ? (
                <input
                  className="iw-input"
                  style={{ marginTop: 8 }}
                  placeholder={`输入新的${f.label}`}
                  value={String(value ?? '')}
                  onChange={(e) => setValue(f.jsonKey, e.target.value)}
                />
              ) : null}
            </>
          );
        }
        return (
          <select
            className="iw-select"
            value={String(value ?? '')}
            onChange={(e) => setValue(f.jsonKey, e.target.value)}
          >
            <option value="">（未填）</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      }
      case 'multi': {
        const list = (value as string[]) ?? [];
        const options = f.options ?? [];
        const ordered = f.ordered ? options : options;
        return (
          <div className="iw-chip-group">
            {ordered.map((o) => (
              <button
                key={o}
                type="button"
                className={`iw-chip${list.includes(o) ? ' iw-chip-on' : ''}`}
                onClick={() => setValue(f.jsonKey, list.includes(o) ? list.filter((x) => x !== o) : [...list, o])}
                aria-pressed={list.includes(o)}
              >
                {o}
              </button>
            ))}
          </div>
        );
      }
      case 'boolean': {
        return (
          <div className="iw-checkbox-row">
            <input
              id={`bool-${f.jsonKey}`}
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => setValue(f.jsonKey, e.target.checked)}
            />
            <label htmlFor={`bool-${f.jsonKey}`}>{value ? '是' : '否'}</label>
          </div>
        );
      }
      case 'tags': {
        const list = (value as string[]) ?? [];
        return (
          <>
            <div className="iw-chip-group" style={{ marginBottom: 8 }}>
              {list.map((t) => (
                <span key={t} className="iw-chip iw-chip-on">
                  {t}
                  <button
                    type="button"
                    className="iw-btn iw-btn-ghost iw-btn-sm"
                    style={{ height: 18, padding: '0 4px' }}
                    onClick={() => setValue(f.jsonKey, list.filter((x) => x !== t))}
                    aria-label={`移除标签 ${t}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="iw-input"
                placeholder={`输入${f.label}后回车`}
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagDraft.trim()) {
                    e.preventDefault();
                    if (!list.includes(tagDraft.trim())) setValue(f.jsonKey, [...list, tagDraft.trim()]);
                    setTagDraft('');
                  }
                }}
              />
              <button
                className="iw-btn"
                type="button"
                onClick={() => {
                  if (tagDraft.trim() && !list.includes(tagDraft.trim())) setValue(f.jsonKey, [...list, tagDraft.trim()]);
                  setTagDraft('');
                }}
              >
                添加
              </button>
            </div>
          </>
        );
      }
      case 'text': {
        return f.long ? (
          <textarea
            className="iw-textarea"
            value={String(value ?? '')}
            onChange={(e) => setValue(f.jsonKey, e.target.value)}
          />
        ) : (
          <input
            className="iw-input"
            value={String(value ?? '')}
            onChange={(e) => setValue(f.jsonKey, e.target.value)}
          />
        );
      }
      default:
        return (
          <input
            className="iw-input"
            value={String(value ?? '')}
            onChange={(e) => setValue(f.jsonKey, e.target.value)}
          />
        );
    }
  };

  return (
    <>
      <div className="iw-page-head">
        <div>
          <h1 className="iw-page-title">{existing ? '编辑记录' : '新增记录'}</h1>
          <p className="iw-page-sub">
            {existing ? `#${existing.id} ${existing.名称}` : '带 * 的字段为必填项；枚举字段只能从选项中选择'}
          </p>
        </div>
        <div className="iw-actions-row">
          <button
            className="iw-btn"
            type="button"
            onClick={() => (existing
              ? navigate({ view: 'detail', id: existing.id, filters, query, sort })
              : navigate({ view: 'list', filters, query, sort }))}
          >
            取消
          </button>
          <button className="iw-btn iw-btn-primary" type="button" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>

      <div className="iw-settings-card" style={{ maxWidth: 'none' }}>
        <div className="iw-form-grid">
          {editableFields.map((f) => (
            <div key={f.jsonKey} className={`iw-field${f.long ? ' iw-span-2' : ''}`}>
              <label className="iw-label" htmlFor={`fld-${f.jsonKey}`}>
                {f.label}
                {f.required ? <span className="iw-req">*</span> : null}
              </label>
              {renderControl(f)}
              {errors[f.jsonKey] ? (
                <div className="iw-field-error">{errors[f.jsonKey]}</div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="iw-actions-row" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
          <button
            className="iw-btn"
            type="button"
            onClick={() => (existing
              ? navigate({ view: 'detail', id: existing.id, filters, query, sort })
              : navigate({ view: 'list', filters, query, sort }))}
          >
            取消
          </button>
          <button className="iw-btn iw-btn-primary" type="button" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </>
  );
}
