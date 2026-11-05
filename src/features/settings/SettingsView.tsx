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
import { Modal } from '../../components/Modal';
import { BUILD_INFO, buildInfoText, buildDateText } from '../../version';

/** v6.4（需求 2）：设置页二级导航分组 —— 设置项按类别归组，点导航只渲染当前分组的卡片。
 *  连接与同步 = 数据仓库连接 + 同步和备份；数据管理 = 导出 / 数据体检 / 待确认清单。 */
type SettingsGroupId = 'connection' | 'data' | 'plans' | 'options' | 'version';

const SETTINGS_GROUPS: Array<{ id: SettingsGroupId; label: string }> = [
  { id: 'connection', label: '连接与同步' },
  { id: 'data', label: '数据管理' },
  { id: 'plans', label: '计划清单' },
  { id: 'options', label: '字段选项' },
  { id: 'version', label: '版本信息' },
];

export function SettingsView() {
  const app = useApp();
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [sessionOnly, setSessionOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  /* v6.2（需求 1）：计划清单管理 —— 新建 / 重命名 / 删除（删除需确认） */
  const [newPlanName, setNewPlanName] = useState('');
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; count: number } | null>(null);
  // v6.3（需求 2）：字段选项管理的删除确认目标
  const [optionDeleteTarget, setOptionDeleteTarget] = useState<{
    fieldKey: string; fieldLabel: string; value: string; usage: number;
  } | null>(null);
  // v6.4（需求 2）：设置二级导航当前分组
  const [activeGroup, setActiveGroup] = useState<SettingsGroupId>('connection');

  useEffect(() => {
    if (app.config) {
      setRepoUrl(`${app.config.owner}/${app.config.repo}`);
      setBranch(app.config.branch);
      setSessionOnly(app.config.sessionOnly);
    }
  }, [app.config]);

  // v4：数据管理区 —— 识别「名称为空」的导入遗留记录，供一键清理
  const shellRecords = useMemo(() => findShellRecords(app.records), [app.records]);

  /* v6.1.1：待确认清单动态核对 —— 设置页展示当前核对结果与已忽略项（可恢复） */
  const ignoredChecks = app.ignoredChecks ?? [];
  const pendingChecks = useMemo(
    () => ({ conflicts: app.conflicts ?? [], suggestions: app.suggestions ?? [] }),
    [app.conflicts, app.suggestions],
  );
  const currentCheckKeys = useMemo(
    () => new Set([...pendingChecks.conflicts, ...pendingChecks.suggestions].map((i) => i.key)),
    [pendingChecks],
  );

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

      {/* v6.4（需求 2）：设置二级导航 —— 按类别分组；移动端横向可滚动（见 .iw-subnav 样式） */}
      <nav className="iw-subnav" aria-label="设置分类" data-testid="iw-settings-nav">
        {SETTINGS_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`iw-btn iw-btn-sm iw-subnav-item${activeGroup === g.id ? ' iw-subnav-on' : ''}`}
            data-testid={`iw-settings-nav-${g.id}`}
            aria-current={activeGroup === g.id ? 'page' : undefined}
            onClick={() => setActiveGroup(g.id)}
          >
            {g.label}
          </button>
        ))}
      </nav>

      {activeGroup === 'connection' ? (
      <>
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

      </>
      ) : null}

      {activeGroup === 'data' ? (
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

        <div className="iw-log-block" data-testid="iw-pending-checks-block">
          <div className="iw-log-title">待确认清单</div>
          <p className="iw-settings-desc" style={{ marginBottom: 8 }}>
            {`按当前数据实时核对：${pendingChecks.conflicts.length} 条矛盾记录、${pendingChecks.suggestions.length} 条建议补全`
              + (ignoredChecks.length
                ? `；${ignoredChecks.length} 条已被你忽略。`
                : '。')
              + '修复对应记录后条目会自动从列表页横幅消失；被忽略的条目在这里可以恢复。'}
          </p>
          <div className="iw-actions-row">
            <button
              className="iw-btn"
              type="button"
              disabled={!ignoredChecks.length}
              onClick={() => app.actions.restoreAllIgnoredChecks()}
            >
              全部恢复（{ignoredChecks.length}）
            </button>
          </div>
          {ignoredChecks.length ? (
            <div>
              {ignoredChecks.map((e) => (
                <div key={e.key} className="iw-conflict-item" data-testid="iw-ignored-item">
                  <div>
                    <div className="iw-conflict-title">{e.摘要 || e.key}</div>
                    <div className="iw-conflict-detail">
                      {currentCheckKeys.has(e.key)
                        ? '当前数据中仍存在这个问题（恢复后会重新出现在列表页横幅里）。'
                        : '当前数据中已检测不到这个问题（记录可能已修复或删除）。'}
                    </div>
                  </div>
                  <div className="iw-banner-actions">
                    <button
                      className="iw-btn iw-btn-sm"
                      type="button"
                      onClick={() => app.actions.restoreIgnoredCheck(e.key)}
                    >
                      恢复
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="iw-field-hint" style={{ marginTop: 8 }}>
              在列表页横幅点「忽略」的条目会出现在这里，供日后重新确认；没有已忽略的条目。
            </div>
          )}
        </div>
      </div>
      ) : null}

      {activeGroup === 'plans' ? (
      <div className="iw-settings-card">
        <h2 className="iw-settings-title">计划清单</h2>
        <div className="iw-chip-group" data-testid="iw-plans-admin">
          {app.plans.length === 0 ? (
            <div className="iw-field-hint">还没有计划清单。创建后可在新增/编辑表单或记录详情页把记录加入清单，列表页也能按清单筛选。</div>
          ) : (
            app.plans.map((plan) => (
              <div className="iw-plan-row" key={plan.id} data-testid="iw-plan-row">
                <span className="iw-plan-name">
                  {plan.名称}
                  <span className="iw-plan-count">（{plan.记录ID列表.length} 条）</span>
                </span>
                <button
                  type="button"
                  className="iw-btn iw-btn-ghost"
                  data-testid={`iw-plan-rename-${plan.id}`}
                  aria-label={`重命名清单：${plan.名称}`}
                  onClick={() => setRenameTarget({ id: plan.id, name: plan.名称 })}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="iw-btn iw-btn-ghost"
                  data-testid={`iw-plan-delete-${plan.id}`}
                  aria-label={`删除清单：${plan.名称}`}
                  onClick={() =>
                    setDeleteTarget({ id: plan.id, name: plan.名称, count: plan.记录ID列表.length })
                  }
                >
                  删除
                </button>
              </div>
            ))
          )}
        </div>
        <div className="iw-inline-form">
          <input
            className="iw-input"
            data-testid="iw-new-plan-name"
            value={newPlanName}
            placeholder="新清单名称（如：2026 春季）"
            onChange={(e) => setNewPlanName(e.target.value)}
          />
          <button
            type="button"
            className="iw-btn iw-btn-primary"
            data-testid="iw-new-plan-submit"
            onClick={() => {
              const name = newPlanName.trim();
              if (!name) return;
              const created = app.actions.createPlanList(name);
              if (created) setNewPlanName('');
            }}
          >
            新建清单
          </button>
        </div>
        <div className="iw-field-hint">
          计划清单用于把记录归入自定义分组（一条记录可属于多份清单），与「状态及评价」里的「计划」状态互不影响。删除清单只解除记录关联，不删除记录本身。
        </div>
      </div>
      ) : null}

      {activeGroup === 'options' ? (
      <div className="iw-settings-card">
        <h2 className="iw-settings-title">字段选项管理</h2>
        {(() => {
          const managed = app.schema.fields.filter(
            (f) => f.type === 'enum' && f.allowNew && !f.system && !f.readonly,
          );
          const usageOf = (fieldKey: string, value: string) =>
            app.records.filter(
              (r) => String((r as unknown as Record<string, unknown>)[fieldKey] ?? '') === value,
            ).length;
          if (!managed.length) {
            return <div className="iw-field-hint">当前没有支持自由输入的枚举字段。</div>;
          }
          return (
            <div data-testid="iw-options-admin">
              {managed.map((f) => {
                const candidates = app.optionCandidates?.[f.jsonKey] ?? [];
                const removed = app.options?.[f.jsonKey]?.removed ?? [];
                return (
                  <div key={f.jsonKey} style={{ marginBottom: 16 }} data-testid={`iw-options-field-${f.jsonKey}`}>
                    <div className="iw-plan-name" style={{ marginBottom: 8 }}>{f.label}</div>
                    <div className="iw-chip-group">
                      {candidates.length === 0 ? (
                        <div className="iw-field-hint">暂无候选选项；在表单里输入新值保存后会自动加入。</div>
                      ) : (
                        candidates.map((v) => (
                          <div className="iw-plan-row" key={v} data-testid={`iw-option-row-${f.jsonKey}`}>
                            <span className="iw-plan-name">
                              {v}
                              <span className="iw-plan-count">（{usageOf(f.jsonKey, v)} 条记录在用）</span>
                            </span>
                            <button
                              type="button"
                              className="iw-btn iw-btn-ghost"
                              data-testid={`iw-option-delete-${f.jsonKey}`}
                              aria-label={`删除选项：${v}`}
                              onClick={() => setOptionDeleteTarget({
                                fieldKey: f.jsonKey,
                                fieldLabel: f.label,
                                value: v,
                                usage: usageOf(f.jsonKey, v),
                              })}
                            >
                              删除
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    {removed.length ? (
                      <div style={{ marginTop: 8 }}>
                        <span className="iw-field-hint">已删除的候选：</span>
                        {removed.map((v) => (
                          <button
                            key={v}
                            type="button"
                            className="iw-btn iw-btn-sm"
                            style={{ marginLeft: 8 }}
                            data-testid={`iw-option-restore-${f.jsonKey}`}
                            aria-label={`恢复选项：${v}`}
                            onClick={() => app.actions.restoreFieldOption(f.jsonKey, v)}
                          >
                            恢复「{v}」
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })()}
        <div className="iw-field-hint">
          品牌、款式支持直接输入新值，保存后会自动加入这里的候选。删除选项只影响后续录入的下拉候选，
          历史记录的取值保持原样显示，不受影响。
        </div>
      </div>
      ) : null}

      {activeGroup === 'version' ? (
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
      ) : null}

      {/* v6.2（需求 1）：重命名 / 删除确认弹窗 */}
      <Modal
        open={renameTarget !== null}
        title="重命名计划清单"
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
          data-testid="iw-rename-plan-input"
          value={renameTarget?.name ?? ''}
          onChange={(e) =>
            setRenameTarget((prev) => (prev ? { ...prev, name: e.target.value } : prev))
          }
        />
      </Modal>
      <Modal
        open={deleteTarget !== null}
        title="删除计划清单"
        confirmText="删除"
        danger
        onConfirm={() => {
          if (deleteTarget) app.actions.deletePlanList(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      >
        <div className="iw-field-hint" data-testid="iw-delete-plan-hint">
          确定删除「{deleteTarget?.name}」吗？清单里有 {deleteTarget?.count ?? 0}{' '}
          条记录；删除清单只解除记录关联，不会删除任何记录本身。
        </div>
      </Modal>
      <Modal
        open={optionDeleteTarget !== null}
        title="删除字段选项"
        confirmText="删除"
        danger
        onConfirm={() => {
          if (optionDeleteTarget) {
            app.actions.removeFieldOption(optionDeleteTarget.fieldKey, optionDeleteTarget.value);
          }
          setOptionDeleteTarget(null);
        }}
        onCancel={() => setOptionDeleteTarget(null)}
      >
        <div className="iw-field-hint" data-testid="iw-delete-option-hint">
          确定删除「{optionDeleteTarget?.fieldLabel}」的选项「{optionDeleteTarget?.value}」吗？
          {optionDeleteTarget && optionDeleteTarget.usage > 0
            ? `当前有 ${optionDeleteTarget.usage} 条记录正在使用这个值；`
            : ''}
          删除后它不再出现在后续录入的候选里，但历史记录仍保留原值显示。
        </div>
      </Modal>
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
