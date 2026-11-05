/**
 * 信息汇总工作台 · 多字段筛选面板（PRD 5.4 / AC-10）
 * 多条件 AND 组合；同字段多选为 OR（分类为选项级匹配）；支持一键清空与筛选方案。
 *
 * v3：电子版 / 纸质版 由「是 / 否」布尔改为「有 / 没有 / 不确定」三态多选；
 *     「电子版缺码」筛选组随字段一并移除。
 *
 * v5（R5）：「电子版」「纸质版」两个下拉合并为单个「拥有形态」多选
 *     （电子版 / 纸质版 / 任意拥有）。语义为「包含」——选中的形态必须都有；
 *     「任意拥有」= 拥有形态非空。
 */

import { useMemo, useState } from 'react';
import type { Filters, Schema } from '../../types';
import { EMPTY_FILTERS } from '../../types';
import { hasActiveFilters } from '../../store/selectors';
import {
  OWNERSHIP_ANY, OWNERSHIP_NONE, OWNERSHIP_FORMAT_OPTIONS, PAPER_SIZE_LETTER_TAGS, PAPER_SIZE_HEIGHT_TAGS,
} from '../../schema';

interface Props {
  filters: Filters;
  schema: Schema;
  onChange: (filters: Filters) => void;
  onClear: () => void;
  presets: Array<{ id: string; name: string; filters: Filters }>;
  onApplyPreset: (id: string) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  /** v6.2（需求 1）：可选中的计划清单（value = 清单 ID，展示为清单名称） */
  plans?: Array<{ id: string; name: string }>;
  /**
   * v6.5（需求 2/3）：各字段的当前录入候选（设置页增删后即时同步到此）。
   * 键为字段 jsonKey（品牌 / 款式 / 电子版尺码 / 纸质版尺码 …）。
   */
  candidates?: Record<string, string[]>;
}

function optionsOf(schema: Schema, key: string): string[] {
  return schema.fields.find((f) => f.key === key)?.options ?? [];
}

/** 候选集优先（设置页增删后即时生效），为空时回落 schema 内置选项 */
function pickCandidates(candidates: Record<string, string[]> | undefined, key: string, fallback: string[]): string[] {
  const list = candidates?.[key];
  return list && list.length ? list : fallback;
}

export function FilterPanel(props: Props) {
  const { filters, schema, onChange, onClear, presets, onApplyPreset, onSavePreset, onDeletePreset, plans, candidates } = props;
  const [open, setOpen] = useState(false);
  const [presetName, setPresetName] = useState('');

  // v6.5（需求 2）：品牌 / 款式的筛选项跟随设置页「字段选项管理」即时增删
  const brandOptions = useMemo(
    () => pickCandidates(candidates, '品牌', optionsOf(schema, '品牌')),
    [candidates, schema],
  );
  const styleOptions = useMemo(
    () => pickCandidates(candidates, '款式', optionsOf(schema, '款式')),
    [candidates, schema],
  );
  // v5（R5）：两个旧下拉合并为一个「拥有形态」多选；「任意拥有」「均没有」是筛选项而非数据取值
  const ownershipFilterOptions = useMemo(() => {
    const fromSchema = optionsOf(schema, '拥有形态');
    const base = fromSchema.length ? fromSchema : OWNERSHIP_FORMAT_OPTIONS;
    const withAny = base.includes(OWNERSHIP_ANY) ? base : [...base, OWNERSHIP_ANY];
    // v6.5（需求 5）：追加「均没有」—— 既未勾电子版、也未勾纸质版
    return withAny.includes(OWNERSHIP_NONE) ? withAny : [...withAny, OWNERSHIP_NONE];
  }, [schema]);
  // v6.5（需求 4）：筛选项改名为「尺码」，命中口径为「电子版尺码 或 纸质版尺码 任一含有该尺码」；
  // 选项集取两个尺码字段候选的并集（设置页增删后即时同步）；
  // 旧筛选方案里遗留的旧「尺码组」取值（女士全码 等）也一并展示为可点除的标签
  const esizeFilterOptions = useMemo(() => {
    const base = [
      ...pickCandidates(candidates, '电子版尺码', [...PAPER_SIZE_LETTER_TAGS, ...PAPER_SIZE_HEIGHT_TAGS]),
      ...pickCandidates(candidates, '纸质版尺码', []),
    ];
    const merged = Array.from(new Set(base));
    const extra = (filters.电子版尺码 ?? []).filter((o) => !merged.includes(o));
    return [...merged, ...extra];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, filters.电子版尺码]);

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

  const chips = (key: keyof Filters, options: string[], groupLabel?: string) => (
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
            aria-label={groupLabel ? `${groupLabel}：${opt}` : undefined}
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
              {chips('品牌', brandOptions.length ? brandOptions : ['（连接数据仓后可选）'], '品牌')}
            </div>
            <div>
              <div className="iw-filter-block-title">分类</div>
              {chips('分类', optionsOf(schema, '分类'))}
            </div>
            <div>
              <div className="iw-filter-block-title">款式</div>
              {chips('款式', styleOptions.length ? styleOptions : ['（连接数据仓后可选）'], '款式')}
            </div>
            <div>
              <div className="iw-filter-block-title">季节</div>
              {chips('季节', optionsOf(schema, '季节'))}
            </div>
            <div>
              <div className="iw-filter-block-title">教程</div>
              {chips('教程', optionsOf(schema, '教程'), '教程')}
            </div>
            {/* v6.4（需求 7）：筛选面板移除「推荐」「计划」入口（旧筛选方案 / 旧 URL 仍可解析，只是不再展示） */}
            {/* v6.5（需求 4）：标题由「电子版尺码」改为「尺码」，命中口径为电子版或纸质版任一含有 */}
            <div>
              <div className="iw-filter-block-title">尺码</div>
              {chips('电子版尺码', esizeFilterOptions, '尺码')}
            </div>
            <div>
              <div className="iw-filter-block-title">拥有形态</div>
              {chips('拥有形态', ownershipFilterOptions, '拥有形态')}
            </div>
            {/* v6.2（需求 1）：按计划清单筛选 —— value 为清单 ID，OR 语义 */}
            <div>
              <div className="iw-filter-block-title">计划清单</div>
              {plans && plans.length ? (
                <div className="iw-chip-group">
                  {plans.map((plan) => {
                    const list = (filters.计划清单 as string[]) ?? [];
                    const on = list.includes(plan.id);
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        className={`iw-chip${on ? ' iw-chip-on' : ''}`}
                        onClick={() => toggleMulti('计划清单', plan.id)}
                        aria-pressed={on}
                        aria-label={`计划清单：${plan.name}`}
                      >
                        {plan.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="iw-cell-muted">还没有计划清单（可在「设置 › 计划清单」创建）</div>
              )}
            </div>
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
