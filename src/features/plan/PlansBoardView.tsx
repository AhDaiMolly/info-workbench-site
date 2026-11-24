/**
 * 信息汇总工作台 · 计划清单总览（v6.7 需求 1~7）
 *
 * 一级页签「清单」（与列表 / 看板 / 设置齐平，#/plans）：
 *   · 需求 1：一级菜单新增「清单」页签
 *   · 需求 2：清单以模块形式依次排列，每两个清单平铺占一行
 *   · 需求 3：模块内直接列出清单里的记录
 *   · 需求 5：每个模块右上角「删除」（v6.8 移除「编辑」入口）
 *   · 需求 6：清单之间可拖拽调整排列顺序
 *   · 需求 7：清单内的记录可拖拽调整顺序
 *
 * v6.8 变更：
 *   · 需求 2：模块内条目支持「移出清单」——右键菜单 + 悬停 × 按钮两个入口（只改成员关系）
 *   · 需求 3：移除模块右上角「编辑」入口（删除保留，仍二次确认）
 *   · 需求 4：清单名称后加编辑图标，点击只允许重命名该清单
 *
 * v6.9 变更：
 *   · 需求 1：「新增清单」弹层简化为只填清单名称（新清单为空清单）
 *   · 需求 2：每个清单模块新增「＋ 添加记录」入口，跳转 #/plan-add/:id
 *     —— 与列表页同款布局的挑选页（搜索 / 筛选 / 多选 / 已在清单置灰）
 *   · 需求 4：条目上提供「移出」按钮（右键菜单「移出清单」保留）
 *   · 需求 5：条目右键菜单新增「加入其他清单…」—— 迁移语义（加入目标并从当前移出）
 *   · 需求 6：移除 v6.8 的条目悬停「×」移除按钮（移出入口统一为右键菜单与「移出」按钮）
 *
 * v6.9.2 变更（拖拽修复）：
 *   · 拖拽只从明确手柄发起：模块手柄（⠿）与条目手柄（⠿）可拖，模块标题、条目名等
 *     文本内容不再 draggable —— 按住文本拖动只做原生文本选择（可复制），不触发拖拽；
 *   · 视图根节点捕获 dragstart：非手柄发起的拖拽（含选中文本的浏览器默认拖拽）
 *     一律 preventDefault 取消，杜绝「松开鼠标以搜索文本」/ 弹搜索页；
 *   · 模块整卡（含头部）都是落点，拖拽预览用整卡/整行快照（setDragImage）。
 *
 * 所有写操作都只改 plans.json（清单与成员关系），绝不删除 / 修改记录本身。
 */

import { useMemo, useState } from 'react';
import { useApp } from '../../store/store';
import { navigate } from '../../router';
import { Modal } from '../../components/Modal';
import type { RecordItem } from '../../types';

function recLabel(r: RecordItem): string {
  return `#${r.id} ${String(r.名称 ?? '')}`;
}

