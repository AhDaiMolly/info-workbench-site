/**
 * 信息汇总工作台 · 录入 / 编辑表单（PRD 5.1 / 5.2 / AC-6 / AC-7）
 *
 * v3（需求 1）：版面改为五分区，与记录详情页共用同一套分区契约（src/sections.ts）：
 *   基础信息 / 拥有形态 / 状态及评价 / 备注 / 系统信息
 *   · 「系统信息」分区在表单页只读展示（记录ID / 创建时间 / 更新时间），不参与编辑与提交
 * v3（需求 5 / 6 / 7）：季节为下拉单选；电子版 / 纸质版由复选框改为下拉单选（有 / 没有 / 不确定）
 * v3：枚举字段的「空值默认」改为显式声明（schema.FIELD_DEFAULTS），不再取「最后一个选项」
 *
 * v5（R4 / R5）：
 *   · 「拥有形态」分区由两个下拉（电子版 / 纸质版）改为单个多选（0–2 项），空 = 两者皆无
 *   · 「纸质版尺码」新增录入快捷标签（字母码 XS–4XL / 身高码 100–180 步长 10），
 *     点选即填、仍可自由补充；历史 40 条记录原样保留
 */

import { useMemo, useState } from 'react';
import { useApp } from '../../store/store';
import { navigate } from '../../router';
import type { FieldDef, RecordItem } from '../../types';
import { defaultValueFor, PAPER_SIZE_HEIGHT_TAGS, PAPER_SIZE_LETTER_TAGS } from '../../schema';
import { buildSectionPlan } from '../../sections';

interface Props {
  recordId: number | null;
}

