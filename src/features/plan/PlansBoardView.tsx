/**
 * 信息汇总工作台 · 计划清单总览（v6.7 需求 1~7）
 *
 * 一级页签「清单」（与列表 / 看板 / 设置齐平，#/plans）：
 *   · 需求 1：一级菜单新增「清单」页签
 *   · 需求 2：清单以模块形式依次排列，每两个清单平铺占一行
 *   · 需求 3：模块内直接列出清单里的记录
 *   · 需求 4：页签右上角「新增清单」，弹层里可像列表页一样筛选并挑选记录
 *   · 需求 5：每个模块右上角「编辑」「删除」
 *   · 需求 6：清单之间可拖拽调整排列顺序
 *   · 需求 7：清单内的记录可拖拽调整顺序
 *
 * 所有写操作都只改 plans.json（清单与成员关系），绝不删除 / 修改记录本身。
 */

import { useMemo, useState } from 'react';
import { useApp } from '../../store/store';
import { navigate } from '../../router';
import { Modal } from '../../components/Modal';
import type { RecordItem } from '../../types';

/** 挑选记录的列表最多直接渲染的条数（848+ 条全渲染会卡） */
const PICK_LIMIT = 100;

const COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

function recLabel(r: RecordItem): string {
  return `#${r.id} ${String(r.名称 ?? '')}`;
}

function uniqValues(records: RecordItem[], key: '分类' | '季节' | '品牌' | '款式'): string[] {
  const set = new Set<string>();
  for (const r of records) {
    const v = String(r[key] ?? '').trim();
    if (v) set.add(v);
  }
  return [...set].sort(COLLATOR.compare);
}

/** 「拥有形态」是多选字段：筛选项固定为 电子版 / 纸质版 + 任意拥有（非空） */
const OWN_OPTIONS = ['电子版', '纸质版', '任意拥有'] as const;

