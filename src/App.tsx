/**
 * 信息汇总工作台 · 应用外壳与路由分发
 */

import { useEffect, useMemo } from 'react';
import { useApp } from './store/store';
import { navigate, useRoute } from './router';
import { ListView } from './features/list/ListView';
import { DetailView } from './features/detail/DetailView';
import { EditorForm } from './features/editor/EditorForm';
import { DashboardView } from './features/dashboard/DashboardView';
import { SettingsView } from './features/settings/SettingsView';
import { Modal } from './components/Modal';
import { APP_NAME } from './schema';
import { findShellRecords } from './store/migrations';

export function App() {
  const app = useApp();
  const route = useRoute();

  // URL → store 同步（AC-12：返回不丢筛选上下文）
  useEffect(() => {
    app.actions.setFilters(route.filters);
    app.actions.setQuery(route.query);
    app.actions.setSort(route.sort);
    app.actions.setPage(route.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.filters, route.query, route.sort, route.page]);

  const needBackup = useMemo(() => {
    if (app.pending.length > 0) return true;
    if (!app.lastSyncedAt) return Boolean(app.config);
    const days = (Date.now() - Date.parse(app.lastSyncedAt)) / 86400000;
    return days >= app.backupIntervalDays;
  }, [app.pending.length, app.lastSyncedAt, app.backupIntervalDays, app.config]);

  const navItems: Array<{ view: 'list' | 'dashboard' | 'settings'; label: string }> = [
    { view: 'list', label: '列表' },
    { view: 'dashboard', label: '看板' },
    { view: 'settings', label: '设置' },
  ];

  const go = (view: 'list' | 'dashboard' | 'settings') => {
    navigate({ view, filters: app.filters, query: app.query, sort: app.sort });
  };

  // v4：识别「名称为空」的导入遗留空壳记录 —— 不再阻断同步，但提示用户可一键清理
  const shellCount = useMemo(() => findShellRecords(app.records).length, [app.records]);

  const statusText = !app.config
    ? '未配置仓库'
    : app.connection === 'connected' ? '已连接'
      : app.connection === 'connecting' ? '连接中'
        : app.connection === 'invalid' ? '令牌失效' : '未连接';

  return (
    <div className="iw-shell">
      <header className="iw-header">
        <div className="iw-header-inner">
          <span className="iw-brand">{APP_NAME}</span>
          <nav className="iw-nav">
            {navItems.map((item) => (
              <a
                key={item.view}
                href={`#/${item.view}`}
                className={route.view === item.view ? 'iw-nav-active' : undefined}
                onClick={(e) => { e.preventDefault(); go(item.view); }}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="iw-header-right">
            <span>
              <span className={`iw-status-dot ${app.connection === 'connected' ? 'iw-status-ok' : app.connection === 'invalid' ? 'iw-status-bad' : 'iw-status-idle'}`} />
              {statusText}
            </span>
            {app.pending.length ? <span>· {app.pending.length} 处未同步</span> : null}
          </div>
        </div>
      </header>

      <main className="iw-main">
        {app.notice ? (
          <div className="iw-banner iw-banner-ok">
            <div style={{ flex: 1 }}><div className="iw-banner-text">{app.notice}</div></div>
            <div className="iw-banner-actions">
              <button className="iw-btn iw-btn-sm iw-btn-ghost" type="button" onClick={app.actions.dismissNotice}>
                知道了
              </button>
            </div>
          </div>
        ) : null}

        {app.autoPullBlocked ? (
          <div className="iw-banner iw-banner-warn">
            <div style={{ flex: 1 }}>
              <div className="iw-banner-title">有未同步的本地改动，已暂停自动拉取</div>
              <div className="iw-banner-text">
                {app.autoPullBlockMessage
                  ?? '检测到本地有未同步的改动，已暂停启动时的自动拉取，避免覆盖你的改动。'}
              </div>
            </div>
            <div className="iw-banner-actions">
              <button className="iw-btn iw-btn-sm" type="button" onClick={() => app.actions.exportJson('all')}>
                先导出本地副本
              </button>
              <button
                className="iw-btn iw-btn-sm iw-btn-primary"
                type="button"
                onClick={() => void app.actions.syncNow()}
                disabled={!app.config || app.syncStatus === 'syncing'}
              >
                同步写回仓库
              </button>
            </div>
          </div>
        ) : null}

        {app.syncStatus === 'offline' ? (
          <div className="iw-banner iw-banner-warn">
            <div style={{ flex: 1 }}>
              <div className="iw-banner-title">当前离线，已切换为本地暂存模式</div>
              <div className="iw-banner-text">
                仍可继续录入与编辑，改动会暂存在本机浏览器；网络恢复后点「同步」即可写回仓库。
              </div>
            </div>
          </div>
        ) : null}

        {needBackup ? (
          <div className="iw-banner">
            <div style={{ flex: 1 }}>
              <div className="iw-banner-title">
                {app.pending.length ? '有未同步的改动，建议先备份一次' : '距上次成功同步已超过备份间隔'}
              </div>
              <div className="iw-banner-text">
                建议现在点「一键备份」把当前数据同步到 GitHub 仓库（同时也会生成一条可追溯的提交记录）。
              </div>
            </div>
            <div className="iw-banner-actions">
              <button className="iw-btn iw-btn-sm" type="button" onClick={() => app.actions.exportJson('all')}>
                先导出本地副本
              </button>
              <button
                className="iw-btn iw-btn-sm iw-btn-primary"
                type="button"
                onClick={() => void app.actions.syncNow()}
                disabled={!app.config || app.syncStatus === 'syncing'}
              >
                一键备份
              </button>
            </div>
          </div>
        ) : null}

        {!app.config ? (
          <div className="iw-banner iw-banner-warn">
            <div style={{ flex: 1 }}>
              <div className="iw-banner-title">尚未配置数据仓库</div>
              <div className="iw-banner-text">
                打开「设置」填写私有数据仓地址与访问令牌，即可拉取并管理你的记录。未配置时页面看不到任何数据。
              </div>
            </div>
            <div className="iw-banner-actions">
              <button className="iw-btn iw-btn-sm iw-btn-primary" type="button" onClick={() => go('settings')}>
                去设置
              </button>
            </div>
          </div>
        ) : null}

        {shellCount > 0 ? (
          <div className="iw-banner iw-banner-warn">
            <div style={{ flex: 1 }}>
              <div className="iw-banner-title">发现 {shellCount} 条名称为空的导入遗留记录</div>
              <div className="iw-banner-text">
                这些记录来自最初的表格导入（不是你录入的），已不再阻断同步。可到「设置 › 数据管理」一键清理，或直接忽略。
              </div>
            </div>
            <div className="iw-banner-actions">
              <button className="iw-btn iw-btn-sm" type="button" onClick={() => go('settings')}>
                去处理
              </button>
            </div>
          </div>
        ) : null}

        {route.view === 'list' ? <ListView /> : null}
        {route.view === 'detail' ? <DetailView id={route.id} /> : null}
        {route.view === 'editor' ? <EditorForm recordId={route.id} /> : null}
        {route.view === 'dashboard' ? <DashboardView /> : null}
        {route.view === 'settings' ? <SettingsView /> : null}
      </main>

      <Modal
        open={app.conflictDetail !== null}
        title="远端数据已被更新，需要先处理冲突"
        cancelText="稍后处理"
        onCancel={app.actions.closeConflict}
        extraActions={(
          <>
            <button
              className="iw-btn iw-btn-danger"
              type="button"
              onClick={() => void app.actions.resolveSyncConflict('local')}
            >
              以本地为准覆盖
            </button>
            <button
              className="iw-btn"
              type="button"
              onClick={() => void app.actions.resolveSyncConflict('remote')}
            >
              以远端为准
            </button>
            <button
              className="iw-btn iw-btn-primary"
              type="button"
              onClick={() => void app.actions.resolveSyncConflict('merge')}
            >
              合并后保存
            </button>
          </>
        )}
      >
        <p style={{ marginTop: 0 }}>
          覆盖前系统已<b>自动为你保存了一份本地版本</b>（浏览器会下载一个 JSON 文件），无需担心丢失。
        </p>
        {app.conflictDetail && app.conflictDetail.diffs.length ? (
          <div className="iw-diff-list">
            {app.conflictDetail.diffs.slice(0, 30).map((d, i) => (
              <div className="iw-diff-row" key={`${d.记录ID}-${d.字段}-${i}`}>
                #{d.记录ID} {d.名称} · {d.字段}：
                本地 <span className="iw-diff-local">{fmt(d.一侧值)}</span>
                {' / '}远端 <span className="iw-diff-remote">{fmt(d.另一侧值)}</span>
              </div>
            ))}
            {app.conflictDetail.diffs.length > 30 ? (
              <div className="iw-diff-row">其余 {app.conflictDetail.diffs.length - 30} 处差异未列出。</div>
            ) : null}
          </div>
        ) : (
          <div className="iw-diff-list">远端与本地没有字段级冲突差异，可以直接选择覆盖方式。</div>
        )}
      </Modal>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === undefined || v === null || v === '') return '（空）';
  if (Array.isArray(v)) return v.length ? v.join('、') : '（空）';
  if (typeof v === 'boolean') return v ? '是' : '否';
  return String(v);
}