export function EditorForm({ recordId }: { recordId: number | null }) {
  const app = useApp();
  const { filters, query, sort } = app;
  const existing = recordId === null ? null : app.records.find((r) => r.id === recordId) ?? null;

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of app.schema.fields) {
      if (f.system) continue;
      if (!existing) {
        init[f.jsonKey] = defaultValueFor(f);
      } else {
        const v = (existing as unknown as Record<string, unknown>)[f.jsonKey];
        // 旧记录可能缺字段（数据仓尚未迁移）→ 用同一套默认值补齐，避免表单出现 undefined
        init[f.jsonKey] = v === undefined ? defaultValueFor(f) : v;
      }
    }
    return init;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tagDraft, setTagDraft] = useState('');
  // v6.2.1（需求 1/2）：新增表单里的清单勾选草稿 —— 新记录保存前没有记录 ID，
  // 成员关系先存本地，保存成功后由 store 的 addRecord(values, planIds) 一并写入。
  const [draftPlans, setDraftPlans] = useState<string[]>([]);

  // v3：分区与详情页一致；v6.4（需求 3）：「系统信息」分区不再展示（系统字段仍参与提交契约之外的数据层，仅不渲染）
  const sectionPlan = useMemo(
    () => buildSectionPlan(app.schema).filter((s) => s.title !== '系统信息'),
    [app.schema],
  );
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
      // v6.3（需求 2）：allowNew 枚举（品牌/款式）允许自由输入新值，不做选项集校验
      if (f.type === 'enum' && !f.allowNew && v && f.options?.length && !f.options.includes(String(v))) {
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
    // 系统字段不参与提交（只读）
    const payload: Record<string, unknown> = {};
    for (const f of editableFields) payload[f.jsonKey] = values[f.jsonKey];
    // v6.3（需求 2）：allowNew 枚举（品牌/款式）保存时把新值沉淀为录入候选 ——
    // 沉淀只影响后续录入的下拉选项，历史记录取值不受影响；已在候选里的值幂等跳过。
    for (const f of editableFields) {
      if (f.type !== 'enum' || !f.allowNew) continue;
      const raw = payload[f.jsonKey];
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      payload[f.jsonKey] = trimmed;
      if (trimmed) app.actions.addFieldOption(f.jsonKey, trimmed);
    }
    const typed = payload as Partial<RecordItem>;
    if (existing) {
      app.actions.updateRecord(existing.id, typed);
      navigate({ view: 'detail', id: existing.id, filters, query, sort });
    } else {
      // v6.2.1（需求 2）：新增时把表单里勾选的清单 ID 一并交给 store，
      // 由 addRecord 在拿到新记录 ID 的同一动作里写入成员关系（无悬空引用）。
      const newId = app.actions.addRecord(typed, draftPlans);
      // v4：store 层再兜一道 —— 名称为空时不会创建记录（不会产生空壳记录）
      if (newId === null) {
        setErrors({ 名称: '「名称」为必填项，未创建这条记录。' });
        return;
      }
      setDraftPlans([]);
      navigate({ view: 'detail', id: newId, filters, query, sort });
    }
  };

  const renderControl = (f: FieldDef) => {
    const value = values[f.jsonKey];
    switch (f.type) {
      case 'enum': {
        // v6.3（需求 2）：allowNew 枚举（品牌/款式）的候选用「schema 选项 ∪ 已沉淀 − 已删除」
        const options = f.allowNew
          ? app.optionCandidates?.[f.jsonKey] ?? f.options ?? []
          : f.options ?? [];
        if (f.allowNew) {
          return (
            <>
              <select
                className="iw-select"
                aria-label={f.label}
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
        // v3：枚举一律下拉单选（季节 / 拥有形态 / 教程 / 推荐 / 计划）
        return (
          <select
            className="iw-select"
            aria-label={f.label}
            id={`fld-${f.jsonKey}`}
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
        return (
          <div className="iw-chip-group" role="group" aria-label={f.label}>
            {options.map((o) => (
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
        // v5（R4）：纸质版尺码的录入快捷标签 —— 字母码 XS–4XL / 身高码 100–180（步长 10）
        // v6.1（需求 3）：电子版尺码由尺码组单选改为标签双轨，与纸质版共用同一套快捷标签交互。
        // 点选即填（再点一次取消），仍可自由补充；已迁移/已录入的历史标签原样保留。
        const quickGroups = ['纸质版尺码', '电子版尺码'].includes(f.key)
          ? [
            { label: '字母码', tags: PAPER_SIZE_LETTER_TAGS },
            { label: '身高码', tags: PAPER_SIZE_HEIGHT_TAGS },
          ]
          : [];
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
            {quickGroups.map((g) => (
              <div className="iw-quick-tags" key={g.label}>
                <span className="iw-quick-tags-label">{g.label}</span>
                <div className="iw-chip-group">
                  {g.tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`iw-chip iw-chip-quick${list.includes(t) ? ' iw-chip-on' : ''}`}
                      onClick={() => setValue(
                        f.jsonKey,
                        list.includes(t) ? list.filter((x) => x !== t) : [...list, t],
                      )}
                      aria-pressed={list.includes(t)}
                      aria-label={`${f.label} 快捷${g.label} ${t}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ))}
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
            aria-label={f.label}
            value={String(value ?? '')}
            onChange={(e) => setValue(f.jsonKey, e.target.value)}
          />
        ) : (
          <input
            className="iw-input"
            id={`fld-${f.jsonKey}`}
            value={String(value ?? '')}
            onChange={(e) => setValue(f.jsonKey, e.target.value)}
          />
        );
      }
      default:
        return (
          <input
            className="iw-input"
            aria-label={f.label}
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
            {/* v6.4（需求 3）：编辑表单头部不再展示记录编号 */}
            {existing ? `正在编辑：${existing.名称}` : '带 * 的字段为必填项；品牌、款式可直接输入新值并自动加入选项'}
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
        {sectionPlan.map((section) => (
          <div className="iw-form-section" key={section.title}>
            <div className="iw-detail-group-title">{section.title}</div>
            <div className="iw-form-grid">
              {section.fields
                  .filter((f) => !f.system && !f.readonly)
                  .map((f) => {
                    // v6（需求 3）：形态-尺码联动 —— 勾选「电子版」才展示电子版尺码，
                    // 勾选「纸质版」才展示纸质版尺码；都不选则都不展示。
                    // 取消勾选时已填的尺码「保留数据、仅隐藏输入」，并在原位给出提示（保存不会清除）。
                    const ownership = (values.拥有形态 as string[] | undefined) ?? [];
                    let linkedFormat: string | null = null;
                    if (f.jsonKey === '电子版尺码') linkedFormat = '电子版';
                    if (f.jsonKey === '纸质版尺码') linkedFormat = '纸质版';
                    if (linkedFormat && !ownership.includes(linkedFormat)) {
                      const v = values[f.jsonKey];
                      const hasFilled = Array.isArray(v)
                        ? v.length > 0
                        : v !== undefined && v !== null && String(v).trim() !== '';
                      return hasFilled ? (
                        <div key={f.jsonKey} className="iw-field iw-span-2">
                          <div className="iw-field-hint" data-testid={`iw-kept-${f.jsonKey}`}>
                            未勾选「{linkedFormat}」：已填的「{f.label}」已保留（保存不会清除），重新勾选后可继续编辑。
                          </div>
                        </div>
                      ) : null;
                    }
                    return (
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
                    );
                  })}
              </div>
          </div>
        ))}

        {/* v6.2.1（需求 1）：计划清单分区 —— 新增/编辑表单里直接勾选所属清单。
            · 编辑已有记录：chip 直连 store（toggleRecordInPlan），勾选即加入、取消即移出，即时生效
            · 新增记录：勾选先存本地草稿，保存成功后随新记录 ID 一并写入（不产生悬空成员引用） */}
        <div className="iw-form-section" data-testid="iw-form-plan-block">
          <div className="iw-detail-group-title">计划清单</div>
          {app.plans.length ? (
            <div className="iw-chip-group" data-testid="iw-form-plan-chips">
              {app.plans.map((plan) => {
                const on = existing
                  ? plan.记录ID列表.includes(existing.id)
                  : draftPlans.includes(plan.id);
                return (
                  <button
                    key={plan.id}
                    type="button"
                    className={`iw-chip${on ? ' iw-chip-on' : ''}`}
                    onClick={() => {
                      if (existing) {
                        app.actions.toggleRecordInPlan(plan.id, existing.id);
                      } else {
                        setDraftPlans((s) => (s.includes(plan.id) ? s.filter((x) => x !== plan.id) : [...s, plan.id]));
                      }
                    }}
                    aria-pressed={on}
                    aria-label={`计划清单：${plan.名称}`}
                    title={on ? '点击移出该清单' : '点击加入该清单'}
                  >
                    {plan.名称}（{plan.记录ID列表.length}）
                  </button>
                );
              })}
            </div>
          ) : (
            <div data-testid="iw-form-plan-empty">
              <div className="iw-cell-muted">还没有计划清单。先创建一份（如「2026 春季」），保存时就能把这条记录归进去。</div>
              <button
                className="iw-btn iw-btn-sm"
                type="button"
                data-testid="iw-form-plan-goto-settings"
                onClick={() => navigate({ view: 'settings', filters, query, sort })}
              >
                去设置页创建清单
              </button>
            </div>
          )}
          {app.plans.length ? (
            <div className="iw-field-hint" style={{ marginTop: 8 }}>
              {existing
                ? '点击清单名即可加入 / 移出，改动立即生效，并随下一次「同步到 GitHub」写回仓库。'
                : '勾选的清单会在保存成功后把这条新记录加进去（保存前记录还没有编号）。'}
            </div>
          ) : null}
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
