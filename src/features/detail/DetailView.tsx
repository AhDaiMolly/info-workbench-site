/**
 * 信息汇总工作台 · 记录详情（PRD 5.6 / AC-12）
 *
 * v3（需求 1）：版面改为五分区，与新增/编辑表单共用同一套分区契约（src/sections.ts）：
 *   基础信息 / 拥有形态 / 状态及评价 / 备注 / 系统信息
 * v3（需求 2 / 8）：删除「关联」「电子版缺码」相关展示；系统信息分区只读展示。
 */

import { useApp } from '../../store/store';
import { navigate } from '../../router';
import { highlightParts } from '../../store/selectors';
import { buildSectionPlan } from '../../sections';
import type { FieldDef } from '../../types';

export function DetailView({ id }: { id: number | null }) {
  const app = useApp();
  const { filters, query, sort } = app;
  const record = app.records.find((r) => r.id === id);

  if (!record) {
    return (
      <div className="iw-empty">
        <div className="iw-empty-title">找不到这条记录</div>
        <button className="iw-btn" type="button" onClick={() => navigate({ view: 'list', filters, query, sort })}>
          返回列表
        </button>
      </div>
    );
  }

  /* v6.2（需求 1）：这条记录所在的计划清单（点击开关成员关系） */
  const inPlans = app.plans.filter((p) => p.记录ID列表.includes(record.id));

  const renderValue = (key: string): JSX.Element => {
    const raw = (record as unknown as Record<string, unknown>)[key];
    if (key === '备注') {
      const text = String(raw ?? '');
      if (!text) return <span className="iw-cell-muted">（空）</span>;
      return (
        <span style={{ whiteSpace: 'pre-wrap' }}>
          {highlightParts(text, query).map((p, i) => (
            p.hit ? <mark key={i} className="iw-highlight">{p.text}</mark> : <span key={i}>{p.text}</span>
          ))}
        </span>
      );
    }
    if (Array.isArray(raw)) {
      return raw.length ? <span>{raw.join('、')}</span> : <span className="iw-cell-muted">（空）</span>;
    }
    if (typeof raw === 'boolean') return <span>{raw ? '是' : '否'}</span>;
    if (raw === '' || raw === undefined || raw === null) return <span className="iw-cell-muted">（空）</span>;
    return <span>{String(raw)}</span>;
  };

  // v3：五分区由 schema 驱动（远端新增字段也能落到正确分区）
  const plan = buildSectionPlan(app.schema);

  const renderField = (field: FieldDef) => {
    const raw = (record as unknown as Record<string, unknown>)[field.jsonKey];
    const value = field.type === 'datetime'
      ? <span>{formatTime(String(raw ?? ''))}</span>
      : renderValue(field.jsonKey);
    // v6（需求 2）：备注改为整行块布局 —— 旧版把长文本塞在标签右侧的半宽窄列里，
    // pre-wrap 换行被挤成锯齿状；现在标签占一行、正文独占整行宽度。
    const isNote = field.jsonKey === '备注';
    return (
      <div className={`iw-kv${isNote ? ' iw-kv-note' : ''}`} key={field.key}>
        <span className="iw-kv-key">{field.label}</span>
        <span className="iw-kv-val">{value}</span>
      </div>
    );
  };

  return (
    <>
      <div className="iw-page-head">
        <div>
          <h1 className="iw-page-title">{record.名称 || `记录 #${record.id}`}</h1>
          <p className="iw-page-sub">
            记录 #{record.id}
          </p>
        </div>
        <div className="iw-actions-row">
          <button
            className="iw-btn"
            type="button"
            onClick={() => navigate({ view: 'list', filters, query, sort })}
          >
            返回列表
          </button>
          <button
            className="iw-btn iw-btn-primary"
            type="button"
            onClick={() => navigate({ view: 'editor', id: record.id, filters, query, sort })}
          >
            编辑
          </button>
        </div>
      </div>

      <div className="iw-settings-card" style={{ maxWidth: 'none' }}>
        {plan.map((section) => (
          <div
            className="iw-detail-group"
            key={section.title}
            style={section.title === '系统信息' ? { marginBottom: 0 } : undefined}
          >
            <div className="iw-detail-group-title">{section.title}</div>
            {section.fields.length ? (
              <div className="iw-detail-grid">
                {section.fields.map((f) => renderField(f))}
              </div>
            ) : (
              <div className="iw-cell-muted">（本分区暂无字段）</div>
            )}
            {section.title === '系统信息' ? (
              <div className="iw-detail-grid" style={{ marginTop: 8 }}>
                <div className="iw-kv">
                  <span className="iw-kv-key">同步状态</span>
                  <span className="iw-kv-val">
                    {app.pending.some((p) => p.记录ID === record.id) ? '未同步' : '已同步'}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* v6.2（需求 1）：计划清单成员卡片 —— 点击清单名加入/移出，即时生效 */}
      <div className="iw-settings-card" style={{ maxWidth: 'none' }} data-testid="iw-plan-card">
        <div className="iw-detail-group" style={{ marginBottom: 0 }}>
          <div className="iw-detail-group-title">计划清单</div>
          {app.plans.length ? (
            <div className="iw-chip-group" data-testid="iw-plan-chips">
              {app.plans.map((plan) => {
                const on = plan.记录ID列表.includes(record.id);
                return (
                  <button
                    key={plan.id}
                    type="button"
                    className={`iw-chip${on ? ' iw-chip-on' : ''}`}
                    onClick={() => app.actions.toggleRecordInPlan(plan.id, record.id)}
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
            <div className="iw-cell-muted">
              还没有计划清单。到「设置 › 计划清单」创建一份（如「2026 春季」），新增 / 编辑表单和这里都能把这条记录加进去。
            </div>
          )}
          {app.plans.length ? (
            <div className="iw-field-hint" style={{ marginTop: 8 }}>
              点击清单名即可加入 / 移出；当前共在 {inPlans.length} 份清单里。改动会随下一次「同步到 GitHub」写回仓库。
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