export function PlansBoardView() {
  const app = useApp();

  /* 新增清单弹层状态 */
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [pickQuery, setPickQuery] = useState('');
  const [pickCats, setPickCats] = useState<string[]>([]);
  const [pickSeasons, setPickSeasons] = useState<string[]>([]);
  const [pickBrands, setPickBrands] = useState<string[]>([]);
  const [pickStyles, setPickStyles] = useState<string[]>([]);
  const [ownFilter, setOwnFilter] = useState<string[]>([]);
  const [picked, setPicked] = useState<number[]>([]);

  /* 删除确认状态 */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* 拖拽状态 */
  const [dragPlanId, setDragPlanId] = useState<string | null>(null);
  const [dragOverPlanId, setDragOverPlanId] = useState<string | null>(null);
  const [dragMember, setDragMember] = useState<{ planId: string; recordId: number } | null>(null);
  const [dragOverMember, setDragOverMember] = useState<{ planId: string; recordId: number } | null>(null);

  const recordById = useMemo(() => {
    const m = new Map<number, RecordItem>();
    for (const r of app.records) m.set(r.id, r);
    return m;
  }, [app.records]);

  const totalMembers = useMemo(
    () => app.plans.reduce((sum, p) => sum + p.记录ID列表.length, 0),
    [app.plans],
  );

  /* ---------- 挑选记录：搜索 + 分类 / 款式 / 季节 / 品牌 / 拥有形态筛选（与列表页同类口径） ---------- */
  const catOptions = useMemo(() => uniqValues(app.records, '分类'), [app.records]);
  const seasonOptions = useMemo(() => uniqValues(app.records, '季节'), [app.records]);
  const brandOptions = useMemo(() => uniqValues(app.records, '品牌'), [app.records]);
  const styleOptions = useMemo(() => uniqValues(app.records, '款式'), [app.records]);

  const pickCandidates = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    const plain = q.replace(/^#/, '');
    const isId = /^\d+$/.test(plain);
    return app.records
      .filter((r) => {
        if (pickCats.length && !pickCats.includes(String(r.分类 ?? ''))) return false;
        if (pickSeasons.length && !pickSeasons.includes(String(r.季节 ?? ''))) return false;
        if (pickBrands.length && !pickBrands.includes(String(r.品牌 ?? ''))) return false;
        if (pickStyles.length && !pickStyles.includes(String(r.款式 ?? ''))) return false;
        if (ownFilter.length) {
          const own = Array.isArray(r.拥有形态) ? r.拥有形态.map((x) => String(x ?? '')) : [];
          // OR 语义：任一勾选项命中即可；「任意拥有」= 拥有形态非空
          const hit = ownFilter.some((o) => (o === '任意拥有' ? own.length > 0 : own.includes(o)));
          if (!hit) return false;
        }
        if (!q) return true;
        if (isId && String(r.id).includes(plain)) return true;
        if (String(r.名称 ?? '').toLowerCase().includes(q)) return true;
        if (String(r.品牌 ?? '').toLowerCase().includes(q)) return true;
        return false;
      })
      .sort((a, b) => COLLATOR.compare(String(a.名称 ?? ''), String(b.名称 ?? '')));
  }, [app.records, pickQuery, pickCats, pickSeasons, pickBrands, pickStyles, ownFilter]);

  const togglePick = (id: number) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const closeNewModal = () => {
    setNewOpen(false);
    setNewName('');
    setPickQuery('');
    setPickCats([]);
    setPickSeasons([]);
    setPickBrands([]);
    setPickStyles([]);
    setOwnFilter([]);
    setPicked([]);
  };

  const submitNewPlan = () => {
    const name = newName.trim();
    if (!name) return;
    app.actions.createPlanList(name, picked);
    closeNewModal();
  };

  /* ---------- 拖拽：清单之间重排 ---------- */
  const onPlanDrop = (targetId: string) => {
    const from = dragPlanId;
    setDragOverPlanId(null);
    setDragPlanId(null);
    if (!from || from === targetId) return;
    const ids = app.plans.map((p) => p.id);
    const fromIdx = ids.indexOf(from);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, from);
    app.actions.reorderPlanList(ids);
  };

  /* ---------- 拖拽：清单内成员重排 ---------- */
  const onMemberDrop = (planId: string, targetRecordId: number) => {
    const drag = dragMember;
    setDragOverMember(null);
    setDragMember(null);
    if (!drag || drag.planId !== planId || drag.recordId === targetRecordId) return;
    const plan = app.plans.find((p) => p.id === planId);
    if (!plan) return;
    const ids = plan.记录ID列表.slice();
    const fromIdx = ids.indexOf(drag.recordId);
    const toIdx = ids.indexOf(targetRecordId);
    if (fromIdx < 0 || toIdx < 0) return;
    // 目标位按「原数组」的下标计算 → 拖到谁身上就排到谁前面
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, drag.recordId);
    app.actions.reorderPlanMembers(planId, ids);
  };

  const deletingPlan = app.plans.find((p) => p.id === deletingId) ?? null;

  return (
    <div data-testid="iw-plans-view">
      <div className="iw-page-head">
        <div>
          <h1 className="iw-page-title">计划清单</h1>
          <p className="iw-page-sub">
            共 {app.plans.length} 份清单 · {totalMembers} 条成员记录 · 拖动模块或记录可调整顺序，改动随下一次同步写回数据仓。
          </p>
        </div>
        <div className="iw-actions-row">
          <button
            className="iw-btn iw-btn-primary"
            type="button"
            data-testid="iw-plans-new"
            onClick={() => setNewOpen(true)}
          >
            ＋ 新增清单
          </button>
        </div>
      </div>

      {app.plans.length === 0 ? (
        <div className="iw-settings-card">
          <div className="iw-field-hint" data-testid="iw-plans-empty">
            还没有清单。点右上角「＋ 新增清单」建一份，然后在弹层里筛选并挑选记录。
          </div>
        </div>
      ) : (
        <div className="iw-plans-grid" data-testid="iw-plans-grid">
          {app.plans.map((plan) => {
            const members = plan.记录ID列表
              .map((id) => recordById.get(id))
              .filter((r): r is RecordItem => Boolean(r));
            const isDragOver = dragOverPlanId === plan.id;
            return (
              <section
                key={plan.id}
                className={`iw-plan-card${isDragOver ? ' iw-plan-card-over' : ''}`}
                data-testid={`iw-plan-card-${plan.id}`}
              >
                <header className="iw-plan-card-head">
                  <span
                    className="iw-plan-handle"
                    draggable
                    data-testid={`iw-plan-drag-${plan.id}`}
                    title="拖动调整清单顺序"
                    onDragStart={(e) => {
                      setDragPlanId(plan.id);
                      e.dataTransfer?.setData('text/plain', plan.id);
                    }}
                    onDragEnd={() => { setDragPlanId(null); setDragOverPlanId(null); }}
                  >
                    ⠿
                  </span>
                  <h2 className="iw-plan-card-title" data-testid={`iw-plan-card-title-${plan.id}`}>
                    {plan.名称}
                  </h2>
                  <span className="iw-plan-card-count">{members.length} 条</span>
                  <span className="iw-plan-card-actions">
                    <button
                      className="iw-btn iw-btn-sm iw-btn-ghost"
                      type="button"
                      data-testid={`iw-plan-edit-${plan.id}`}
                      onClick={() => navigate({ view: 'plan', planId: plan.id, filters: app.filters, query: app.query, sort: app.sort })}
                    >
                      编辑
                    </button>
                    <button
                      className="iw-btn iw-btn-sm iw-btn-ghost"
                      type="button"
                      data-testid={`iw-plan-delete-${plan.id}`}
                      onClick={() => setDeletingId(plan.id)}
                    >
                      删除
                    </button>
                  </span>
                </header>
                <div
                  className="iw-plan-card-body"
                  data-testid={`iw-plan-card-body-${plan.id}`}
                  onDragOver={(e) => {
                    if (!dragPlanId || dragPlanId === plan.id) return;
                    e.preventDefault();
                    setDragOverPlanId(plan.id);
                  }}
                  onDrop={(e) => {
                    if (!dragPlanId) return;
                    e.preventDefault();
                    onPlanDrop(plan.id);
                  }}
                >
                  {members.length === 0 ? (
                    <div className="iw-field-hint" data-testid={`iw-plan-card-empty-${plan.id}`}>
                      空清单 · 点「编辑」添加记录
                    </div>
                  ) : (
                    <ul className="iw-plan-members" data-testid={`iw-plan-card-members-${plan.id}`}>
                      {members.map((r) => {
                        const isOver = dragOverMember?.planId === plan.id && dragOverMember.recordId === r.id;
                        return (
                          <li
                            key={r.id}
                            className={`iw-plan-member${isOver ? ' iw-plan-member-over' : ''}`}
                            data-testid={`iw-plan-card-row-${plan.id}-${r.id}`}
                            draggable
                            onDragStart={(e) => {
                              setDragMember({ planId: plan.id, recordId: r.id });
                              e.dataTransfer?.setData('text/plain', String(r.id));
                            }}
                            onDragEnd={() => { setDragMember(null); setDragOverMember(null); }}
                            onDragOver={(e) => {
                              if (!dragMember || dragMember.planId !== plan.id) return;
                              e.preventDefault();
                              setDragOverMember({ planId: plan.id, recordId: r.id });
                            }}
                            onDrop={(e) => {
                              if (!dragMember || dragMember.planId !== plan.id) return;
                              e.preventDefault();
                              onMemberDrop(plan.id, r.id);
                            }}
                            onClick={() => navigate({ view: 'detail', id: r.id, filters: app.filters, query: app.query, sort: app.sort })}
                          >
                            <span className="iw-plan-member-id">#{r.id}</span>
                            <span className="iw-plan-member-name">{String(r.名称 ?? '')}</span>
                            <span className="iw-plan-member-brand">{String(r.品牌 ?? '')}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* 新增清单：弹层里筛选并挑选记录 */}
      <Modal
        open={newOpen}
        title="新增清单"
        confirmText="创建清单"
        onConfirm={submitNewPlan}
        onCancel={closeNewModal}
      >
        <div className="iw-field">
          <label className="iw-label" htmlFor="iw-new-plan-name">清单名称</label>
          <input
            id="iw-new-plan-name"
            className="iw-input"
            data-testid="iw-new-plan-name"
            value={newName}
            placeholder="例如：2026 春季"
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <div className="iw-field">
          <label className="iw-label" htmlFor="iw-new-plan-search">筛选记录</label>
          <input
            id="iw-new-plan-search"
            className="iw-input"
            data-testid="iw-new-plan-search"
            value={pickQuery}
            placeholder="搜索名称、品牌、编号…"
            onChange={(e) => setPickQuery(e.target.value)}
          />
        </div>
        <div className="iw-field">
          <span className="iw-label">分类</span>
          <div className="iw-chip-group" data-testid="iw-new-plan-cats">
            {catOptions.map((c) => (
              <button
                key={c}
                type="button"
                className={`iw-chip${pickCats.includes(c) ? ' iw-chip-on' : ''}`}
                data-testid={`iw-new-plan-cat-${c}`}
                aria-pressed={pickCats.includes(c)}
                onClick={() => setPickCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="iw-field">
          <span className="iw-label">季节</span>
          <div className="iw-chip-group" data-testid="iw-new-plan-seasons">
            {seasonOptions.map((s) => (
              <button
                key={s}
                type="button"
                className={`iw-chip${pickSeasons.includes(s) ? ' iw-chip-on' : ''}`}
                data-testid={`iw-new-plan-season-${s}`}
                aria-pressed={pickSeasons.includes(s)}
                onClick={() => setPickSeasons((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        {brandOptions.length > 0 && (
          <div className="iw-field">
            <span className="iw-label">品牌</span>
            <div className="iw-chip-group" data-testid="iw-new-plan-brands">
              {brandOptions.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`iw-chip${pickBrands.includes(b) ? ' iw-chip-on' : ''}`}
                  data-testid={`iw-new-plan-brand-${b}`}
                  aria-pressed={pickBrands.includes(b)}
                  onClick={() => setPickBrands((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]))}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        )}
        {styleOptions.length > 0 && (
          <div className="iw-field">
            <span className="iw-label">款式</span>
            <div className="iw-chip-group" data-testid="iw-new-plan-styles">
              {styleOptions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`iw-chip${pickStyles.includes(s) ? ' iw-chip-on' : ''}`}
                  data-testid={`iw-new-plan-style-${s}`}
                  aria-pressed={pickStyles.includes(s)}
                  onClick={() => setPickStyles((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="iw-field">
          <span className="iw-label">拥有形态</span>
          <div className="iw-chip-group" data-testid="iw-new-plan-owns">
            {OWN_OPTIONS.map((o) => (
              <button
                key={o}
                type="button"
                className={`iw-chip${ownFilter.includes(o) ? ' iw-chip-on' : ''}`}
                data-testid={`iw-new-plan-own-${o}`}
                aria-pressed={ownFilter.includes(o)}
                onClick={() => setOwnFilter((prev) => (prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]))}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
        <div className="iw-field">
          <span className="iw-label">
            挑选记录（已选 {picked.length} 条）
          </span>
          <div className="iw-plan-picker" data-testid="iw-new-plan-list">
            {pickCandidates.length === 0 ? (
              <div className="iw-field-hint">没有符合条件的记录。</div>
            ) : (
              <>
                <div className="iw-field-hint">
                  共 {pickCandidates.length} 条符合条件，已显示前 {Math.min(PICK_LIMIT, pickCandidates.length)} 条 —— 收窄搜索词或筛选条件可看到更多。
                </div>
                {pickCandidates.slice(0, PICK_LIMIT).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`iw-plan-pick${picked.includes(r.id) ? ' iw-plan-pick-on' : ''}`}
                    data-testid={`iw-new-plan-pick-${r.id}`}
                    aria-pressed={picked.includes(r.id)}
                    onClick={() => togglePick(r.id)}
                  >
                    <span className="iw-plan-member-id">#{r.id}</span>
                    <span className="iw-plan-member-name">{String(r.名称 ?? '')}</span>
                    <span className="iw-plan-member-brand">{String(r.品牌 ?? '')}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      </Modal>

      {/* 删除清单：二次确认，只解除成员关联 */}
      <Modal
        open={Boolean(deletingPlan)}
        title="删除清单"
        confirmText="删除清单"
        danger
        onConfirm={() => {
          if (deletingId) app.actions.deletePlanList(deletingId);
          setDeletingId(null);
        }}
        onCancel={() => setDeletingId(null)}
      >
        <p>
          确定删除清单「{deletingPlan?.名称 ?? ''}」吗？<b>只解除记录关联</b>，清单里的记录本身不会被删除或修改。
        </p>
      </Modal>
    </div>
  );
}
