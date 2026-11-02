/**
 * 信息汇总工作台 · 记录详情（PRD 5.6 / AC-12）
 * 全部 19 个字段分组展示；关联记录可点击跳转；返回时保留筛选与搜索上下文。
 */

import { useApp } from '../../store/store';
import { navigate } from '../../router';
import { highlightParts } from '../../store/selectors';

const GROUPS: Array<{ title: string; fields: string[] }> = [
  { title: '基础信息', fields: ['名称', '品牌', '分类', '款式', '季节'] },
  { title: '拥有形态', fields: ['教程', '拥有电子版', '电子版尺码组', '电子版缺码', '拥有纸质版', '纸质版尺码'] },
  { title: '状态评价', fields: ['推荐', '做过', '想做'] },
  { title: '关联', fields: ['关联'] },
  { title: '备注', fields: ['备注'] },
];

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

  const byId = new Map(app.records.map((r) => [r.id, r]));

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
    if (key === '关联') {
      const refs = Array.isArray(raw) ? raw : [];
      if (!refs.length) return <span className="iw-cell-muted">（无）</span>;
      return (
        <span>
          {refs.map((ref, i) => {
            const refId = Number(ref);
            const target = byId.get(refId);
            return (
              <span key={i}>
                {i > 0 ? '、' : ''}
                <a
                  href={`#/detail/${refId}`}
                  onClick={(e) => { e.preventDefault(); navigate({ view: 'detail', id: refId, filters, query, sort }); }}
                >
                  {target ? `#${refId} ${target.名称}` : `#${refId}（已删除记录）`}
                </a>
              </span>
            );
          })}
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

  return (
    <>
      <div className="iw-page-head">
        <div>
          <h1 className="iw-page-title">{record.名称 || `记录 #${record.id}`}</h1>
          <p className="iw-page-sub">
            记录 #{record.id}
            {record.deletedAt ? ' · 已在回收站中' : ''}
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
        <div className="iw-detail-group">
          <div className="iw-detail-group-title">基础信息</div>
          <div className="iw-detail-grid">
            {GROUPS[0].fields.map((f) => (
              <div className="iw-kv" key={f}>
                <span className="iw-kv-key">{f}</span>
                <span className="iw-kv-val">{renderValue(f)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="iw-detail-group">
          <div className="iw-detail-group-title">拥有形态</div>
          <div className="iw-detail-grid">
            {GROUPS[1].fields.map((f) => (
              <div className="iw-kv" key={f}>
                <span className="iw-kv-key">{f}</span>
                <span className="iw-kv-val">{renderValue(f)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="iw-detail-group">
          <div className="iw-detail-group-title">状态评价</div>
          <div className="iw-detail-grid">
            {GROUPS[2].fields.map((f) => (
              <div className="iw-kv" key={f}>
                <span className="iw-kv-key">{f}</span>
                <span className="iw-kv-val">{renderValue(f)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="iw-detail-group">
          <div className="iw-detail-group-title">关联</div>
          <div className="iw-kv">
            <span className="iw-kv-key">关联</span>
            <span className="iw-kv-val">{renderValue('关联')}</span>
          </div>
        </div>

        <div className="iw-detail-group">
          <div className="iw-detail-group-title">备注</div>
          <div className="iw-kv">
            <span className="iw-kv-key">备注</span>
            <span className="iw-kv-val">{renderValue('备注')}</span>
          </div>
        </div>

        <div className="iw-detail-group" style={{ marginBottom: 0 }}>
          <div className="iw-detail-group-title">系统信息</div>
          <div className="iw-detail-grid">
            <div className="iw-kv"><span className="iw-kv-key">记录ID</span><span className="iw-kv-val">{record.id}</span></div>
            <div className="iw-kv"><span className="iw-kv-key">创建时间</span><span className="iw-kv-val">{formatTime(record.创建时间)}</span></div>
            <div className="iw-kv"><span className="iw-kv-key">更新时间</span><span className="iw-kv-val">{formatTime(record.更新时间)}</span></div>
            <div className="iw-kv">
              <span className="iw-kv-key">同步状态</span>
              <span className="iw-kv-val">
                {app.pending.some((p) => p.记录ID === record.id) ? '未同步' : '已同步'}
              </span>
            </div>
          </div>
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
