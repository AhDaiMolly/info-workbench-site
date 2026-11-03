/**
 * 信息汇总工作台 · 设置页（PRD 5.8 / 5.9 / AC-16 / AC-20）
 * 令牌只写入浏览器本地存储；可测试连接、清除配置。
 *
 * v4 变更：
 *   · 移除「安全须知」卡片
 *   · 「同步」与「备份」合并为「同步和备份」，并新增操作日志（最近 3 条）
 *   · 新增「数据管理」区：导出入口（全部 / 当前筛选，JSON / Excel）+ 一键清理空壳记录
 */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../store/store';
import { findShellRecords } from '../../store/migrations';
import { BUILD_INFO, buildInfoText, buildDateText } from '../../version';

export function SettingsView() {
  const app = useApp();
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [sessionOnly, setSessionOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (app.config) {
      setRepoUrl(`${app.config.owner}/${app.config.repo}`);
      setBranch(app.config.branch);
      setSessionOnly(app.config.sessionOnly);
    }
  }, [app.config]);

  // v4：数据管理区 —— 识别「名称为空」的导入遗留记录，供一键清理
  const shellRecords = useMemo(() => findShellRecords(app.records), [app.records]);

  const statusText = !app.config
    ? '未配置'
    : app.connection === 'connected' ? '已连接'
      : app.connection === 'connecting' ? '连接中'
        : app.connection === 'invalid' ? '令牌无效或权限不足' : '未连接';

  const handleSave = async () => {
    setBusy(true);
    await app.actions.saveConfig({ repoUrl, branch, token, sessionOnly });
    setBusy(false);
    setToken('');
  };

  return (
    <>
      <div className="iw-page-head">
        <div>
          <h1 className="iw-page-title">设置</h1>
          <p className="iw-page-sub">配置数据仓库、访问令牌与备份节奏</p>
        </div>
      </div>

      <div className="iw-settings-card">
        <h2 className="iw-settings-title">数据仓库连接</h2>
        <p className="iw-settings-desc">
          令牌只保存在<b>这台电脑的浏览器本地</b>，不会写入代码仓库、网址或任何日志。清除配置即可立即移除。
        </p>

        <div className="iw-field">
          <label className="iw-label" htmlFor="repo-url">仓库地址</label>
          <input
            id="repo-url"
            className="iw-input"
            placeholder="https://github.com/用户名/仓库名"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
          />
          <div className="iw-field-hint">填写<b>私有数据仓</b>的地址（仓库里放着 records.json 的那个）。</div>
        </div>

        <div className="iw-field">
          <label className="iw-label" htmlFor="branch">分支</label>
          <input
            id="branch"
            className="iw-input"
            style={{ maxWidth: 240 }}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
          <div className="iw-field-hint">默认 main。如果你的数据文件在别的分支上，请改成对应分支名。</div>
        </div>

        <div className="iw-field">
          <label className="iw-label" htmlFor="token">访问令牌（PAT）</label>
          <input
            id="token"
            className="iw-input"
            type="password"
            placeholder="粘贴你创建的访问令牌"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <div className="iw-field-hint">
            令牌创建步骤见 README「配置访问令牌」一节；GitHub 新版令牌以 <span className="iw-code">github_pat</span> 开头，
            经典令牌以 <span className="iw-code">ghp</span> 开头。只授予数据仓的 <span className="iw-code">Contents: Read and write</span>。
          </div>
        </div>

        <div className="iw-field">
          <label className="iw-checkbox-row">
            <input
              type="checkbox"
              checked={sessionOnly}
              onChange={(e) => setSessionOnly(e.target.checked)}
            />
            仅本次会话有效（关闭浏览器后令牌失效，共享电脑建议开启）
          </label>
        </div>

        <div className="iw-actions-row">
          <button className="iw-btn iw-btn-primary" type="button" onClick={handleSave} disabled={busy || !token.trim()}>
            {busy ? '保存中…' : '保存并连接'}
          </button>
          <button className="iw-btn" type="button" onClick={() => void app.actions.testConnection()} disabled={!app.config}>
            测试连接
          </button>
          <button className="iw-btn iw-btn-danger" type="button" onClick={app.actions.clearConfigAction}>
            清除配置
          </button>
          <span className="iw-result-count">
            <span className={`iw-status-dot ${app.connection === 'connected' ? 'iw-status-ok' : app.connection === 'invalid' ? 'iw-status-bad' : 'iw-status-idle'}`} />
            {statusText}
          </span>
        </div>

        {app.config ? (
          <div className="iw-kv-list" style={{ marginTop: 20 }}>
            <div className="iw-kv"><span className="iw-kv-key">仓库</span><span className="iw-kv-val">{app.config.owner}/{app.config.repo}</span></div>
            <div className="iw-kv"><span className="iw-kv-key">分支</span><span className="iw-kv-val">{app.config.branch}</span></div>
            <div className="iw-kv"><span className="iw-kv-key">令牌存放</span><span className="iw-kv-val">{app.config.sessionOnly ? '仅本次会话（关闭浏览器即失效）' : '本机浏览器长期保存'}</span></div>
            <div className="iw-kv"><span className="iw-kv-key">上次成功同步</span><span className="iw-kv-val">{app.lastSyncedAt ? new Date(app.lastSyncedAt).toLocaleString('zh-CN') : '尚未同步过'}</span></div>
          </div>
        ) : null}
      </div>

      {/* v4：「同步」与「备份」合并，并新增操作日志（只保留最近 3 条） */}
      <div className="iw-settings-card">
        <h2 className="iw-settings-title">同步和备份</h2>
        <p className="iw-settings-desc">
          改动会先存在本地，点「同步」后才会写回仓库。未同步改动：<b>{app.pending.length}</b> 处。
          距上次成功同步超过设定天数时，打开工作台会出现备份提醒横幅；同时仓库内每周自动生成一份快照（保留 26 周）。
        </p>
        <div className="iw-field" style={{ maxWidth: 260 }}>
          <label className="iw-label" htmlFor="backup-days">备份提醒间隔（天）</label>
          <input
            id="backup-days"
            className="iw-input"
            type="number"
            min={1}
            max={90}
            value={app.backupIntervalDays}
            onChange={(e) => app.actions.setBackupInterval(Math.max(1, Number(e.target.value) || 7))}
          />
        </div>
        <div className="iw-actions-row">
          <button className="iw-btn iw-btn-primary" type="button" onClick={() => void app.actions.syncNow()} disabled={!app.config || app.syncStatus === 'syncing'}>
            {app.syncStatus === 'syncing' ? '同步中…' : '同步到 GitHub'}
          </button>
          <button className="iw-btn" type="button" onClick={() => void app.actions.pull()} disabled={!app.config}>
            从仓库重新拉取
          </button>
          {app.syncMessage ? <span className="iw-result-count">{app.syncMessage}</span> : null}
        </div>

        <div className="iw-log-block">
          <div className="iw-log-title">操作日志（最近 3 条）</div>
          {app.actionLog.length ? (
            <ul className="iw-log-list">
              {app.actionLog.map((e, i) => (
                <li className="iw-log-item" key={`${e.时间}-${i}`}>
                  <span className="iw-log-time">{formatLogTime(e.时间)}</span>
                  <span className="iw-log-type">{e.类型}</span>
                  <span className={`iw-log-result ${e.结果 === '成功' ? 'iw-log-ok' : 'iw-log-bad'}`}>{e.结果}</span>
                  <span className="iw-log-note">{e.说明}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="iw-log-empty">还没有同步或备份记录。日志只存在这台电脑的浏览器里，最多保留 3 条。</div>
          )}
        </div>
      </div>

      {/* v4：导出入口统一收在这里（列表页不再放导出按钮） */}
      <div className="iw-settings-card">
        <h2 className="iw-settings-title">数据管理</h2>
        <p className="iw-settings-desc">
          导出备份（文件下载到本机）。「全部」导出所有记录；「当前筛选」按列表页的筛选与搜索结果导出，两者口径一致。
        </p>
        <div className="iw-actions-row">
          <button className="iw-btn" type="button" onClick={() => app.actions.exportJson('all')}>导出全部 JSON</button>
          <button className="iw-btn" type="button" onClick={() => app.actions.exportXlsx('all')}>导出全部 Excel</button>
          <button className="iw-btn" type="button" onClick={() => app.actions.exportJson('filtered')}>导出当前筛选 JSON</button>
          <button className="iw-btn" type="button" onClick={() => app.actions.exportXlsx('filtered')}>导出当前筛选 Excel</button>
        </div>

        <div className="iw-log-block">
          <div className="iw-log-title">数据体检</div>
          <p className="iw-settings-desc" style={{ marginBottom: 8 }}>
            {shellRecords.length
              ? `检测到 ${shellRecords.length} 条「名称为空」的导入遗留记录（记录号：${shellRecords.map((r) => `#${r.id}`).join('、')}）。`
                + '它们来自最初的表格导入，不是你录入的；本版已不再让它们阻断同步。'
              : '没有发现「名称为空」的导入遗留记录。'}
          </p>
          <div className="iw-actions-row">
            <button
              className="iw-btn"
              type="button"
              disabled={!shellRecords.length}
              onClick={() => app.actions.cleanupShellRecords()}
            >
              一键清理空壳记录（{shellRecords.length}）
            </button>
          </div>
          {shellRecords.length ? (
            <div className="iw-field-hint" style={{ marginTop: 8 }}>
              清理只删除「名称为空」的空壳记录，其余记录不受影响；清理后可在列表页点「同步」写回仓库。
            </div>
          ) : null}
        </div>
      </div>

      {/* v6（需求 1）：底部信息区 —— 展示站点代码版本（构建时注入，见 vite.config.ts） */}
      <div className="iw-settings-card">
        <h2 className="iw-settings-title">版本信息</h2>
        <div className="iw-kv-list" data-testid="iw-version-info">
          <div className="iw-kv">
            <span className="iw-kv-key">当前版本</span>
            <span className="iw-kv-val" data-testid="iw-version-text">{buildInfoText()}</span>
          </div>
          <div className="iw-kv">
            <span className="iw-kv-key">版本号</span>
            <span className="iw-kv-val">{BUILD_INFO.version}</span>
          </div>
          <div className="iw-kv">
            <span className="iw-kv-key">构建日期</span>
            <span className="iw-kv-val">{buildDateText() || '—'}</span>
          </div>
          <div className="iw-kv">
            <span className="iw-kv-key">提交</span>
            <span className="iw-kv-val">{BUILD_INFO.commit || '—'}</span>
          </div>
        </div>
        <div className="iw-field-hint">
          版本号与构建信息在每次发布时自动生成。如果发现线上功能与手册描述不一致，可先核对这里的版本号是否为最新。
        </div>
      </div>
    </>
  );
}

/** 操作日志时间：本地化到分钟 */
function formatLogTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
