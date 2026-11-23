/**
 * 信息汇总工作台 · 清单管理视图（v6.6 需求 1）
 *
 * 进入单个清单的管理页（#/plan/<planId>，入口：设置页「计划清单」卡片、
 * 列表筛选面板「计划清单」块）。页面做两件事：
 *   · 展示该清单当前全部记录，并支持「移除出清单」；
 *   · 从全部记录里搜索 / 定位记录，加入清单。
 *
 * 两个操作都只改 plans.json 的成员关系（store.toggleRecordInPlan），
 * 绝不删除 / 修改记录本身 —— 文案与提示语都围绕这一点展开。
 */

import { useMemo, useState } from 'react';
import { useApp } from '../../store/store';
import { navigate } from '../../router';
import type { RecordItem } from '../../types';

/** 候选列表最多直接渲染的条数（848+ 条全渲染会卡，超出折叠提示收窄搜索词） */
const CANDIDATE_LIMIT = 30;

function recLabel(r: RecordItem): string {
  return `#${r.id} ${String(r.名称 ?? '')}`;
}

export function PlanView({ planId }: { planId: string | null }) {
  const app = useApp();
  const [addQuery, setAddQuery] = useState('');

  const plan = useMemo(
    () => app.plans.find((p) => p.id === planId) ?? null,
    [app.plans, planId],
  );

  const recordById = useMemo(() => {
    const m = new Map<number, RecordItem>();
    for (const r of app.records) m.set(r.id, r);
    return m;
  }, [app.records]);

  const members = useMemo(() => {
    if (!plan) return [];
    return plan.记录ID列表
      .map((id) => recordById.get(id))
      .filter((r): r is RecordItem => Boolean(r));
  }, [plan, recordById]);

  // 候选 = 不在本清单里的全部记录；按名称/品牌/#编号 搜索定位
  const candidates = useMemo(() => {
    if (!plan) return [];
    const inPlan = new Set(plan.记录ID列表);
    const q = addQuery.trim().toLowerCase();
    const plain = q.replace(/^#/, '');
    const isId = /^\d+$/.test(plain);
    return app.records.filter((r) => {
      if (inPlan.has(r.id)) return false;
      if (!q) return true;
      if (isId && String(r.id).includes(plain)) return true;
      if (String(r.名称 ?? '').toLowerCase().includes(q)) return true;
      if (String(r.品牌 ?? '').toLowerCase().includes(q)) return true;
      return false;
    });
  }, [plan, app.records, addQuery]);

  if (!plan) {
    return (
      <div className="iw-page-head" data-testid="iw-plan-notfound">
        <div>
          <h1 className="iw-page-title">清单管理</h1>
          <p className="iw-page-sub">找不到这份清单 —— 它可能刚被删除，或链接里的清单 ID 不对。</p>
        </div>
        <div className="iw-actions-row">
          <button className="iw-btn" type="button" onClick={() => navigate({ view: 'settings', settingsTab: 'plans', filters: app.filters, query: app.query, sort: app.sort })}>
            回设置页看清单
          </button>
          <button className="iw-btn iw-btn-primary" type="button" onClick={() => navigate({ view: 'list', filters: app.filters, query: app.query, sort: app.sort })}>
            返回列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="iw-plan-manage">
      <div className="iw-page-head">
        <div>
          <h1 className="iw-page-title" data-testid="iw-plan-title">清单管理：{plan.名称}</h1>
          <p className="iw-page-sub">
            共 {plan.记录ID列表.length} 条记录 · 这里添加 / 移除<b>只调整清单成员关系</b>，记录本身不会被删除或修改。
          </p>
        </div>
        <div className="iw-actions-row">
          <button className="iw-btn" type="button" onClick={() => navigate({ view: 'settings', settingsTab: 'plans', filters: app.filters, query: app.query, sort: app.sort })}>
            返回设置
          </button>
          <button className="iw-btn iw-btn-primary" type="button" onClick={() => navigate({ view: 'list', filters: { ...app.filters, 计划清单: [plan.id] }, query: app.query, sort: app.sort })}>
            在列表中查看这份清单
          </button>
        </div>
      </div>

      <div className="iw-settings-card">
        <h2 className="iw-settings-title">清单里的记录（{members.length} 条）</h2>
        {members.length === 0 ? (
          <div className="iw-field-hint" data-testid="iw-plan-members-empty">
            这份清单还没有记录。从下方「添加记录」里搜索并加入第一批。
          </div>
        ) : (
          <div className="iw-table-wrap">
            <table className="iw-table" data-testid="iw-plan-members">
              <thead>
                <tr>
                  <th style={{ width: 72 }}>编号</th>
                  <th>名称</th>
                  <th>品牌</th>
                  <th>分类</th>
                  <th style={{ width: 110 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {members.map((r) => (
                  <tr key={r.id} data-testid={`iw-plan-member-${r.id}`}>
                    <td className="iw-cell-muted">#{r.id}</td>
                    <td className="iw-col-name">
                      <a
                        href={`#/detail/${r.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate({ view: 'detail', id: r.id, filters: app.filters, query: app.query, sort: app.sort });
                        }}
                      >
                        {String(r.名称 ?? '')}
                      </a>
                    </td>
                    <td>{String(r.品牌 ?? '')}</td>
                    <td>{Array.isArray(r.分类) ? r.分类.join('、') : String(r.分类 ?? '')}</td>
                    <td>
                      <button
                        className="iw-btn iw-btn-sm iw-btn-ghost"
                        type="button"
                        style={{ color: 'var(--iw-danger)' }}
                        data-testid={`iw-plan-remove-${r.id}`}
                        aria-label={`移除出清单：${String(r.名称 ?? '')}`}
                        onClick={() => app.actions.toggleRecordInPlan(plan.id, r.id)}
                      >
                        移除出清单
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="iw-field-hint">
          「移除出清单」只把记录从这份清单里拿出来，记录本身仍在，列表与详情里都能照常找到它。
        </div>
      </div>

      <div className="iw-settings-card">
        <h2 className="iw-settings-title">添加记录</h2>
        <div className="iw-inline-form">
          <input
            className="iw-input"
            data-testid="iw-plan-add-search"
            value={addQuery}
            placeholder="搜索名称、品牌或编号（如 #12）…"
            onChange={(e) => setAddQuery(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
        <div className="iw-chip-group" data-testid="iw-plan-candidates">
          {candidates.length === 0 ? (
            <div className="iw-field-hint" data-testid="iw-plan-add-empty">
              {addQuery.trim() ? '没有匹配的记录 —— 换个关键词试试。' : '所有记录都已经在这份清单里了。'}
            </div>
          ) : (
            candidates.slice(0, CANDIDATE_LIMIT).map((r) => (
              <div className="iw-plan-row" key={r.id} data-testid={`iw-plan-candidate-${r.id}`}>
                <span className="iw-plan-name">
                  {recLabel(r)}
                  {String(r.品牌 ?? '') ? <span className="iw-plan-count"> · {String(r.品牌)}</span> : null}
                </span>
                <button
                  className="iw-btn iw-btn-sm iw-btn-ghost"
                  type="button"
                  data-testid={`iw-plan-add-${r.id}`}
                  aria-label={`加入清单：${String(r.名称 ?? '')}`}
                  onClick={() => app.actions.toggleRecordInPlan(plan.id, r.id)}
                >
                  加入清单
                </button>
              </div>
            ))
          )}
        </div>
        {candidates.length > CANDIDATE_LIMIT ? (
          <div className="iw-field-hint">
            匹配 {candidates.length} 条，仅显示前 {CANDIDATE_LIMIT} 条 —— 用更具体的关键词收窄范围。
          </div>
        ) : null}
      </div>
    </div>
  );
}
