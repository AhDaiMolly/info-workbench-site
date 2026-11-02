/**
 * 信息汇总工作台 · 多字段筛选面板（PRD 5.4 / AC-10）
 * 多条件 AND 组合；同字段多选为 OR（分类为选项级匹配）；支持一键清空与筛选方案。
 */

import { useMemo, useState } from 'react';
import type { Filters, Schema } from '../../types';
import { EMPTY_FILTERS } from '../../types';
import { hasActiveFilters } from '../../store/selectors';

interface Props {
  filters: Filters;
  schema: Schema;
  onChange: (filters: Filters) => void;
  onClear: () => void;
  presets: Array<{ id: string; name: string; filters: Filters }>;
  onApplyPreset: (id: string) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
}

function optionsOf(schema: Schema, key: string): string[] {
  return schema.fields.find((f) => f.key === key)?.options ?? [];
}

export function FilterPanel(props: Props) {
  const { filters, schema, onChange, onClear, presets, onApplyPreset, onSavePreset, onDeletePreset } = props;
  const [open, setOpen] = useState(false);
  const [presetName, setPresetName] = useState('');

  const brandOptions = useMemo(() => optionsOf(schema, '品牌'), [schema]);
  const styleOptions = useMemo(() => optionsOf(schema, '款式'), [schema]);

  const activeCount = Object.entries(filters).reduce((acc, [k, v]) => {
    if (Array.isArray(v)) return acc + v.length;
    return acc + (v === undefined ? 0 : 1);
  }, 0);

  const toggleMulti = (key: keyof Filters, value: string) => {
    const list = (filters[key] as string[]) ?? [];
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    onChange({ ...filters, [key]: next } as Filters);
  };

  const toggleBool = (key: keyof Filters, value: boolean) => {
    onChange({ ...filters, [key]: filters[key] === value ? undefined : value } as Filters);
  };

  const chips = (key: keyof Filters, options: string[]) => (
    <div className="iw-chip-group">
      {options.map((opt) => {
        const list = (filters[key] as string[]) ?? [];
        return (
          <button
            key={opt}
            type="button"
            className={`iw-chip${list.includes(opt) ? ' iw-chip-on' : ''}`}
            onClick={() => toggleMulti(key, opt)}
            aria-pressed={list.includes(opt)}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );

  const boolGroup = (key: keyof Filters, label: string) => (
    <div>
      <div className="iw-filter-block-title">{label}</div>
      <div className="iw-chip-group">
        {[{ v: true, t: '是' }, { v: false, t: '否' }].map(({ v, t }) => (
          <button
            key={t}
            type="button"
            className={`iw-chip${filters[key] === v ? ' iw-chip-on' : ''}`}
            onClick={() => toggleBool(key, v)}
            aria-pressed={filters[key] === v}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="iw-filter-panel">
      <div className="iw-toolbar" style={{ marginBottom: open ? 16 : 0 }}>
        <button className="iw-btn iw-btn-sm" type="button" onClick={() => setOpen((v) => !v)}>
          {open ? '收起筛选条件' : `筛选条件${activeCount ? `（${activeCount}）` : ''}`}
        </button>
        <button
          className="iw-btn iw-btn-sm iw-btn-ghost"
          type="button"
          onClick={onClear}
          disabled={!hasActiveFilters(filters)}
        >
          清空条件
        </button>
        <div style={{ flex: 1 }} />
        {presets.map((p) => (
          <span key={p.id} className="iw-chip-group">
            <button type="button" className="iw-chip" onClick={() => onApplyPreset(p.id)}>
              {p.name}
            </button>
            <button
              type="button"
              className="iw-btn iw-btn-ghost iw-btn-sm"
              onClick={() => onDeletePreset(p.id)}
              aria-label={`删除筛选方案 ${p.name}`}
              title="删除该筛选方案"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {open ? (
        <>
          <div className="iw-filter-grid">
            <div>
              <div className="iw-filter-block-title">品牌</div>
              {chips('品牌', brandOptions.length ? brandOptions : ['（连接数据仓后可选）'])}
            </div>
            <div>
              <div className="iw-filter-block-title">分类</div>
              {chips('分类', optionsOf(schema, '分类'))}
            </div>
            <div>
              <div className="iw-filter-block-title">款式</div>
              {chips('款式', styleOptions.length ? styleOptions : ['（连接数据仓后可选）'])}
            </div>
            <div>
              <div className="iw-filter-block-title">季节</div>
              {chips('季节', optionsOf(schema, '季节'))}
            </div>
            <div>
              <div className="iw-filter-block-title">教程</div>
              {chips('教程', optionsOf(schema, '教程'))}
            </div>
            <div>
              <div className="iw-filter-block-title">推荐</div>
              {chips('推荐', optionsOf(schema, '推荐'))}
            </div>
            <div>
              <div className="iw-filter-block-title">想做</div>
              {chips('想做', optionsOf(schema, '想做'))}
            </div>
            <div>
              <div className="iw-filter-block-title">电子版尺码组</div>
              {chips('电子版尺码组', optionsOf(schema, '电子版尺码组'))}
            </div>
            {boolGroup('拥有电子版', '拥有电子版')}
            {boolGroup('拥有纸质版', '拥有纸质版')}
            {boolGroup('电子版缺码', '电子版缺码')}
            {boolGroup('做过', '做过')}
          </div>

          <div className="iw-toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
            <input
              className="iw-input"
              style={{ maxWidth: 220 }}
              placeholder="给当前条件起个名字"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              aria-label="筛选方案名称"
            />
            <button
              className="iw-btn iw-btn-sm"
              type="button"
              disabled={!presetName.trim() || !hasActiveFilters(filters)}
              onClick={() => { onSavePreset(presetName.trim()); setPresetName(''); }}
            >
              保存为筛选方案
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export { EMPTY_FILTERS };