export function PlansBoardView() {
  const app = useApp();

  /* 新增清单弹层状态（v6.9：只需名称） */
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');

  /* 删除确认状态 */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* v6.8（需求 4）：重命名清单目标 —— 清单名后的编辑图标只做重命名 */
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);

  /* 条目右键菜单（v6.8：移出清单；v6.9：加入其他清单） */
  const [ctxMenu, setCtxMenu] = useState<{ planId: string; recordId: number; x: number; y: number } | null>(null);

  /* v6.9（需求 5）：「加入其他清单」迁移弹层目标（来源清单 + 记录） */
  const [moveTarget, setMoveTarget] = useState<{ fromPlanId: string; recordId: number } | null>(null);

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

  const closeNewModal = () => {
    setNewOpen(false);
    setNewName('');
  };

  /* v6.9（需求 1）：新增清单只需名称，创建为空清单；成员经「＋ 添加记录」挑选页补充 */
  const submitNewPlan = () => {
    const name = newName.trim();
    if (!name) return;
    app.actions.createPlanList(name);
    closeNewModal();
  };

  const deletingPlan = app.plans.find((p) => p.id === deletingId) ?? null;

  /* v6.9（需求 5）：迁移目标候选 —— 排除该记录已在的所有清单（含当前清单） */
  const moveCandidates = useMemo(() => {
    if (!moveTarget) return [];
    const rec = recordById.get(moveTarget.recordId);
    if (!rec) return [];
    return app.plans.filter((p) => !p.记录ID列表.includes(moveTarget.recordId));
  }, [moveTarget, app.plans, recordById]);

  return (
    <div
      data-testid="iw-plans-view"
      onDragStartCapture={(e) => {
        // v6.9.2：本页签内只允许从明确手柄发起拖拽。模块标题 / 条目名等文本被按住拖动时，
        // 浏览器会把选中文字当拖拽负载（松手触发「搜索文本」），这里统一 cancel 掉：
        // 拖拽被取消，但文本选择仍然保留，可正常复制。
        const t = e.target as HTMLElement | null;
        if (!t || !t.closest('.iw-plan-handle, .iw-plan-member-handle')) e.preventDefault();
      }}
    >
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
            还没有清单。点右上角「＋ 新增清单」建一份（只需名称），再在模块里点「＋ 添加记录」挑选记录。
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
                onDragOver={(e) => {
                  if (!dragPlanId || dragPlanId === plan.id) return;
                  e.preventDefault();
                  e.dataTransfer && (e.dataTransfer.dropEffect = 'move');
                  setDragOverPlanId(plan.id);
                }}
                onDragLeave={(e) => {
                  const rt = e.relatedTarget as Node | null;
                  if (rt && e.currentTarget.contains(rt)) return;
                  if (dragOverPlanId === plan.id) setDragOverPlanId(null);
                }}
                onDrop={(e) => {
                  if (!dragPlanId) return;
                  e.preventDefault();
                  onPlanDrop(plan.id);
                }}
              >
                <header className="iw-plan-card-head">
                  <span
                    className="iw-plan-handle"
                    draggable
                    data-testid={`iw-plan-drag-${plan.id}`}
                    title="拖动调整清单顺序"
                    onDragStart={(e) => {
                      setDragPlanId(plan.id);
                      if (e.dataTransfer) {
                        e.dataTransfer.setData('text/plain', plan.id);
                        e.dataTransfer.effectAllowed = 'move';
                        // v6.9.2：拖拽预览显示整卡快照，而非只有手柄图标
                        e.dataTransfer.setDragImage(e.currentTarget.closest('.iw-plan-card') ?? e.currentTarget, 24, 24);
                      }
                    }}
                    onDragEnd={() => { setDragPlanId(null); setDragOverPlanId(null); }}
                  >
                    ⠿
                  </span>
                  <h2 className="iw-plan-card-title" data-testid={`iw-plan-card-title-${plan.id}`}>
                    {plan.名称}
                  </h2>
                  {/* v6.8（需求 4）：清单名后的编辑图标 —— 只允许重命名该清单 */}
                  <button
                    className="iw-btn iw-btn-sm iw-btn-ghost iw-plan-card-rename"
                    type="button"
                    data-testid={`iw-plan-card-rename-${plan.id}`}
                    aria-label={`重命名清单：${plan.名称}`}
                    title={`重命名清单：${plan.名称}`}
                    onClick={() => setRenameTarget({ id: plan.id, name: plan.名称 })}
                  >
                    ✎
                  </button>
                  <span className="iw-plan-card-count">{members.length} 条</span>
                  <span className="iw-plan-card-actions">
                    {/* v6.9（需求 2）：模块「＋ 添加记录」—— 跳转与列表页同款布局的挑选页 */}
                    <button
                      className="iw-btn iw-btn-sm"
                      type="button"
                      data-testid={`iw-plan-card-add-${plan.id}`}
                      title={`往「${plan.名称}」添加记录`}
                      onClick={() => navigate({ view: 'plan-add', planId: plan.id })}
                    >
                      ＋ 添加记录
                    </button>
                    {/* v6.8（需求 3）：移除「编辑」入口，仅保留「删除」（二次确认，只解除关联） */}
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
                {/* v6.9.2：模块落点提升到整卡 section（含头部）；此处正文不再承担落点职责 */}
                <div
                  className="iw-plan-card-body"
                  data-testid={`iw-plan-card-body-${plan.id}`}
                >
                  {members.length === 0 ? (
                    <div className="iw-field-hint" data-testid={`iw-plan-card-empty-${plan.id}`}>
                      空清单 · 点模块右上「＋ 添加记录」去挑选页批量加入
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
                            onContextMenu={(e) => {
                              // v6.8（需求 2）+ v6.9（需求 5）：条目右键菜单含「移出清单」与「加入其他清单」
                              e.preventDefault();
                              setCtxMenu({ planId: plan.id, recordId: r.id, x: e.clientX, y: e.clientY });
                            }}
                          >
                            {/* v6.9.2：条目拖拽只绑在明确手柄上，行内文本可选中复制、不再参与拖拽 */}
                            <span
                              className="iw-plan-member-handle"
                              draggable
                              data-testid={`iw-plan-member-drag-${plan.id}-${r.id}`}
                              title="拖动调整记录顺序"
                              onDragStart={(e) => {
                                setDragMember({ planId: plan.id, recordId: r.id });
                                if (e.dataTransfer) {
                                  e.dataTransfer.setData('text/plain', String(r.id));
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setDragImage(e.currentTarget.parentElement ?? e.currentTarget, 12, 12);
                                }
                              }}
                              onDragEnd={() => { setDragMember(null); setDragOverMember(null); }}
                            >
                              ⠿
                            </span>
                            <span className="iw-plan-member-id">#{r.id}</span>
                            <span className="iw-plan-member-name">{String(r.名称 ?? '')}</span>
                            <span className="iw-plan-member-brand">{String(r.品牌 ?? '')}</span>
                            {/* v6.9.1：常显「移出」按钮已删除，移出统一走条目右键菜单「移出清单」 */}
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

      {/* v6.9（需求 1）：新增清单只需填写名称，创建为空清单 */}
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
        <div className="iw-field-hint">
          新清单创建时为空清单；创建后到模块右上「＋ 添加记录」批量挑选记录加入。
        </div>
      </Modal>

      {/* 条目右键菜单：「移出清单」+「加入其他清单」（v6.9 需求 4/5），只改成员关系 */}
      {ctxMenu ? (
        <>
          <div
            className="iw-plan-ctx-overlay"
            data-testid="iw-plan-ctx-overlay"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div className="iw-plan-ctx-menu" data-testid="iw-plan-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} role="menu">
            <button
              type="button"
              role="menuitem"
              data-testid="iw-plan-ctx-remove"
              onClick={() => {
                app.actions.toggleRecordInPlan(ctxMenu.planId, ctxMenu.recordId);
                setCtxMenu(null);
              }}
            >
              移出清单
            </button>
            <button
              type="button"
              role="menuitem"
              className="iw-plan-ctx-move"
              data-testid="iw-plan-ctx-move"
              onClick={() => {
                setMoveTarget({ fromPlanId: ctxMenu.planId, recordId: ctxMenu.recordId });
                setCtxMenu(null);
              }}
            >
              加入其他清单…
            </button>
          </div>
        </>
      ) : null}

      {/* v6.9（需求 5）：加入其他清单 —— 迁移语义：加入目标清单并从当前清单移出 */}
      <Modal
        open={moveTarget !== null}
        title="加入其他清单"
        cancelText="关闭"
        onCancel={() => setMoveTarget(null)}
      >
        {moveTarget ? (
          <>
            <p data-testid="iw-plan-move-subject">
              记录 <b>{recLabel(recordById.get(moveTarget.recordId) ?? ({ id: moveTarget.recordId, 名称: '' } as RecordItem))}</b>
            </p>
            <div className="iw-field-hint">
              选择目标清单后，该记录将<b>加入目标清单，并同时从当前清单移出</b>（迁移）；记录本身不会被删除或修改。
            </div>
            <div className="iw-plan-move-list" data-testid="iw-plan-move-list">
              {moveCandidates.length === 0 ? (
                <div className="iw-field-hint">没有可加入的其他清单（该记录已在所有清单里，或只有当前一份清单）。</div>
              ) : (
                moveCandidates.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="iw-plan-pick"
                    data-testid={`iw-plan-move-option-${p.id}`}
                    onClick={() => {
                      app.actions.moveRecordToPlan(moveTarget.fromPlanId, p.id, moveTarget.recordId);
                      setMoveTarget(null);
                    }}
                  >
                    <span className="iw-plan-member-name">{p.名称}</span>
                    <span className="iw-plan-member-brand">{p.记录ID列表.length} 条</span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : null}
      </Modal>

      {/* v6.8（需求 4）：重命名清单 —— 清单名后编辑图标，只改名称不动成员关系 */}
      <Modal
        open={renameTarget !== null}
        title="重命名清单"
        confirmText="保存"
        onConfirm={() => {
          if (renameTarget) {
            const name = renameTarget.name.trim();
            if (name) app.actions.renamePlanList(renameTarget.id, name);
          }
          setRenameTarget(null);
        }}
        onCancel={() => setRenameTarget(null)}
      >
        <input
          className="iw-input"
          data-testid="iw-plan-card-rename-input"
          value={renameTarget?.name ?? ''}
          onChange={(e) =>
            setRenameTarget((prev) => (prev ? { ...prev, name: e.target.value } : prev))
          }
        />
        <div className="iw-field-hint">重命名只改清单名称，清单里的记录与顺序都不受影响。</div>
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
