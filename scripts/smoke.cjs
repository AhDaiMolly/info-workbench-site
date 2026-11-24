/* eslint-disable */
/**
 * 信息汇总工作台 v4 · 真机冒烟测试（headless Chromium + puppeteer-core）
 *
 * v6.3 新增/变更覆盖：
 *   · 看板移除「完成与计划」统计区块（其余卡片与布局不动）
 *   · 品牌 / 款式支持手动输入新值并保存，新值自动沉淀为下次录入的候选
 *   · 设置页「字段选项管理」可删除候选（在用值给出提示但仍允许删除），历史记录取值不受影响
 *   · 字段选项随同步写回数据仓 options.json
 *
 * v4 新增/变更覆盖：
 *   · 列表页不再有「导出 JSON」「导出 Excel」按钮（导出移到设置 › 数据管理）
 *   · 设置页无「安全须知」，有「同步和备份」区 + 「操作日志（最近 3 条）」区 + 导出入口
 *   · 看板不再有「有教程」统计口径
 *   · 删除记录 = 二次确认 + 直接物理删除（无回收站）
 *   · 第 1 条修复后的写回校验：数据里含「名称为空」的记录与软删残留时，
 *     同步写回不再报「795 号记录的『名称』必填项不能为空」
 *
 * 沿用 v3 的覆盖：列表 / 搜索 / 新增编辑表单五分区 / 详情五分区 / 看板渲染 / 导出内容
 *
 * 数据：不用线上数据仓。启动本地静态服务托管 dist/，并拦截 api.github.com 请求，
 *       返回 data/migration-v61/ 下的 v5 数据与结构（v6.1 已迁移口径），保证离线可跑、结果稳定。
 *
 * 运行：
 *   node scripts/smoke.cjs
 *   （依赖：/home/gem/.aily/.cli/npm/node_modules/puppeteer-core、/usr/bin/chromium-browser）
 */

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PUPPETEER_PATH = process.env.PUPPETEER_PATH || '/home/gem/.aily/.cli/npm/node_modules/puppeteer-core';
const puppeteer = require(PUPPETEER_PATH);

// v6-1 断言锚定当前版本号：从 package.json 读取，避免每轮发版都要改冒烟脚本
const PKG_VERSION = require('../package.json').version;

const DIST = path.resolve(__dirname, '../dist');
const DATA_DIR = path.resolve(__dirname, '../../data/migration-v61');
const RECORDS_FILE = 'records.v61.json';
const SCHEMA_FILE = 'schema.v61.json';
// v6.3：字段选项文件（数据仓 data/options.json）
const OPTIONS_FILE = 'options.v63.json';
const PORT = Number(process.env.SMOKE_PORT || 4178);
const MOCK_SHA = '0'.repeat(40);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------ 静态服务 -------------------------------- */
function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(DIST, url === '/' ? 'index.html' : url);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html');
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const b64 = (buf) => buf.toString('base64');
function apiPayload(name, buf) {
  return JSON.stringify({
    name,
    path: `data/${name}`,
    sha: MOCK_SHA,
    size: buf.length,
    type: 'file',
    encoding: 'base64',
    content: b64(buf),
    url: 'https://api.github.com/mock',
  });
}

(async () => {
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const recordsBuf = fs.readFileSync(path.join(DATA_DIR, RECORDS_FILE));
  const schemaBuf = fs.readFileSync(path.join(DATA_DIR, SCHEMA_FILE));
  const plansBuf = fs.readFileSync(path.join(DATA_DIR, 'plans.v62.json'));
  const optionsBuf = fs.readFileSync(path.join(DATA_DIR, OPTIONS_FILE));
  // 全部记录：断言一律锚定到当前数据，避免线上数据演进后出现假失败
  const allFile = JSON.parse(recordsBuf.toString('utf8'));
  // 与产品代码 src/store/selectors.ts 的排序比较器保持一致
  const APP_COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

  // 拦截期间对外返回的文件（阶段 B 会换成「脏数据」版本）
  let servedRecords = recordsBuf;
  let servedSchema = schemaBuf;
  let servedPlans = plansBuf;
  let servedOptions = optionsBuf;
  let putCount = 0;
  const putBodies = [];
  const putUrls = [];
  const apiHits = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 960 });

    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    const CORS_HEADERS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
      'Access-Control-Max-Age': '600',
    };
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('api.github.com')) {
        if (req.method() === 'OPTIONS') {
          return req.respond({ status: 204, headers: CORS_HEADERS, body: '' });
        }
        if (req.method() === 'PUT') {
          putCount += 1;
          try { putBodies.push(req.postData() || ''); putUrls.push(url); } catch (e) { putBodies.push(''); putUrls.push(url); }
          apiHits.push(`PUT ${url.replace(/https:\/\/api\.github\.com/, '')}`);
          // v6.2.1 修复：PUT 之后让后续 GET 返回刚写入的内容（贴近真实仓库）。
          // 此前 GET 永远返回最初的 fixture —— v6.2.1 新增用例里 goto() 内含 reload 触发自动拉取，
          // 合并逻辑把本地清单按「远端已删除」误清空，导致表单读到的 plans 为空。
          try {
            const putBody = JSON.parse(req.postData() || '{}');
            if (typeof putBody.content === 'string' && putBody.content) {
              const written = Buffer.from(putBody.content, 'base64');
              if (url.includes('plans.json')) servedPlans = written;
              else if (url.includes('options.json')) servedOptions = written;
              else if (url.includes('records.json')) servedRecords = written;
              else if (url.includes('schema.json')) servedSchema = written;
            }
          } catch (e) { /* 忽略无法解析的 PUT 体，不影响响应 */ }
          return req.respond({
            status: 200,
            headers: CORS_HEADERS,
            contentType: 'application/json',
            body: JSON.stringify({ content: { sha: 'f'.repeat(40) }, commit: { sha: 'e'.repeat(40) } }),
          });
        }
        if (url.includes('records.json')) {
          apiHits.push(`GET ${url.replace(/https:\/\/api\.github\.com/, '')}`);
          return req.respond({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiPayload('records.json', servedRecords) });
        }
        if (url.includes('schema.json')) {
          apiHits.push(`GET ${url.replace(/https:\/\/api\.github\.com/, '')}`);
          return req.respond({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiPayload('schema.json', servedSchema) });
        }
        if (url.includes('plans.json')) {
          apiHits.push(`GET ${url.replace(/https:\/\/api\.github\.com/, '')}`);
          return req.respond({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiPayload('plans.json', servedPlans) });
        }
        // v6.3：字段选项文件
        if (url.includes('options.json')) {
          apiHits.push(`GET ${url.replace(/https:\/\/api\.github\.com/, '')}`);
          return req.respond({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiPayload('options.json', servedOptions) });
        }
        // 仓库元信息（连通性检测）—— 返 200，避免浏览器把 404 记成控制台错误
        apiHits.push(`GET ${url.replace(/https:\/\/api\.github\.com/, '')}`);
        return req.respond({
          status: 200,
          headers: CORS_HEADERS,
          contentType: 'application/json',
          body: JSON.stringify({ id: 1, name: 'info-workbench-data', full_name: 'mock/info-workbench-data', private: false }),
        });
      }
      return req.continue();
    });

    const goto = async (hash) => {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      await page.reload({ waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 400));
    };
    const bodyText = () => page.evaluate(() => document.body.innerText);
    const waitFor = async (fn, timeout = 15000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await fn()) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    };
    const clickByText = async (text, scope) => page.evaluate((t, sc) => {
      const root = sc ? document.querySelector(sc) : document;
      if (!root) return false;
      const nodes = Array.from(root.querySelectorAll('button, a, [role="button"]'));
      const hit = nodes.find((n) => (n.textContent || '').includes(t));
      if (hit) { hit.click(); return true; }
      return false;
    }, text, scope || null);

    /* 0. 首次进入并写入连接配置（令牌为占位，请求被本地拦截，不出网） */
    await page.goto(`http://127.0.0.1:${PORT}/#/list`, { waitUntil: 'networkidle2' });
    await page.evaluate(() => {
      localStorage.setItem('iw.config', JSON.stringify({
        owner: 'AhDaiMolly', repo: 'info-workbench-data', branch: 'main', token: 'smoke-local-token', sessionOnly: false,
      }));
    });
    await page.reload({ waitUntil: 'networkidle2' });

    const hasRows = () => page.evaluate(() => document.querySelectorAll('.iw-table tbody tr').length);
    // v6.4：设置页二级导航 — 切换到指定设置分组（点击后等待重渲染）
    const navTo = async (id) => {
      const ok = await page.evaluate((tid) => {
        const b = document.querySelector(`[data-testid="iw-settings-nav-${tid}"]`);
        if (b) { b.click(); return true; }
        return false;
      }, id);
      await new Promise((r) => setTimeout(r, 450));
      return ok;
    };
    if (!(await waitFor(async () => (await hasRows()) > 0, 8000))) {
      for (const candidate of ['同步', '拉取', '立即同步', '刷新数据', '连接', '去连接']) {
        await clickByText(candidate);
        await new Promise((r) => setTimeout(r, 1500));
        if ((await hasRows()) > 0) break;
      }
    }
    const diag = await page.evaluate(() => {
      let cache = null;
      try {
        const raw = localStorage.getItem('iw.cache');
        if (raw) { const j = JSON.parse(raw); cache = { keys: Object.keys(j), records: Array.isArray(j.records) ? j.records.length : null }; }
      } catch (e) { cache = 'parse-error'; }
      return {
        buttons: Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean),
        cache,
        text: document.body.innerText.slice(0, 400).replace(/\n+/g, ' | '),
      };
    });
    console.log('DIAG buttons:', JSON.stringify(diag.buttons));
    console.log('DIAG cache:', JSON.stringify(diag.cache));
    console.log('DIAG text:', diag.text);

    /* 1. 列表页 */
    const rowCount = await hasRows();
    record('列表页渲染数据行', rowCount > 0, `表格行数 ${rowCount}`);
    const listText = await bodyText();
    record('列表页标题正确', listText.includes('记录列表'), '包含「记录列表」');
    record('列表页不含已删字段「电子版缺码」', !listText.includes('电子版缺码'), '未出现');
    record('列表页不含已删字段「关联」', !listText.includes('关联'), '未出现');

    /* 1b. v4 第 2 条：列表页不再有导出按钮 */
    const listExportButtons = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-main button, .iw-main a'))
      .filter((el) => !el.closest('.iw-banner'))
      .map((el) => (el.textContent || '').trim())
      .filter((t) => t.includes('导出')));
    record('v4 列表页无「导出 JSON」按钮', !listExportButtons.some((t) => t.includes('JSON')),
      listExportButtons.length ? `列表页仍有导出按钮：${listExportButtons.join('、')}` : '列表页没有任何导出按钮');
    record('v4 列表页无「导出 Excel」按钮', !listExportButtons.some((t) => t.includes('Excel')),
      listExportButtons.length ? `列表页仍有导出按钮：${listExportButtons.join('、')}` : '列表页没有任何导出按钮');
    record('v4 列表页无「回收站」入口', !listText.includes('回收站'), '未出现');

    /* 1c. v6.1.1 待确认清单动态核对（横幅按当前数据实时重算，不再依赖静态快照） */
    await page.evaluate(() => { localStorage.removeItem('iw.ignoredChecks'); });
    await goto('/list');

    // 期望值从注入的 fixture 推导（规则与 src/store/pendingChecks.ts 一致，不硬编码条数）
    const pendingExpect = (() => {
      const conflicts = []; const suggestions = [];
      for (const r of allFile.records) {
        const own = Array.isArray(r['拥有形态']) ? r['拥有形态'] : [];
        const e = (Array.isArray(r['电子版尺码']) ? r['电子版尺码'] : []).filter((x) => String(x).trim());
        const p = (Array.isArray(r['纸质版尺码']) ? r['纸质版尺码'] : []).filter((x) => String(x).trim());
        if (!String(r['名称'] ?? '').trim()) conflicts.push({ id: r.id, field: '名称' });
        if (e.length && !own.includes('电子版')) conflicts.push({ id: r.id, field: '电子版尺码' });
        if (p.length && !own.includes('纸质版')) conflicts.push({ id: r.id, field: '纸质版尺码' });
        if (own.includes('电子版') && !e.length) suggestions.push({ id: r.id, field: '电子版尺码' });
        if (own.includes('纸质版') && !p.length) suggestions.push({ id: r.id, field: '纸质版尺码' });
      }
      conflicts.sort((a, b) => a.id - b.id);
      suggestions.sort((a, b) => a.id - b.id);
      return { conflicts, suggestions };
    })();
    const bannerState = async () => page.evaluate(() => {
      const el = document.querySelector('[data-testid="iw-conflicts-banner"]');
      return el ? { present: true, text: (el.innerText || '').replace(/\s+/g, ' ') } : { present: false, text: '' };
    });
    const expectTotal = pendingExpect.conflicts.length + pendingExpect.suggestions.length;
    const bs1 = await bannerState();
    record('v6.1.1-1 横幅按当前数据实时核对（计数与 fixture 推导一致）',
      expectTotal > 0
        ? bs1.present
          && bs1.text.includes(`待人工确认清单：${pendingExpect.conflicts.length} 条矛盾记录`)
          && (pendingExpect.suggestions.length
            ? bs1.text.includes(`${pendingExpect.suggestions.length} 条建议补全`)
            : !bs1.text.includes('条建议补全'))
        : !bs1.present,
      bs1.present ? bs1.text.slice(0, 100) : '横幅未显示');
    const staleOldTerms = ['拥有电子版', '电子版尺码组', '想做'];
    const idsShown = [...pendingExpect.conflicts, ...pendingExpect.suggestions]
      .every((it) => bs1.text.includes(`#${it.id} `));
    record('v6.1.1-2 横幅只列真实剩余项且措辞为 v6.1 新口径（旧字段名消失）',
      bs1.present && idsShown
        && bs1.text.includes('拥有形态未勾选')
        && !staleOldTerms.some((t) => bs1.text.includes(t)),
      bs1.present ? `${idsShown ? '全部条目在列' : '有条目缺失'}：${bs1.text.slice(0, 90)}` : '横幅未显示');

    // 忽略单条：选一条只在矛盾清单里出现、无建议项、且唯一检查的记录
    const sugIds = new Set(pendingExpect.suggestions.map((s) => s.id));
    const conflictCount = (id) => pendingExpect.conflicts.filter((c) => c.id === id).length;
    let igItem = null;
    let bs5 = null;
    igItem = pendingExpect.conflicts.find((c) => c.field !== '名称' && !sugIds.has(c.id) && conflictCount(c.id) === 1);
    if (!igItem) {
      record('v6.1.1-3 单条「忽略」后条目从横幅消失并写入本地存储', false, '当前 fixture 中无单矛盾样本，请更新断言样本');
    } else {
      const igKey = `勾选与信息矛盾|${igItem.field}|${igItem.id}`;
      const clickedIg = await page.evaluate((sel) => {
        const b = document.querySelector(sel);
        if (b) { b.click(); return true; }
        return false;
      }, `[data-testid="iw-ignore-${igKey}"]`);
      await new Promise((r) => setTimeout(r, 700));
      const bs2 = await bannerState();
      const storedIgnored = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('iw.ignoredChecks') || '[]'); } catch (e) { return []; }
      });
      // 忽略唯一条目后剩余可能为 0 —— 横幅会整体收起（ConflictsBanner return null）
      const remainAfterIgnore = pendingExpect.conflicts.length - 1 + pendingExpect.suggestions.length;
      record('v6.1.1-3 单条「忽略」后条目从横幅消失并写入本地存储',
        clickedIg && (remainAfterIgnore > 0
          ? bs2.present
            && bs2.text.includes(`待人工确认清单：${pendingExpect.conflicts.length - 1} 条矛盾记录`)
            && !bs2.text.includes(`#${igItem.id} `)
          : !bs2.present)
          && storedIgnored.length === 1 && storedIgnored[0].key === igKey,
        `点击 ${clickedIg}，忽略键 ${storedIgnored.length ? storedIgnored[0].key : '无'}，横幅 ${bs2.present ? bs2.text.slice(0, 60) : '消失'}`);

      // 刷新后忽略仍然生效（浏览器本地持久化）
      await page.reload({ waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 400));
      const bs3 = await bannerState();
      record('v6.1.1-4 刷新后忽略仍然生效（本地持久化，不随页面重开复原）',
        remainAfterIgnore > 0
          ? bs3.present
            && bs3.text.includes(`待人工确认清单：${pendingExpect.conflicts.length - 1} 条矛盾记录`)
            && !bs3.text.includes(`#${igItem.id} `)
          : !bs3.present,
        bs3.present ? bs3.text.slice(0, 80) : '横幅未显示');

      // 设置页：查看已忽略项并「恢复」→ 重新出现在横幅
      await goto('/settings');
      await navTo('data');
      const pcBlock = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="iw-pending-checks-block"]');
        return b ? { present: true, text: (b.innerText || '').replace(/\s+/g, ' ') } : { present: false, text: '' };
      });
      const restoredOne = await page.evaluate((id) => {
        const items = Array.from(document.querySelectorAll('[data-testid="iw-ignored-item"]'));
        const item = items.find((n) => (n.innerText || '').includes(`#${id}`));
        if (!item) return false;
        const btn = Array.from(item.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '恢复');
        if (btn) { btn.click(); return true; }
        return false;
      }, igItem.id);
      await new Promise((r) => setTimeout(r, 500));
      await goto('/list');
      const bs4 = await bannerState();
      record('v6.1.1-5 设置页可查看已忽略项并「恢复」（恢复后重新出现在横幅）',
        pcBlock.present && pcBlock.text.includes('已被你忽略') && pcBlock.text.includes(`#${igItem.id}`)
          && restoredOne && bs4.present && bs4.text.includes(`#${igItem.id} `),
        `设置页块 ${pcBlock.present ? '存在' : '缺失'}，恢复点击 ${restoredOne}，横幅 ${bs4.present ? bs4.text.slice(0, 60) : '未显示'}`);

      // 修复记录（编辑该记录，勾上「电子版」使其与已填尺码一致）→ 矛盾条目自动消失
      await goto(`/editor/${igItem.id}`);
      const ticked = await page.evaluate(() => {
        const group = document.querySelector('[role="group"][aria-label="拥有形态"]');
        if (!group) return false;
        const chip = Array.from(group.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '电子版');
        if (!chip) return false;
        if (chip.getAttribute('aria-pressed') === 'true') return true;
        chip.click();
        return true;
      });
      await new Promise((r) => setTimeout(r, 700));
      const savedFix = await clickByText('保存');
      await new Promise((r) => setTimeout(r, 800));
      await goto('/list');
      bs5 = await bannerState();
      // 修复唯一矛盾后剩余可能为 0 —— 横幅整体收起
      const remainAfterFix = pendingExpect.conflicts.length - 1 + pendingExpect.suggestions.length;
      record('v6.1.1-6 修复记录后矛盾条目自动从清单消失（动态重算，无需静态快照）',
        ticked && savedFix && (remainAfterFix > 0
          ? bs5.present && !bs5.text.includes(`#${igItem.id} `)
            && bs5.text.includes(`待人工确认清单：${pendingExpect.conflicts.length - 1} 条矛盾记录`)
          : !bs5.present),
        `勾选 ${ticked}，保存 ${savedFix}，横幅 ${bs5.present ? bs5.text.slice(0, 80) : '未显示'}`);
    }

    // 全部忽略 → 横幅收起；刷新后仍不显示；随后清理本地忽略清单，不影响后续阶段
    const expectLeft = (() => {
      // 走过修复分支则矛盾数已减 1（不再依赖横幅回读推断，剩余为 0 时横幅本来就消失）
      return (igItem ? pendingExpect.conflicts.length - 1 : pendingExpect.conflicts.length)
        + pendingExpect.suggestions.length;
    })();
    if (expectLeft > 0) {
      const igAll = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="iw-ignore-all"]');
        if (b) { b.click(); return true; }
        return false;
      });
      await new Promise((r) => setTimeout(r, 700));
      const bs6 = await bannerState();
      await page.reload({ waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 400));
      const bs7 = await bannerState();
      record('v6.1.1-7 「全部忽略」后横幅收起，刷新后仍不显示',
        igAll && !bs6.present && !bs7.present,
        `点击 ${igAll}，收起后横幅 ${bs6.present ? '仍在' : '已消失'}，刷新后 ${bs7.present ? '仍在' : '已消失'}`);
    } else {
      record('v6.1.1-7 全部处理完时横幅不显示', !(await bannerState()).present, '当前数据已无待确认项');
    }
    // 清理本节产生的本地忽略状态，不污染后续阶段
    await page.evaluate(() => { localStorage.removeItem('iw.ignoredChecks'); });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 400));


    /* 2. 搜索 */
    const countText = async () => page.evaluate(() => {
      const el = document.querySelector('.iw-result-count');
      return el ? el.textContent || '' : '';
    });
    const beforeCountText = await countText();
    const searchInfo = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const hit = inputs.find((i) => {
        const hint = `${i.getAttribute('placeholder') || ''} ${i.getAttribute('aria-label') || ''}`;
        return hint.includes('搜索') || hint.includes('名称') || hint.includes('关键词');
      });
      if (!hit) return null;
      return { placeholder: hit.getAttribute('placeholder') || hit.getAttribute('aria-label') || '' };
    });
    let searchMode = '路由参数';
    if (searchInfo) {
      searchMode = `输入框（${searchInfo.placeholder || '无占位文案'}）`;
      const handle = await page.evaluateHandle(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        return inputs.find((i) => {
          const hint = `${i.getAttribute('placeholder') || ''} ${i.getAttribute('aria-label') || ''}`;
          return hint.includes('搜索') || hint.includes('名称') || hint.includes('关键词');
        }) || null;
      });
      await handle.focus();
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('卫兰', { delay: 40 });
      await new Promise((r) => setTimeout(r, 700));
    } else {
      await goto('/list?q=卫兰');
    }
    const afterCountText = await countText();
    const afterRows = await hasRows();
    record('搜索后仍有结果', afterRows > 0, `命中行数 ${afterRows}（${searchMode}）`);
    record('搜索后结果条数变化', afterCountText !== beforeCountText || afterRows !== rowCount,
      `前「${beforeCountText.trim()}」→ 后「${afterCountText.trim()}」`);

    /* 3. 新增表单：五分区 + 下拉单选 */
    await goto('/editor/new');
    const formText = await bodyText();
    const sectionTitles = ['基础信息', '拥有形态', '状态及评价', '备注'];
    const missingSections = sectionTitles.filter((t) => !formText.includes(t));
    record('新增表单渲染四个分区（v6.4 系统信息已隐藏）',
      missingSections.length === 0 && !formText.includes('系统信息'),
      missingSections.length ? `缺少：${missingSections.join('、')}` : `${sectionTitles.join(' / ')}；系统信息未出现`);

    const selectInfo = await page.evaluate(() => {
      const get = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const opts = el.tagName === 'SELECT'
          ? Array.from(el.options).map((o) => o.value)
          : null;
        return { tag: el.tagName, type: el.getAttribute('type'), options: opts };
      };
      return {
        season: get('fld-季节'),
        elec: get('fld-电子版'),
        paper: get('fld-纸质版'),
        ownChips: !!document.querySelector('[role="group"][aria-label="拥有形态"]'),
        ownOptions: Array.from(document.querySelectorAll('[role="group"][aria-label="拥有形态"] button')).map((b) => b.textContent),
        legacyRel: !!document.getElementById('fld-关联'),
        legacyMissing: !!document.getElementById('fld-电子版缺码'),
        checkboxCount: document.querySelectorAll('input[type="checkbox"]').length,
      };
    });
    record('季节为下拉单选且选项为 夏/春秋/冬',
      selectInfo.season && selectInfo.season.tag === 'SELECT'
      && JSON.stringify(selectInfo.season.options.filter(Boolean)) === JSON.stringify(['夏', '春秋', '冬']),
      selectInfo.season ? `${selectInfo.season.tag} ${JSON.stringify(selectInfo.season.options)}` : '未找到 #fld-季节');
    record('v5：「拥有形态」为多选组，旧的两个三态下拉已移除',
      selectInfo.ownChips && !selectInfo.elec && !selectInfo.paper,
      `拥有形态多选组 ${selectInfo.ownChips ? '有' : '无'}／旧下拉 电子版:${selectInfo.elec ? '有' : '无'} 纸质版:${selectInfo.paper ? '有' : '无'}`);
    record('v5：拥有形态多选的选项为 电子版 / 纸质版',
      Array.isArray(selectInfo.ownOptions) && selectInfo.ownOptions.join(',') === '电子版,纸质版',
      JSON.stringify(selectInfo.ownOptions));
    record('表单已无「关联」「电子版缺码」字段',
      !selectInfo.legacyRel && !selectInfo.legacyMissing && !formText.includes('电子版缺码'),
      `关联控件 ${selectInfo.legacyRel ? '有' : '无'}／电子版缺码控件 ${selectInfo.legacyMissing ? '有' : '无'}`);
    record('v5：拥有形态不是三态下拉（旧口径消失）',
      !selectInfo.elec && !selectInfo.paper && selectInfo.ownChips,
      `电子版下拉 ${selectInfo.elec ? '有' : '无'}／纸质版下拉 ${selectInfo.paper ? '有' : '无'}／拥有形态多选 ${selectInfo.ownChips ? '有' : '无'}`);

    /* 4. 详情页：五分区 */
    await goto('/detail/22');
    const detailInfo = await page.evaluate(() => {
      const titles = Array.from(document.querySelectorAll('.iw-detail-group-title')).map((n) => (n.textContent || '').trim());
      return { titles, text: document.body.innerText };
    });
    const detailMissing = sectionTitles.filter((t) => !detailInfo.titles.some((x) => x.includes(t)));
    record('详情页渲染四个分区（v6.4 系统信息/记录编号已隐藏）',
      detailMissing.length === 0 && !detailInfo.titles.some((x) => x.includes('系统信息')) && !detailInfo.text.includes('记录 #'),
      detailMissing.length ? `缺少：${detailMissing.join('、')}` : `${detailInfo.titles.join(' / ')}；无系统信息区、无记录编号`);
    const rec22 = allFile.records.find((r) => r.id === 22);
    const style22 = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.iw-kv')).find((n) => {
        const k = n.querySelector('.iw-kv-key');
        return k && (k.textContent || '').trim() === '款式';
      });
      const v = row ? row.querySelector('.iw-kv-val') : null;
      return v ? (v.textContent || '').trim() : '';
    });
    record('详情页「款式」与当前数据一致',
      !!rec22 && style22 === String(rec22.款式 ?? '').trim(),
      `记录 22 的款式：页面「${style22}」／数据「${rec22 ? String(rec22.款式 ?? '').trim() : '?'}」`);
    record('详情页不含已删字段', !detailInfo.text.includes('电子版缺码') && !detailInfo.text.includes('关联'), '未出现');

    /* 5. 看板（v4 第 3 条：无「有教程」统计） */
    await goto('/dashboard');
    const chartInfo = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      let painted = 0;
      for (const c of canvases) {
        try {
          const ctx = c.getContext('2d');
          if (!ctx) continue;
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) { painted += 1; break; } }
        } catch (e) { /* ignore */ }
      }
      return { count: canvases.length, painted };
    });
    record('看板渲染出图表', chartInfo.count > 0 && chartInfo.painted > 0,
      `canvas ${chartInfo.count} 个，其中已绘制像素 ${chartInfo.painted} 个`);

    const kpiLabels = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-kpi-label')).map((n) => (n.textContent || '').trim()));
    record('v4 看板无「有教程」KPI 卡片', !kpiLabels.includes('有教程'),
      kpiLabels.length ? `KPI：${kpiLabels.join('、')}` : '未取到 KPI');
    const dashText = await bodyText();
    record('v4 看板整体不出现「有教程」口径', !dashText.includes('有教程'),
      dashText.includes('有教程') ? '页面仍出现「有教程」' : '未出现');

    // v6.3 需求 1：看板移除「完成与计划」统计区块，其余卡片不动
    const dashChartTitles = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-chart-title')).map((n) => (n.textContent || '').trim()));
    const dashCardCount = await page.evaluate(() => document.querySelectorAll('.iw-chart-card').length);
    record('v6.3 看板已移除「完成与计划」区块（其余图表卡片保留）',
      !dashChartTitles.includes('完成与计划') && !dashText.includes('完成与计划'),
      dashChartTitles.length ? `图表卡片 ${dashCardCount} 个：${dashChartTitles.join('、')}` : '未取到图表标题');

    // v6.4 需求 1：看板不再有任何「计划」语义的展示（KPI / 图表 / 文案）
    record('v6.4-1 看板无「计划」相关展示', !dashText.includes('计划'),
      kpiLabels.length ? `KPI：${kpiLabels.join('、')}` : '未取到 KPI');

    /* 6. 设置页（v4 第 5 / 6 条 + 导出入口 + 数据体检） */
    await goto('/settings');
    const settingsText = await bodyText();
    record('v4 设置页无「安全须知」', !settingsText.includes('安全须知'),
      settingsText.includes('安全须知') ? '仍存在「安全须知」' : '未出现');
    record('v4 设置页有「同步和备份」区', settingsText.includes('同步和备份'), '包含「同步和备份」');
    record('v4 设置页有「操作日志（最近 3 条）」区', settingsText.includes('操作日志（最近 3 条）'), '包含操作日志区');
    record('v4 设置页无「回收站」入口', !settingsText.includes('回收站'), '未出现');

    // v6.4 需求 2：设置页二级导航 —— 分组按钮齐全、各分组可切换
    const navLabels = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="iw-settings-nav-"]'))
      .map((b) => (b.textContent || '').trim()));
    record('v6.4-2 设置页二级导航按钮齐全（连接与同步/数据管理/字段选项/版本信息）',
      navLabels.join(',') === '连接与同步,数据管理,字段选项,版本信息', navLabels.join('、'));
    // v6.8（需求 1）：设置页不再有「计划清单」分组（清单管理全部集中在「清单」页签）
    record('v6.8-1 设置页二级导航无「计划清单」分组、无计划清单管理元素',
      !navLabels.includes('计划清单')
        && !(await page.evaluate(() => document.querySelector('[data-testid="iw-settings-nav-plans"]')))
        && !(await page.evaluate(() => document.querySelector('[data-testid="iw-new-plan-name"]')))
        && !settingsText.includes('计划清单'),
      `导航分组：${navLabels.join('、')}`);
    const navDataOk = await navTo('data');
    const dataText = await bodyText();
    record('v6.4-2 切到「数据管理」组：数据体检与导出入口可达',
      navDataOk && dataText.includes('数据体检') && dataText.includes('导出全部 Excel') && dataText.includes('导出全部 JSON'),
      dataText.includes('数据体检') ? '数据体检与导出入口均在' : dataText.slice(0, 60));
    record('v4 设置页有「数据管理」区与导出入口',
      dataText.includes('数据管理')
      && (await clickByText('导出全部 Excel', '.iw-main')) !== null
      && (await clickByText('导出全部 JSON', '.iw-main')) !== null,
      '含「导出全部 Excel」「导出全部 JSON」');
    const probeGroup = async (id, sel) => {
      const ok = await navTo(id);
      const n = ok ? await page.evaluate((s2) => document.querySelectorAll(s2).length, sel) : 0;
      return { ok, n };
    };
    const pOptions = await probeGroup('options', '[data-testid="iw-options-admin"]');
    const pVersion = await probeGroup('version', '[data-testid="iw-version-info"]');
    const pConn = await probeGroup('connection', '.iw-settings-title');
    record('v6.4-2 其余分组均可切换（字段选项/版本信息/连接与同步）',
      pOptions.ok && pOptions.n > 0 && pVersion.ok && pVersion.n > 0 && pConn.ok && pConn.n > 0,
      `options=${pOptions.n} version=${pVersion.n} connection=${pConn.n}`);
    const shellIdsNow = allFile.records.filter((r) => !String(r.名称 ?? '').trim()).map((r) => `#${r.id}`);
    record('v4 设置页「数据体检」与当前数据一致（空壳记录编号）',
      dataText.includes('数据体检')
        && (shellIdsNow.length
          ? shellIdsNow.every((id) => dataText.includes(id))
          : dataText.includes('没有发现「名称为空」的导入遗留记录')),
      shellIdsNow.length
        ? `当前数据 ${shellIdsNow.length} 条空壳记录：${shellIdsNow.join('、')}`
        : '当前数据无「名称为空」的空壳记录');

    /* ---------------- v6 五项体验优化（浏览器逐项验证） ---------------- */
    // 本段跑在完整数据集（799 条，v6.1 已迁移口径）已加载的阶段，断言一律锚定当前数据
    await page.evaluate(() => {
      localStorage.removeItem('iw.prefs');
    });

    // 需求 1：设置页底部版本信息（构建时注入 version / 构建日期 / 提交）
    await navTo('version');
    const verInfo = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="iw-version-info"]');
      const text = document.querySelector('[data-testid="iw-version-text"]');
      return {
        hasCard: !!card,
        text: text ? text.textContent || '' : '',
        bodyHasFields: ['版本号', '构建日期', '提交'].every((t) => (document.body.innerText || '').includes(t)),
      };
    });
    record('v6-1 设置页展示「版本信息」卡片（版本号/构建日期/提交）',
      verInfo.hasCard && verInfo.bodyHasFields && verInfo.text.includes('v' + PKG_VERSION),
      verInfo.hasCard ? `版本文本：${verInfo.text}` : '未找到版本信息卡片');

    // 样本：仅勾选「电子版」且有备注的记录（从当前数据里挑）
    const target = allFile.records.find((r) =>
      (r['拥有形态'] || []).includes('电子版') && !(r['拥有形态'] || []).includes('纸质版') && String(r['备注'] || '').trim());
    record('v6 冒烟样本存在（仅电子版 + 有备注的记录）', !!target,
      target ? `#${target.id} ${target['名称']}` : '当前数据中未找到仅电子版且有备注的记录');

    if (target) {
      // 需求 2：详情页备注整行块布局（不再是半宽格子里的挤压）
      await goto(`#/detail/${target.id}`);
      const noteInfo = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('.iw-kv-note'));
        if (!nodes.length) return { found: false };
        const n = nodes[0];
        const style = getComputedStyle(n);
        const val = n.querySelector('.iw-kv-val');
        const valStyle = val ? getComputedStyle(val) : null;
        return {
          found: true,
          display: style.display,
          gridCol: style.gridColumn,
          whiteSpace: valStyle ? valStyle.whiteSpace : '',
        };
      });
      record('v6-2 详情页备注为整行块布局（标签独占一行、正文占满整行）',
        noteInfo.found && noteInfo.display === 'block' && noteInfo.gridCol === '1 / -1' && noteInfo.whiteSpace === 'pre-wrap',
        noteInfo.found ? `display=${noteInfo.display}，grid-column=${noteInfo.gridCol}，white-space=${noteInfo.whiteSpace}` : '未找到 .iw-kv-note');

      // 需求 3：形态-尺码联动
      await goto(`#/editor/${target.id}`);
      const linkageHidden = await page.evaluate(() => {
        const text = document.body.innerText || '';
        return {
          hasPaperInput: !!document.querySelector('input[placeholder="输入纸质版尺码后回车"]'),
          hasEsize: text.includes('电子版尺码'),
          hasPaperLabel: text.includes('纸质版尺码'),
        };
      });
      record('v6-3a 仅勾选「电子版」时：电子版尺码显示、纸质版尺码不出现',
        linkageHidden.hasEsize && !linkageHidden.hasPaperInput && !linkageHidden.hasPaperLabel,
        `电子版尺码=${linkageHidden.hasEsize}，纸质版尺码输入=${linkageHidden.hasPaperInput}`);

      const clickOwnChip = (label) => page.evaluate((t) => {
        const group = document.querySelector('[role="group"][aria-label="拥有形态"]');
        if (!group) return false;
        const chip = Array.from(group.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === t);
        if (!chip) return false;
        chip.click();
        return true;
      }, label);
      const chipState = () => page.evaluate(() => {
        const group = document.querySelector('[role="group"][aria-label="拥有形态"]');
        return group
          ? Array.from(group.querySelectorAll('button')).map((b) => `${(b.textContent || '').trim()}=${b.getAttribute('aria-pressed')}`)
          : [];
      });
      const clicked3b = await clickOwnChip('纸质版');
      await new Promise((r) => setTimeout(r, 700));
      const state3b = await chipState();
      const paperInput3b = await page.evaluate(() => !!document.querySelector('input[placeholder="输入纸质版尺码后回车"]'));
      record('v6-3b 勾选「纸质版」后纸质版尺码输入出现',
        clicked3b && paperInput3b && state3b.some((s) => s.startsWith('纸质版=true')),
        `点击返回 ${clicked3b}，chip 状态 ${state3b.join('/') || '无'}，输入框存在 ${paperInput3b}`);

      // 真实键盘输入 + 回车，把「170」提交成标签（受控输入框必须走真实键盘事件）
      let typed3c = false;
      const paperHandle = await page.evaluateHandle(() => document.querySelector('input[placeholder="输入纸质版尺码后回车"]'));
      if (paperHandle) {
        await paperHandle.focus();
        await page.keyboard.type('170', { delay: 40 });
        await page.keyboard.press('Enter');
        await new Promise((r) => setTimeout(r, 500));
        typed3c = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-chip-on'))
          .some((n) => (n.textContent || '').trim().includes('170')));
      }
      record('v6-3c 在纸质版尺码中填入自定义值（回车提交为标签）', typed3c,
        typed3c ? '「170」已作为标签加入' : '未检测到「170」标签');

      const clicked3d = await clickOwnChip('纸质版');
      await new Promise((r) => setTimeout(r, 700));
      const kept3d = await page.evaluate(() => {
        const hint = document.querySelector('[data-testid="iw-kept-纸质版尺码"]');
        return {
          inputExists: !!document.querySelector('input[placeholder="输入纸质版尺码后回车"]'),
          hint: hint ? (hint.textContent || '').trim() : '',
        };
      });
      record('v6-3d 取消勾选「纸质版」：输入隐藏、已填值保留并提示',
        clicked3d && !kept3d.inputExists && kept3d.hint.includes('已保留'),
        `点击 ${clicked3d}，输入框存在 ${kept3d.inputExists}，提示「${kept3d.hint}」`);

      // 重新勾选 → 原值仍在（验证「保存不会清除」）
      await clickOwnChip('纸质版');
      await new Promise((r) => setTimeout(r, 600));
      const restored = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-chip-on'))
        .map((n) => (n.textContent || '').trim()));
      record('v6-3e 重新勾选「纸质版」：先前填入的尺码仍在（数据未被清除）',
        restored.some((t) => t.includes('170')), `标签 ${JSON.stringify(restored)}`);

      /* ---------------- v6.1 三项修改（浏览器逐项验证） ---------------- */
      // 需求 1：拥有形态分区字段顺序 —— 多选在前，两个尺码字段在后
      const ownOrder = await page.evaluate(() => {
        const section = document.querySelectorAll('.iw-form-section')[1];
        const labels = Array.from(section.querySelectorAll('.iw-label')).map((el) => el.textContent || '');
        const i = (t) => labels.findIndex((l) => l.startsWith(t));
        return { labels, own: i('拥有形态'), esize: i('电子版尺码'), paper: i('纸质版尺码') };
      });
      record('v6.1-1 「拥有形态」分区顺序：拥有形态 → 电子版尺码 → 纸质版尺码',
        ownOrder.own >= 0 && ownOrder.own < ownOrder.esize && ownOrder.esize < ownOrder.paper,
        `分区标签序 ${JSON.stringify(ownOrder.labels)}`);

      // 需求 2：状态及评价（v6.5 起全站隐藏「推荐」「计划」，分区只剩「做过」）
      const statusInfo = await page.evaluate(() => {
        const section = document.querySelectorAll('.iw-form-section')[2];
        const labels = Array.from(section.querySelectorAll('.iw-label')).map((el) => el.textContent || '');
        const i = (t) => labels.findIndex((l) => l.startsWith(t));
        const planSelect = document.querySelector('#fld-计划');
        const options = planSelect ? Array.from(planSelect.options).map((o) => o.value) : [];
        return { labels, done: i('做过'), rec: i('推荐'), plan: i('计划'), options };
      });
      record('v6.5-1a 「状态及评价」分区只有「做过」，不再渲染「推荐」「计划」',
        statusInfo.done >= 0 && statusInfo.rec < 0 && statusInfo.plan < 0 && statusInfo.options.length === 0,
        `分区标签序 ${JSON.stringify(statusInfo.labels)}，#fld-计划=${statusInfo.options.length === 0 ? '不存在' : '仍存在'}`);

      // 需求 3：电子版尺码快捷标签双轨 + 联动保留
      const esizeGroups = await page.evaluate(() => {
        const field = Array.from(document.querySelectorAll('.iw-field')).find(
          (el) => ((el.querySelector('.iw-label') || {}).textContent || '').startsWith('电子版尺码'),
        );
        if (!field) return null;
        return Array.from(field.querySelectorAll('.iw-quick-tags'))
          .map((g) => (g.querySelector('.iw-quick-tags-label') || {}).textContent || '');
      });
      record('v6.1-4 电子版尺码提供字母码/身高码两组快捷标签（与纸质版同款交互）',
        !!esizeGroups && esizeGroups.length === 2 && esizeGroups[0] === '字母码' && esizeGroups[1] === '身高码',
        `分组 ${esizeGroups ? esizeGroups.join('/') : '未找到电子版尺码字段'}`);

      // v6.1：样本记录（#1）迁移后字母码全在身，先移除「M」再点快捷标签验证「点选即填入」
      const removedM = await page.evaluate(() => {
        const btn = document.querySelector('button[aria-label="移除标签 M"]');
        if (!btn) return false;
        btn.click();
        return true;
      });
      await new Promise((r) => setTimeout(r, 700));
      const mGone = await page.evaluate(() => !document.querySelector('button[aria-label="移除标签 M"]'));
      const clickedEs = await page.evaluate(() => {
        const btn = document.querySelector('button[aria-label="电子版尺码 快捷字母码 M"]');
        if (!btn) return false;
        btn.click();
        return true;
      });
      await new Promise((r) => setTimeout(r, 700));
      const esChipOn = await page.evaluate(() => !!document.querySelector('button[aria-label="移除标签 M"]'));
      record('v6.1-5 点选电子版尺码快捷标签「M」即填入（点前先移除，可重新点选回填）',
        removedM && mGone && clickedEs && esChipOn,
        `移除 ${removedM}，移除后消失 ${mGone}，点击 ${clickedEs}，已选标签「M」${esChipOn ? '出现' : '未出现'}`);

      await clickOwnChip('电子版');
      await new Promise((r) => setTimeout(r, 700));
      const esKept = await page.evaluate(() => {
        const hint = document.querySelector('[data-testid="iw-kept-电子版尺码"]');
        const esInputVisible = Array.from(document.querySelectorAll('input[placeholder]'))
          .some((i) => (i.getAttribute('placeholder') || '').includes('电子版尺码'));
        return { hint: hint ? hint.textContent || '' : '', esInputVisible };
      });
      record('v6.1-6 取消勾选「电子版」：输入隐藏、已填尺码保留并提示',
        esKept.hint.includes('已保留') && !esKept.esInputVisible,
        `提示「${esKept.hint}」，电子版输入框可见 ${esKept.esInputVisible}`);
      await clickOwnChip('电子版');
      await new Promise((r) => setTimeout(r, 700));
      const esRestored = await page.evaluate(() => !!document.querySelector('button[aria-label="移除标签 M"]'));
      record('v6.1-7 重新勾选「电子版」：已填的「M」仍在（数据未被清除）', esRestored,
        esRestored ? '「M」已恢复显示' : '「M」丢失');

      // 详情页：迁移后的电子版尺码标签与「计划」取值展示（锚定当前数据）
      const esizeRec = allFile.records.find((r) => (r['电子版尺码'] || []).length > 0
        && (r['拥有形态'] || []).includes('电子版'));
      if (esizeRec) {
        await goto(`#/detail/${esizeRec.id}`);
        const detText = await bodyText();
        const esTags = esizeRec['电子版尺码'];
        record('v6.1-8 详情页展示电子版尺码双轨标签（迁移后标签原样展示）',
          detText.includes('电子版尺码') && detText.includes(esTags.join('、')),
          `#${esizeRec.id} 标签 ${esTags.length} 个（${esTags[0]}…${esTags[esTags.length - 1]}）`);
        // v6.4 需求 7：详情页不再展示「推荐」「计划」字段；取值改到编辑表单核对（编辑表单保留这两个字段）
        const detKeys = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-kv-key'))
          .map((n) => (n.textContent || '').trim()));
        record('v6.4-7 详情页不再展示「推荐」「计划」字段',
          !detKeys.includes('推荐') && !detKeys.includes('计划'), `详情键：${detKeys.join('、')}`);
        await goto(`#/editor/${esizeRec.id}`);
        const editorNoRecPlan = await page.evaluate(() => {
          const labels = Array.from(document.querySelectorAll('.iw-label')).map((el) => (el.textContent || '').trim());
          return {
            planSel: !!document.querySelector('#fld-计划'),
            recSel: !!document.querySelector('#fld-推荐'),
            hasRec: labels.includes('推荐'),
            hasPlan: labels.includes('计划'),
          };
        });
        record('v6.5-1b 编辑表单不再渲染「推荐」「计划」字段（v6.4 的保留口径随 v6.5 撤销，数据不动）',
          !editorNoRecPlan.planSel && !editorNoRecPlan.recSel && !editorNoRecPlan.hasRec && !editorNoRecPlan.hasPlan,
          `#fld-推荐=${editorNoRecPlan.recSel}，#fld-计划=${editorNoRecPlan.planSel}，`
            + `标签含推荐=${editorNoRecPlan.hasRec}，标签含计划=${editorNoRecPlan.hasPlan}`);
      } else {
        record('v6.1-8 详情页展示电子版尺码双轨标签', false, '当前数据中未找到含电子版尺码标签的记录');
      }

      // v6.4 需求 4：条件尺码展示 —— 未拥有的形态，其尺码字段整个不渲染（详情页）
      await goto(`#/detail/${target.id}`);
      const targetKeys = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-kv-key'))
        .map((n) => (n.textContent || '').trim()));
      record('v6.4-4a 详情页：仅拥有电子版 → 无「纸质版尺码」行、有「电子版尺码」行',
        !targetKeys.includes('纸质版尺码') && targetKeys.includes('电子版尺码'),
        `#${target.id} 详情键：${targetKeys.join('、')}`);
      const bothOwned = allFile.records.find((r) =>
        (r['拥有形态'] || []).includes('纸质版') && (r['拥有形态'] || []).includes('电子版') && String(r['名称'] || '').trim());
      if (bothOwned) {
        await goto(`#/detail/${bothOwned.id}`);
        const bothKeys = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-kv-key'))
          .map((n) => (n.textContent || '').trim()));
        record('v6.4-4b 详情页：两种形态都拥有 → 两个尺码行都展示',
          bothKeys.includes('纸质版尺码') && bothKeys.includes('电子版尺码'),
          `#${bothOwned.id} 详情键：${bothKeys.join('、')}`);
      }

      // 需求 5：编号搜索（「#编号」与纯数字）
      await goto('#/list');
      const searchPlaceholder = await page.evaluate(() => {
        const i = document.querySelector('input[placeholder*="编号"]');
        return i ? i.getAttribute('placeholder') || '' : '';
      });
      record('v6-5 搜索框支持编号（占位含「编号」）', !!searchPlaceholder, `占位「${searchPlaceholder}」`);

      const typeSearch = async (text) => {
        const h = await page.evaluateHandle(() => document.querySelector('input[placeholder*="编号"]'));
        if (!h) return false;
        await h.focus();
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(text, { delay: 40 });
        return true;
      };
      await typeSearch(`#${target.id}`);
      const searchHash = await waitFor(async () => {
        const st = await page.evaluate((name) => {
          const rows = Array.from(document.querySelectorAll('.iw-table tbody tr'));
          return { count: rows.length, hit: rows.some((r) => (r.textContent || '').includes(name)) };
        }, String(target['名称']));
        return st.count === 1 && st.hit;
      }, 10000);
      record('v6-5b 用「#编号」搜索只命中该记录', searchHash,
        searchHash ? `#${target.id}（${target['名称']}）唯一命中` : '未唯一命中');

      await typeSearch(String(target.id));
      const digitHit = await waitFor(async () => {
        const st = await page.evaluate((name) => {
          const rows = Array.from(document.querySelectorAll('.iw-table tbody tr'));
          return { count: rows.length, hit: rows.some((r) => (r.textContent || '').includes(name)) };
        }, String(target['名称']));
        return st.hit;
      }, 10000);
      record('v6-5c 用纯数字编号搜索也能命中该记录', digitHit,
        digitHit ? `纯数字「${target.id}」命中「${target['名称']}」` : '未命中');

      /* v6.4 需求 5/6：列表「教程」三态与「做过」两态（搜索定位行，锚定当前数据） */
      const cellOf = async (recId, colName) => {
        await typeSearch(`#${recId}`);
        await new Promise((r) => setTimeout(r, 600));
        return page.evaluate((cn) => {
          const heads = Array.from(document.querySelectorAll('.iw-table thead th'))
            .map((h) => (h.textContent || '').trim());
          const idx = heads.findIndex((h) => h.startsWith(cn));
          if (idx < 0) return { found: false, text: `no-col:${cn}` };
          const row = document.querySelector('.iw-table tbody tr');
          const cells = row ? Array.from(row.querySelectorAll('td')) : [];
          return { found: true, text: cells[idx] ? (cells[idx].textContent || '').trim() : 'no-cell' };
        }, colName);
      };
      const tutYes = allFile.records.find((r) => r['教程'] === '有');
      const tutNo = allFile.records.find((r) => r['教程'] === '无');
      const tutUnk = allFile.records.find((r) => !r['教程'] || r['教程'] === '未知');
      const doneYes = allFile.records.find((r) => r['做过'] === true);
      const doneNo = allFile.records.find((r) => r['做过'] === false && String(r['名称'] || '').trim());
      if (tutYes && tutNo && tutUnk && doneYes && doneNo) {
        const t1 = await cellOf(tutYes.id, '教程');
        record('v6.4-5 列表「教程」列：有 → ✓', t1.found && t1.text === '✓', `#${tutYes.id} 单元格「${t1.text}」`);
        const t2 = await cellOf(tutNo.id, '教程');
        record('v6.4-5 列表「教程」列：无 → ✗', t2.found && t2.text === '✗', `#${tutNo.id} 单元格「${t2.text}」`);
        const t3 = await cellOf(tutUnk.id, '教程');
        record('v6.4-5 列表「教程」列：未填 → 留空', t3.found && t3.text === '', `#${tutUnk.id} 单元格「${t3.text}」`);
        const d1 = await cellOf(doneYes.id, '做过');
        record('v6.4-6 列表「做过」列：做过 → ✓', d1.found && d1.text === '✓', `#${doneYes.id} 单元格「${d1.text}」`);
        const d2 = await cellOf(doneNo.id, '做过');
        record('v6.4-6 列表「做过」列：未做 → 留空', d2.found && d2.text === '', `#${doneNo.id} 单元格「${d2.text}」`);
        const headTexts = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-table thead th'))
          .map((h) => (h.textContent || '').trim()));
        record('v6.4-6 列表表头无「标记」列（已替换为「做过」）',
          !headTexts.some((h) => h.startsWith('标记')) && headTexts.some((h) => h.startsWith('做过')),
          `表头：${headTexts.join('、')}`);
      } else {
        record('v6.4-5/6 列表图标口径样本齐全', false, '当前数据缺少教程/做过口径样本');
      }
    }

    // 需求 4：默认排序为名称拼音升序（清掉本地偏好后重进列表）
    await page.evaluate(() => { localStorage.removeItem('iw.prefs'); });
    await goto('#/list');
    const sortInfo = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.iw-table tbody tr'));
      const cells = rows.length ? Array.from(rows[0].querySelectorAll('td')).map((c) => (c.textContent || '').trim()) : [];
      const heads = Array.from(document.querySelectorAll('.iw-table thead th')).map((h) => (h.textContent || '').trim());
      return { firstRow: cells, heads, hash: window.location.hash, rowCount: rows.length };
    });
    const expectedFirst = allFile.records
      .filter((r) => String(r['名称'] || '').trim())
      .slice()
      .sort((a, b) => APP_COLLATOR.compare(String(a['名称']), String(b['名称'])))[0];
    record('v6-4 列表默认按名称拼音升序（表头「名称↑」、首行 = 拼音序第一条、URL 不带排序参数）',
      !!expectedFirst
        && sortInfo.hash.includes('/list') && !sortInfo.hash.includes('sort=')
        && sortInfo.heads.some((h) => h.startsWith('名称') && h.includes('↑'))
        && sortInfo.firstRow.some((c) => c.includes(String(expectedFirst['名称']))),
      `表头 ${JSON.stringify(sortInfo.heads.slice(0, 3))}，首行=${sortInfo.firstRow.slice(0, 3).join(' | ')}，`
        + `拼音序第一条=${expectedFirst ? expectedFirst['名称'] : '?'}，hash=${sortInfo.hash}`);



    /* ---------------- v6.5 九项修改（浏览器逐项验证 · 阶段 A 完整数据） ---------------- */
    await goto('#/list');
    const typeSearch65 = async (text) => {
      const h = await page.evaluateHandle(() => document.querySelector('input[placeholder*="编号"]'));
      await h.focus();
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(text, { delay: 40 });
    };
    const cellByCol65 = async (recId, colName) => {
      await typeSearch65(`#${recId}`);
      await new Promise((r) => setTimeout(r, 700));
      return page.evaluate((cn) => {
        const heads = Array.from(document.querySelectorAll('.iw-table thead th')).map((h) => (h.textContent || '').trim());
        const idx = heads.findIndex((h) => h === cn);
        if (idx < 0) return { found: false, text: `no-col:${cn}` };
        const tr = document.querySelector('.iw-table tbody tr');
        const tds = tr ? Array.from(tr.querySelectorAll('td')) : [];
        return { found: true, text: tds[idx] ? (tds[idx].textContent || '').trim() : 'no-cell' };
      }, colName);
    };
    const rowClass65 = async (recId) => {
      await typeSearch65(`#${recId}`);
      await new Promise((r) => setTimeout(r, 700));
      return page.evaluate(() => {
        const tr = document.querySelector('.iw-table tbody tr');
        return tr ? (tr.className || '') : '(no-row)';
      });
    };

    // 需求 1 + 9：表头「电子」「纸质」两列拆分；「形态 / 推荐 / 计划」消失
    const headTexts65 = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-table thead th'))
      .map((h) => (h.textContent || '').trim()));
    record('v6.5-1/9 列表表头含「电子」「纸质」两列，且无「形态/推荐/计划」',
      headTexts65.includes('电子') && headTexts65.includes('纸质')
        && !headTexts65.includes('形态') && !headTexts65.includes('推荐') && !headTexts65.includes('计划'),
      `表头：${headTexts65.join('、')}`);

    const onlyE65 = allFile.records.find((r) => (r['拥有形态'] || []).includes('电子版') && !(r['拥有形态'] || []).includes('纸质版'));
    const onlyP65 = allFile.records.find((r) => (r['拥有形态'] || []).includes('纸质版') && !(r['拥有形态'] || []).includes('电子版'));
    if (onlyE65 && onlyP65) {
      const e1 = await cellByCol65(onlyE65.id, '电子');
      const p1 = await cellByCol65(onlyE65.id, '纸质');
      const e2 = await cellByCol65(onlyP65.id, '电子');
      const p2 = await cellByCol65(onlyP65.id, '纸质');
      record('v6.5-9 「电子」「纸质」列按勾选分别显示 ✓ / ×',
        e1.text === '✓' && p1.text === '×' && e2.text === '×' && p2.text === '✓',
        `#${onlyE65.id} 电子=${e1.text}/纸质=${p1.text}；#${onlyP65.id} 电子=${e2.text}/纸质=${p2.text}`);
    } else {
      record('v6.5-9 「电子」「纸质」列口径样本齐全', false, '当前数据缺少「仅电子版 / 仅纸质版」样本对');
    }

    // 需求 8 + v6.8 需求 5 + v6.9 需求 3：行标注色单规则 —— 没做过且不在任何清单 → 浅黄；其余不填色
    const plansSnap65 = await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('iw.cache') || '{}');
      return (c.plans || []).map((p) => p['记录ID列表'] || []);
    });
    const memberIds65 = new Set();
    for (const list of plansSnap65) for (const id of list) memberIds65.add(id);
    const outPlanRec65 = allFile.records.find((r) => String(r['名称'] || '').trim() && !memberIds65.has(r.id) && !r['做过']);
    const inPlanRec65 = allFile.records.find((r) => String(r['名称'] || '').trim() && memberIds65.has(r.id));
    if (outPlanRec65 && inPlanRec65) {
      const clsOut = await rowClass65(outPlanRec65.id);
      const clsIn = await rowClass65(inPlanRec65.id);
      record('v6.5-8/v6.9-3 行标注色单规则：没做过且不在任何清单 → 浅黄（iw-row-noformat），在清单 → 不填色',
        clsOut.includes('iw-row-noformat') && !clsOut.includes('iw-row-incomplete')
          && !clsIn.includes('iw-row-noformat') && !clsIn.includes('iw-row-incomplete'),
        `不在清单未做过 #${outPlanRec65.id}=${clsOut || '(无class)'}；在清单 #${inPlanRec65.id}=${clsIn || '(无class)'}`);
    } else {
      record('v6.5-8/v6.9-3 行标注色单规则口径样本齐全', false,
        `不在清单未做过样本=${!!outPlanRec65}，在清单样本=${!!inPlanRec65}`);
    }

    // v6.9-3 边界：做过 ✓ 且不在任何清单 → 不标色（做过豁免）
    const doneOutRec65 = allFile.records.find((r) => String(r['名称'] || '').trim() && !memberIds65.has(r.id) && r['做过'] === true);
    if (doneOutRec65) {
      const clsDone = await rowClass65(doneOutRec65.id);
      record('v6.9-3 边界：做过且不在任何清单 → 不标浅黄',
        !clsDone.includes('iw-row-noformat') && !clsDone.includes('iw-row-incomplete'),
        `做过不在清单 #${doneOutRec65.id}=${clsDone || '(无class)'}`);
    } else {
      record('v6.9-3 边界样本齐全（做过且不在清单）', false, '当前数据缺少「做过 ✓ 且不在任何清单」样本');
    }

    // 需求 6：搜索子串匹配（回归：搜「89」命中「896文艺套装-上衣」）
    const rec896 = allFile.records.find((r) => String(r['名称'] || '').includes('896文艺套装-上衣'));
    if (rec896) {
      await typeSearch65('89');
      const hit89 = await waitFor(async () => page.evaluate((n) => Array.from(document.querySelectorAll('.iw-table tbody tr'))
        .some((tr) => (tr.textContent || '').includes(n)), String(rec896['名称'])), 8000);
      record('v6.5-6 搜索「89」命中「896文艺套装-上衣」（子串匹配修复回归）', hit89,
        `目标 #${rec896.id}「${rec896['名称']}」${hit89 ? '已命中' : '未命中'}`);
    } else {
      const anyNamed65 = allFile.records.find((r) => String(r['名称'] || '').length >= 4);
      const sub65 = anyNamed65 ? String(anyNamed65['名称']).slice(1, 3) : '';
      await typeSearch65(sub65);
      const hitSub = await waitFor(async () => page.evaluate((n) => Array.from(document.querySelectorAll('.iw-table tbody tr'))
        .some((tr) => (tr.textContent || '').includes(n)), anyNamed65 ? String(anyNamed65['名称']) : ''), 8000);
      record(`v6.5-6 搜索按子串命中（数据无 896 样本，用「${sub65}」兜底）`, hitSub,
        anyNamed65 ? `子串「${sub65}」${hitSub ? '命中' : '未命中'}「${anyNamed65['名称']}」` : '无长名称样本');
    }

    // 需求 7：搜索框「×」清空 → 输入清空、恢复完整列表、按钮随之消失
    const clearBtnBefore65 = await page.evaluate(() => !!document.querySelector('[data-testid="iw-search-clear"]'));
    await page.click('[data-testid="iw-search-clear"]');
    await new Promise((r) => setTimeout(r, 700));
    const afterClear65 = await page.evaluate(() => ({
      val: ((document.querySelector('input[placeholder*="编号"]') || { value: '?' }).value) || '',
      rows: document.querySelectorAll('.iw-table tbody tr').length,
      btn: !!document.querySelector('[data-testid="iw-search-clear"]'),
    }));
    record('v6.5-7 搜索框「×」清空：清空输入、恢复完整列表、按钮消失',
      clearBtnBefore65 && afterClear65.val === ''
        && afterClear65.rows === Math.min(allFile.records.length, 50) && !afterClear65.btn,
      `清空前按钮=${clearBtnBefore65}，清空后输入=「${afterClear65.val}」，`
        + `行数=${afterClear65.rows}（期望 ${Math.min(allFile.records.length, 50)}），按钮残留=${afterClear65.btn}`);

    // 需求 4 + 5：筛选面板「尺码」（OR 口径）与「拥有形态：均没有」
    await clickByText('筛选条件');
    await new Promise((r) => setTimeout(r, 500));
    const panelTitles65 = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-filter-block-title'))
      .map((el) => (el.textContent || '').trim()));
    const panelLabels65 = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-filter-panel button'))
      .map((b) => b.getAttribute('aria-label') || (b.textContent || '').trim()));
    record('v6.5-4/5 筛选面板：标题为「尺码」（非「电子版尺码」），拥有形态含「均没有」',
      panelTitles65.includes('尺码') && !panelTitles65.includes('电子版尺码')
        && panelLabels65.some((l) => l.includes('拥有形态：均没有')),
      `标题：${panelTitles65.join('、')}`);

    const sizeRec65 = allFile.records.find((r) => (r['电子版尺码'] || []).length || (r['纸质版尺码'] || []).length);
    if (sizeRec65) {
      const esz65 = sizeRec65['电子版尺码'] || [];
      const psz65 = sizeRec65['纸质版尺码'] || [];
      const tag65 = (esz65.length ? esz65 : psz65)[0];
      const expectedSize65 = allFile.records.filter((r) => (r['电子版尺码'] || []).includes(tag65)
        || (r['纸质版尺码'] || []).includes(tag65)).length;
      await page.evaluate((lbl) => {
        const btn = Array.from(document.querySelectorAll('.iw-filter-panel button'))
          .find((b) => (b.getAttribute('aria-label') || '') === lbl);
        if (btn) btn.click();
      }, `尺码：${tag65}`);
      await new Promise((r) => setTimeout(r, 900));
      const sizeRows65 = await page.evaluate(() => document.querySelectorAll('.iw-table tbody tr').length);
      record('v6.5-4 「尺码」筛选 OR 口径：命中电子版尺码或纸质版尺码任一含该尺码的记录',
        expectedSize65 > 0 && sizeRows65 === Math.min(expectedSize65, 50),
        `尺码「${tag65}」：命中 ${sizeRows65} 行，数据推导期望 ${expectedSize65}`);
      // 再点一次取消，避免影响后续「均没有」口径
      await page.evaluate((lbl) => {
        const btn = Array.from(document.querySelectorAll('.iw-filter-panel button'))
          .find((b) => (b.getAttribute('aria-label') || '') === lbl);
        if (btn) btn.click();
      }, `尺码：${tag65}`);
      await new Promise((r) => setTimeout(r, 700));
      // 需求 5：均没有 —— 筛出两种形态都未勾选的记录
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.iw-filter-panel button'))
          .find((b) => (b.getAttribute('aria-label') || '') === '拥有形态：均没有');
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 900));
      const noneRows65 = await page.evaluate(() => document.querySelectorAll('.iw-table tbody tr').length);
      const expectedNone65 = allFile.records.filter((r) => !(r['拥有形态'] || []).length).length;
      record('v6.5-5 「拥有形态：均没有」筛出两种形态都未勾选的记录',
        expectedNone65 > 0 && noneRows65 === Math.min(expectedNone65, 50),
        `命中 ${noneRows65} 行，数据推导期望 ${expectedNone65}`);
    } else {
      record('v6.5-4/5 尺码/形态筛选样本齐全', false, '当前数据没有可用的尺码样本');
    }
    // 清掉筛选，恢复干净状态供后续断言使用
    await clickByText('清空条件');
    await new Promise((r) => setTimeout(r, 700));
    await goto('#/list');

    /* 6b. 操作日志：连续触发 5 次导出，只保留最近 3 条 */
    await goto('/settings');
    await navTo('data');
    for (let i = 0; i < 5; i += 1) {
      await clickByText('导出全部 JSON', '.iw-main');
      await new Promise((r) => setTimeout(r, 350));
    }
    await new Promise((r) => setTimeout(r, 500));
    await navTo('connection');
    const logInfo = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.iw-log-item')).map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim());
      const title = document.querySelector('.iw-log-title');
      return { items, title: title ? (title.textContent || '').trim() : '' };
    });
    record('v4 操作日志只保留最近 3 条', logInfo.items.length === 3,
      `日志条数 ${logInfo.items.length}${logInfo.items.length ? `：${logInfo.items[0]}` : ''}`);
    record('v4 操作日志条目含时间 / 类型 / 结果',
      logInfo.items.every((t) => /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t) && t.includes('导出') && (t.includes('成功') || t.includes('失败'))),
      logInfo.items[0] || '无日志');
    const logStored = await page.evaluate(() => {
      const raw = localStorage.getItem('iw.actionlog');
      if (!raw) return null;
      try { const j = JSON.parse(raw); return Array.isArray(j) ? j.length : null; } catch (e) { return 'parse-error'; }
    });
    record('v4 操作日志写入浏览器本地存储（iw.actionlog）', logStored === 3, `本地存储条数 ${logStored}`);

    /* 7. 导出（入口在设置页 › 数据管理） */
    const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iw-smoke-dl-'));
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    await goto('/settings');
    await navTo('data');
    const clicked = await clickByText('导出全部 Excel', '.iw-main');
    let xlsxFile = null;
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const files = fs.existsSync(dlDir) ? fs.readdirSync(dlDir).filter((f) => f.endsWith('.xlsx')) : [];
      if (files.length) { xlsxFile = path.join(dlDir, files[0]); break; }
      await new Promise((r) => setTimeout(r, 300));
    }
    record('设置页点击「导出全部 Excel」生成 Excel 文件', Boolean(xlsxFile) && fs.statSync(xlsxFile || '.').size > 0,
      xlsxFile ? `${path.basename(xlsxFile)}（${fs.statSync(xlsxFile).size} 字节）` : '未捕获到下载文件');

    if (xlsxFile) {
      let columns = [];
      let rows = 0;
      try {
        const XLSX = require(path.resolve(__dirname, '../node_modules/xlsx'));
        const wb = XLSX.read(fs.readFileSync(xlsxFile), { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        columns = (matrix[0] || []).map((c) => String(c));
        rows = (matrix.length || 0) - 1;
      } catch (e) {
        columns = [];
      }
      record('导出列含「拥有形态」且不含旧的两个单选列（v5 合并）',
        columns.includes('拥有形态') && !columns.includes('电子版') && !columns.includes('纸质版'),
        columns.filter((c) => ['拥有形态', '电子版', '纸质版', '拥有电子版', '拥有纸质版'].includes(c)).join('、') || '未找到');
      record('v6.1 导出列含「电子版尺码」与「计划」，旧列名（想做/电子版尺码组）消失',
        columns.includes('电子版尺码') && columns.includes('计划')
          && !columns.includes('想做') && !columns.includes('电子版尺码组'),
        columns.filter((c) => ['电子版尺码', '计划', '想做', '电子版尺码组'].includes(c)).join('、') || '未找到相关列');
      record('导出列不含「关联」「电子版缺码」',
        !columns.includes('关联') && !columns.includes('电子版缺码'),
        columns.join('、').slice(0, 120));
      record('导出数据行数 > 0', rows > 0, `${rows} 行`);
    }

    /* 8. 删除记录流程（v4 第 4 条：二次确认 + 直接物理删除） */
    await goto('/list');
    const rowsBefore = await hasRows();
    // 总记录数（列表页标题栏「共 N 条记录」）—— 物理删除看的是总数，不是当前页行数
    const totalOf = async () => page.evaluate(() => {
      const el = document.querySelector('.iw-page-sub');
      const m = el ? /共\s*(\d+)\s*条/.exec(el.textContent || '') : null;
      return m ? Number(m[1]) : null;
    });
    const totalBefore = await totalOf();
    const firstRowName = await page.evaluate(() => {
      const row = document.querySelector('.iw-table tbody tr');
      const cell = row ? row.querySelector('td') : null;
      return cell ? (cell.textContent || '').trim() : '';
    });
    const openDelete = async () => page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.iw-table tbody tr'));
      for (const r of rows) {
        const btn = Array.from(r.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '删除');
        if (btn) { btn.click(); return true; }
      }
      return false;
    });
    const opened = await openDelete();
    await waitFor(async () => await page.$('.iw-modal') !== null, 5000);
    const modalText = await page.evaluate(() => {
      const m = document.querySelector('.iw-modal');
      return m ? m.innerText : '';
    });
    record('v4 删除有二次确认弹窗', Boolean(opened) && modalText.includes('确认删除这条记录'),
      modalText.split('\n')[0] || '未出现弹窗');
    record('v4 删除弹窗说明「立即从数据中移除、无回收站」',
      modalText.includes('立即从数据中移除') && modalText.includes('没有回收站'),
      modalText.replace(/\s+/g, ' ').slice(0, 80));
    // 先取消 → 数据不变
    await clickByText('取消', '.iw-modal');
    await new Promise((r) => setTimeout(r, 400));
    const totalAfterCancel = await totalOf();
    record('v4 删除弹窗取消后记录仍在', totalAfterCancel === totalBefore,
      `取消前共 ${totalBefore} 条 → 取消后共 ${totalAfterCancel} 条`);
    // 再删除并确认 → 记录从数据里消失
    await openDelete();
    await waitFor(async () => await page.$('.iw-modal') !== null, 5000);
    await clickByText('删除', '.iw-modal');
    await new Promise((r) => setTimeout(r, 800));
    const totalAfterDelete = await totalOf();
    const tableTextAfter = await page.evaluate(() => {
      const t = document.querySelector('.iw-table');
      return t ? t.innerText : '';
    });
    record('v4 确认后记录直接消失（物理删除，无回收站）',
      totalBefore !== null && totalAfterDelete === totalBefore - 1,
      `删除前共 ${totalBefore} 条 → 删除后共 ${totalAfterDelete} 条（当前页行数 ${rowsBefore} → ${await hasRows()}，删除后由下一页补位）`);
    record('v4 被删记录不再出现在表格里', Boolean(firstRowName) && !tableTextAfter.includes(firstRowName),
      `被删记录「${firstRowName}」${tableTextAfter.includes(firstRowName) ? '仍在表格中' : '已从表格移除'}`);
    const noTrash = await bodyText();
    record('v4 页面无「回收站」入口', !noTrash.includes('回收站'), '未出现');


    /* ---------------- v6.2 计划清单 + 身高码（浏览器逐项验证） ---------------- */
    // 需求 1：创建清单 → 记录加入清单 → 按清单筛选 → 刷新后仍在 → 同步写回 plans.json
    // v6.8（需求 1）：设置页计划清单管理区已移除，清单在「清单」页签创建
    await goto('#/settings');
    const noPlansAdmin = await page.evaluate(() => !document.querySelector('[data-testid="iw-new-plan-name"]')
      && !document.querySelector('[data-testid="iw-plans-admin"]')
      && !document.body.innerText.includes('新建清单'));
    record('v6.8-1 设置页无「计划清单」管理区与新建入口（创建移至「清单」页签）', noPlansAdmin,
      noPlansAdmin ? '设置页无新建清单输入框、无计划清单管理区' : '设置页仍残留计划清单管理元素');
    const planInputOk = true; // v6.8：清单在「清单」页签的新增弹层里创建
    if (planInputOk) {
      await goto('#/plans');
      await page.evaluate(() => document.querySelector('[data-testid="iw-plans-new"]').click());
      await new Promise((r) => setTimeout(r, 600));
      await page.focus('[data-testid="iw-new-plan-name"]');
      await page.keyboard.type('2026 春季');
      await new Promise((r) => setTimeout(r, 300));
      await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return;
        const btn = Array.from(dlg.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '创建清单');
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 900));
      const plansAfterCreate = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="iw-plan-card-title-"]'))
        .map((el) => (el.textContent || '').trim()));
      const springCreatedRaw = await page.evaluate(() => {
        const c = JSON.parse(localStorage.getItem('iw.cache') || '{}');
        const p = (c.plans || []).find((x) => x['名称'] === '2026 春季');
        return p ? (p['记录ID列表'] || []).length : -1;
      });
      record('v6.2-2/v6.8-1 清单页新建清单「2026 春季」出现在模块卡片（初始 0 条成员）',
        plansAfterCreate.some((t) => t.includes('2026 春季')) && springCreatedRaw === 0,
        `卡片标题：${plansAfterCreate.join(' / ') || '（空）'}；缓存成员数=${springCreatedRaw}`);

      // 把一条真实记录加入清单（详情页计划清单卡片 chip）
      // v6.9：选「没做过」的记录 —— 后续 v6.8-2c 断言「移出清单后整行转浅黄」依赖该口径
      const joinTarget = allFile.records.find((r) => String(r['名称'] || '').trim() && !r['做过']);
      await goto(`#/detail/${joinTarget.id}`);
      const chipSel = '[data-testid="iw-plan-chips"] button';
      const chipOk = await waitFor(async () => (await page.evaluate((c) => document.querySelectorAll(c).length, chipSel)) > 0, 5000);
      if (chipOk) {
        const joined = await page.evaluate((sel) => {
          const btn = Array.from(document.querySelectorAll(sel)).find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
          if (!btn) return false;
          btn.click();
          return true;
        }, chipSel);
        await new Promise((r) => setTimeout(r, 700));
        const planCard = await page.evaluate(() => {
          const card = document.querySelector('[data-testid="iw-plan-card"]');
          return card ? card.textContent || '' : '';
        });
        record('v6.2-3 详情页把记录加入「2026 春季」（chip 已选中、计数 1 条）',
          joined && planCard.includes('2026 春季（1）') && planCard.includes('当前共在 1 份清单里'),
          `卡片内容：${planCard.slice(0, 80)}`);

        // 列表页按计划清单筛选
        await goto('#/list');
        await clickByText('筛选条件');
        await new Promise((r) => setTimeout(r, 500));
        const filterChipLabels = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-filter-panel button'))
          .map((b) => b.getAttribute('aria-label') || ''));
        record('v6.4-7 筛选面板不再出现「推荐」「计划」筛选项（计划清单保留）',
          !filterChipLabels.some((l) => l.includes('推荐'))
            && !filterChipLabels.some((l) => l.includes('计划') && !l.includes('计划清单'))
            && filterChipLabels.some((l) => l.includes('计划清单：2026 春季')),
          `面板按钮 ${filterChipLabels.length} 个`);
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('.iw-filter-panel button'))
            .find((b) => (b.getAttribute('aria-label') || '').includes('计划清单：2026 春季'));
          if (btn) btn.click();
        });
        await new Promise((r) => setTimeout(r, 900));
        const filteredRows = await page.evaluate(() => document.querySelectorAll('.iw-table tbody tr').length);
        record('v6.2-4 按清单筛选后列表只含该记录', filteredRows === 1, `筛选后行数 ${filteredRows}（期望 1）`);

        // 刷新后成员关系仍在（本地缓存持久化；URL→store 单向同步是全应用既有行为，
        // 筛选状态本身不随 hash 走，故在详情页验证清单成员关系刷新后保持）
        await page.reload({ waitUntil: 'networkidle2' });
        await new Promise((r) => setTimeout(r, 900));
        await goto(`#/detail/${joinTarget.id}`);
        const membershipAfterReload = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('[data-testid="iw-plan-chips"] button'))
            .find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
          return btn ? btn.getAttribute('aria-pressed') === 'true' : false;
        });
        record('v6.2-5 刷新后计划清单成员关系保持（详情页 chip 仍选中）', membershipAfterReload,
          membershipAfterReload ? `#${joinTarget.id} 仍在「2026 春季」里` : '刷新后成员关系丢失');
        await goto('#/list');

        // 同步写回 plans.json（PUT 拦截）
        await goto('#/settings');
        const putBeforePlans = putCount;
        const putStartIdx26 = putUrls.length;
        await clickByText('同步到 GitHub', '.iw-main');
        // 等目标文件自己的 PUT（同步链是 records→plans→options 串行，
        // 只等 putCount 增长会在 records PUT 与 plans PUT 之间提前扫描 → 假失败）
        await waitFor(async () => putUrls.slice(putStartIdx26).some((u) => u.includes('plans.json')), 15000);
        await new Promise((r) => setTimeout(r, 300));
        const syncTextPlans = await page.evaluate(() => document.body.innerText.slice(0, 2000));
        let plansPutOk = false;
        let plansPutMsg = `未捕获 plans.json PUT；api尾部=[${apiHits.slice(-8).join(' | ')}]；同步状态=「${(syncTextPlans.match(/(同步|拉取|备份)[^\n]{0,80}/) || [''])[0]}」`;
        for (let i = 0; i < putUrls.length; i += 1) {
          if (!putUrls[i].includes('plans.json')) continue;
          try {
            const body = JSON.parse(putBodies[i] || '{}');
            const decoded = JSON.parse(Buffer.from(body.content || '', 'base64').toString('utf8'));
            if (decoded.plans && decoded.plans.some((pl) => pl['名称'] === '2026 春季' && (pl['记录ID列表'] || []).includes(joinTarget.id))) {
              plansPutOk = true;
              plansPutMsg = `写回 plans.json dataVersion=${decoded.dataVersion}，含「2026 春季」与成员 #${joinTarget.id}`;
            }
          } catch (e) { /* skip */ }
        }
        record('v6.2-6 同步把计划清单写回数据仓（PUT plans.json 含清单与成员）', plansPutOk, plansPutMsg);
      } else {
        record('v6.2-3 详情页计划清单 chip 存在', false, '未找到清单 chip');
      }
    }

    /* ---------------- v6.6 清单管理页 + 列表「清单」列 + 标注色新口径 ---------------- */
    // 需求 1：设置页「管理」入口 → 进入清单管理页 → 移除出清单 → 同步（只动 plans.json）→ 搜索加回
    const joinTarget66 = allFile.records.find((r) => String(r['名称'] || '').trim());
    // v6.8（需求 1）：管理入口不再依赖设置页 —— 筛选面板选中清单后「管理清单…」直达清单管理页
    await goto('#/list');
    await clickByText('筛选条件');
    await new Promise((r) => setTimeout(r, 500));
    const manageClicked = await page.evaluate(() => {
      const chip = Array.from(document.querySelectorAll('.iw-filter-panel button'))
        .find((b) => (b.getAttribute('aria-label') || '').includes('计划清单：2026 春季'));
      if (!chip) return false;
      chip.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 700));
    const manageNav = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="iw-filter-manage-plans"]');
      if (b) { b.click(); return true; }
      return false;
    });
    await new Promise((r) => setTimeout(r, 600));
    const planView = await page.evaluate(() => ({
      hash: window.location.hash,
      title: (document.querySelector('[data-testid="iw-plan-title"]') || {}).textContent || '',
      members: document.querySelectorAll('[data-testid="iw-plan-members"] tbody tr').length,
      copy: document.body.innerText.includes('只调整清单成员关系'),
    }));
    record('v6.6-1/v6.8-1 筛选面板「管理清单…」直达清单管理页（标题/成员数/文案）',
      manageClicked && manageNav && planView.hash.includes('#/plan/')
        && planView.title.includes('清单管理：2026 春季')
        && planView.members === 1
        && planView.copy,
      `chip选中=${manageClicked}，管理入口点击=${manageNav}，hash=${planView.hash}，标题=「${planView.title}」，成员 ${planView.members} 条，成员关系文案=${planView.copy}`);

    if (planView.hash.includes('#/plan/')) {
      // 移除出清单：只清成员关系，记录本身不动
      const recordsBefore66 = await page.evaluate(() => JSON.parse(localStorage.getItem('iw.cache') || '{}').records.length);
      await page.click(`[data-testid="iw-plan-remove-${joinTarget66.id}"]`);
      await new Promise((r) => setTimeout(r, 700));
      const afterRemove = await page.evaluate((rid) => {
        const c = JSON.parse(localStorage.getItem('iw.cache') || '{}');
        const plan = (c.plans || []).find((p) => p['名称'] === '2026 春季');
        return {
          memberRows: document.querySelectorAll('[data-testid="iw-plan-members"] tbody tr').length,
          recordsN: c.records.length,
          recordAlive: (c.records || []).some((r) => r.id === rid),
          members: plan ? plan['记录ID列表'] : null,
          hasJoinBack: Boolean(document.querySelector(`[data-testid="iw-plan-add-${rid}"]`)),
        };
      }, joinTarget66.id);
      record('v6.6-2 移除出清单：成员清空、记录仍在、出现在候选里',
        afterRemove.memberRows === 0
          && afterRemove.recordsN === recordsBefore66
          && afterRemove.recordAlive
          && Array.isArray(afterRemove.members) && afterRemove.members.length === 0
          && afterRemove.hasJoinBack,
        `成员行=${afterRemove.memberRows}，记录数=${afterRemove.recordsN}/${recordsBefore66}，记录存在=${afterRemove.recordAlive}，清单成员表=${JSON.stringify(afterRemove.members)}`);

      // 同步：本次只应写 plans.json（成员被移除），records.json 零改动
      // 同步按钮在设置页（连接分组），清单管理页没有 → 先回设置页再点
      const putStart66 = putUrls.length;
      await goto('#/settings');
      await new Promise((r) => setTimeout(r, 400));
      await clickByText('同步到 GitHub', '.iw-main');
      await waitFor(async () => putUrls.slice(putStart66).some((u) => u.includes('plans.json')), 15000);
      await new Promise((r) => setTimeout(r, 300));
      let plansPut66 = null;
      let recordsPut66 = null;
      for (let i = putStart66; i < putUrls.length; i += 1) {
        try {
          const body = JSON.parse(putBodies[i] || '{}');
          const decoded = JSON.parse(Buffer.from(body.content || '', 'base64').toString('utf8'));
          if (putUrls[i].includes('plans.json') && decoded.plans) plansPut66 = decoded;
          if (putUrls[i].includes('records.json') && decoded.records) recordsPut66 = decoded;
        } catch (e) { /* skip */ }
      }
      const canon = (recs) => JSON.stringify((recs || []).slice().sort((a, b) => a.id - b.id)
        .map((r) => { const o = {}; for (const k of Object.keys(r).sort()) o[k] = r[k]; return o; }));
      const plansPutOk66 = plansPut66
        && plansPut66.plans.some((pl) => pl['名称'] === '2026 春季' && !(pl['记录ID列表'] || []).includes(joinTarget66.id));
      const recordsOk66 = recordsPut66 === null || canon(recordsPut66.records) === canon(allFile.records);
      record('v6.6-3 同步只改 plans.json 成员关系（records.json 零改动）',
        Boolean(plansPutOk66) && recordsOk66,
        `plans.json PUT=${plansPutOk66 ? '成员已移除' : (plansPut66 ? '内容不符' : '未捕获')}，records.json PUT=${recordsPut66 === null ? '未发生（无改动不写）' : (recordsOk66 ? '内容与初始完全一致' : '内容发生了变化！')}`);

      // 搜索 #编号 把记录加回清单（回到管理页）
      await goto(planView.hash);
      await page.focus('[data-testid="iw-plan-add-search"]');
      await page.keyboard.type(`#${joinTarget66.id}`);
      await new Promise((r) => setTimeout(r, 300));
      const candidateVisible = await page.evaluate((rid) => Boolean(document.querySelector(`[data-testid="iw-plan-add-${rid}"]`)), joinTarget66.id);
      await page.click(`[data-testid="iw-plan-add-${joinTarget66.id}"]`);
      await new Promise((r) => setTimeout(r, 700));
      const afterAdd = await page.evaluate((rid) => {
        const c = JSON.parse(localStorage.getItem('iw.cache') || '{}');
        const plan = (c.plans || []).find((p) => p['名称'] === '2026 春季');
        return {
          memberRows: document.querySelectorAll('[data-testid="iw-plan-members"] tbody tr').length,
          members: plan ? plan['记录ID列表'] : null,
          recordsN: c.records.length,
        };
      }, joinTarget66.id);
      record('v6.6-4 搜索 #编号 加回清单（成员恢复，记录数不变）',
        candidateVisible && afterAdd.memberRows === 1
          && Array.isArray(afterAdd.members) && afterAdd.members.includes(joinTarget66.id)
          && afterAdd.recordsN === recordsBefore66,
        `候选可见=${candidateVisible}，成员行=${afterAdd.memberRows}，成员表=${JSON.stringify(afterAdd.members)}，记录数=${afterAdd.recordsN}`);
    }

    // 需求 2：列表新增「清单」列（默认列集、多值展示、无清单留空）
    await goto('#/list');
    const headers66 = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-table thead th')).map((th) => (th.textContent || '').replace('↑', '').replace('↓', '').trim()));
    const colIdx66 = headers66.indexOf('清单');
    record('v6.6-5 列表默认显示「清单」列', colIdx66 >= 0, `表头=[${headers66.join(' | ')}]`);

    if (colIdx66 >= 0) {
      // joinTarget 行：清单单元格含「2026 春季」（可能多值「、」连接）
      await goto(`#/list?q=${encodeURIComponent(String(joinTarget66['名称'] || ''))}`);
      const rowOf = (rid) => page.evaluate((id, ci) => {
        const rows = Array.from(document.querySelectorAll('.iw-table tbody tr'));
        const row = rows.find((tr) => {
          const a = tr.querySelector('td a');
          return a && a.getAttribute('href') === `#/detail/${id}`;
        });
        if (!row) return null;
        const cell = row.children[ci];
        return { cls: row.className, cell: cell ? (cell.textContent || '') : null, title: cell && cell.querySelector('.iw-plans-cell') ? cell.querySelector('.iw-plans-cell').getAttribute('title') : null };
      }, rid, colIdx66);
      const joinRow = await rowOf(joinTarget66.id);
      record('v6.6-6 清单列多值展示：该行含「2026 春季」',
        Boolean(joinRow) && (joinRow.cell || '').includes('2026 春季'),
        `单元格=「${joinRow ? joinRow.cell : '行未找到'}」，title=「${joinRow ? joinRow.title : ''}」`);

      // v6.9（需求 3）标注色单规则：唯一口径 = 没做过且不在清单（信息全否、拥有形态不再参与；做过 ✓ 豁免）
      const plansSnapshot = await page.evaluate(() => {
        const c = JSON.parse(localStorage.getItem('iw.cache') || '{}');
        return (c.plans || []).map((p) => p['记录ID列表'] || []);
      });
      const memberIds66 = new Set();
      for (const list of plansSnapshot) for (const id of list) memberIds66.add(id);
      const nonEmpty = (v) => (Array.isArray(v) ? v.some((x) => String(x ?? '').trim() !== '') : String(v ?? '').trim() !== '');
      const hasOwn = (r) => Array.isArray(r['拥有形态']) && r['拥有形态'].length > 0;
      // rA：没做过且不在任何清单（即便信息齐全有形态）→ 浅黄
      const rA = allFile.records.find((r) => nonEmpty(r['分类']) && nonEmpty(r['款式']) && nonEmpty(r['季节']) && hasOwn(r) && !memberIds66.has(r.id) && !r['做过']);
      // rA2：做过且不在任何清单 → 不标色（v6.9 边界）
      const rA2 = allFile.records.find((r) => r['做过'] === true && !memberIds66.has(r.id));
      // rB：信息不全但在清单里 → 不填色（浅灰规则已废除）
      const rB = allFile.records.find((r) => (!nonEmpty(r['分类']) || !nonEmpty(r['款式']) || !nonEmpty(r['季节'])) && memberIds66.has(r.id));
      const rB2 = allFile.records.find((r) => String(r['名称'] || '').trim() && memberIds66.has(r.id));
      if (rA) {
        await goto(`#/list?q=${encodeURIComponent(String(rA['名称'] || ''))}`);
        const rowA = await rowOf(rA.id);
        record('v6.6-7/v6.9-3 没做过且不在任何清单 → 浅黄（iw-row-noformat），信息齐全也不豁免',
          Boolean(rowA) && (rowA.cls || '').includes('iw-row-noformat') && !(rowA.cls || '').includes('iw-row-incomplete'),
          `#${rA.id}「${rA['名称']}」行 class=「${rowA ? rowA.cls : '行未找到'}」，清单单元格=「${rowA ? rowA.cell : ''}」`);
      } else {
        record('v6.6-7/v6.9-3 没做过且不在任何清单 → 浅黄（iw-row-noformat）', false, 'fixture 中找不到「三者齐+有形态+没做过+无清单」的样本');
      }
      if (rA2) {
        await goto(`#/list?q=${encodeURIComponent(String(rA2['名称'] || ''))}`);
        const rowA2 = await rowOf(rA2.id);
        record('v6.9-3 边界：做过 ✓ 且不在任何清单 → 不标色（做过豁免）',
          Boolean(rowA2) && !(rowA2.cls || '').includes('iw-row-noformat') && !(rowA2.cls || '').includes('iw-row-incomplete'),
          `#${rA2.id}「${rA2['名称']}」行 class=「${rowA2 ? rowA2.cls : '行未找到'}」`);
      } else {
        record('v6.9-3 边界：做过且不在清单 → 不标色', false, 'fixture 中找不到「做过 ✓ 且无清单」的样本');
      }
      const rBFinal = rB || rB2;
      if (rBFinal) {
        await goto(`#/list?q=${encodeURIComponent(String(rBFinal['名称'] || ''))}`);
        const rowB = await rowOf(rBFinal.id);
        record('v6.6-8/v6.9-3 在清单里 → 不填色（信息不全也不标浅灰，灰规则废除）',
          Boolean(rowB) && !(rowB.cls || '').includes('iw-row-noformat') && !(rowB.cls || '').includes('iw-row-incomplete'),
          `#${rBFinal.id}「${rBFinal['名称']}」行 class=「${rowB ? rowB.cls : '行未找到'}」（信息不全=${!rB ? false : true}）`);
      } else {
        record('v6.6-8/v6.9-3 在清单里 → 不填色（信息不全也不标浅灰，灰规则废除）', false, 'fixture 中找不到在清单里的样本');
      }
    }

    // 需求 2：身高码新选项与顺序（编辑页快捷标签）
    await goto('#/editor/new');
    const heightOk = await page.evaluate(() => {
      const groups = Array.from(document.querySelectorAll('.iw-detail-group-title')).map((el) => el.textContent || '');
      return groups.includes('拥有形态');
    });
    if (heightOk) {
      // 先勾选「纸质版」（v6 形态-尺码联动：未勾不展示纸质版尺码快捷标签）
      const paperClicked = await page.evaluate(() => {
        const group = document.querySelector('[role="group"][aria-label="拥有形态"]');
        if (!group) return 'no-group';
        const chip = Array.from(group.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '纸质版');
        if (!chip) return 'no-chip';
        chip.click();
        return 'clicked';
      });
      await new Promise((r) => setTimeout(r, 800));
      const heightTags = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
          .filter((b) => (b.getAttribute('aria-label') || '').includes('纸质版尺码 快捷身高码'));
        return btns.map((b) => (b.textContent || '').trim());
      });
      const expected = ['80', '90', '100', '110', '120', '130', '140', '150', '155', '160', '165', '170', '180'];
      const inOrder = heightTags.length === expected.length && heightTags.every((t, i) => t === expected[i]);
      record('v6.2-7 编辑页身高码含新增 80/90/155/165 且顺序为数值升序', inOrder && paperClicked === 'clicked',
        `勾选结果 ${paperClicked}，标签 ${heightTags.length} 项：${heightTags.join('、').slice(0, 90)}`);
    } else {
      record('v6.2-7 编辑页身高码（表单分区存在）', false, '编辑页分区缺失');
    }

    /* ---------------- v6.7 一级页签「清单」：模块平铺 / 新增筛选 / 编辑删除 / 拖拽排序 ---------------- */
    // 用 hash 切换（不 reload）：新增的临时清单留在内存态里，避免中途自动拉取把本地新清单当「远端已删除」
    const navHash = async (h) => {
      await page.evaluate((x) => { window.location.hash = x; }, h);
      await new Promise((r) => setTimeout(r, 800));
    };
    const cachePlans = () => page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('iw.cache') || '{}');
      return (c.plans || []).map((p) => ({ id: p.id, 名称: p['名称'], members: p['记录ID列表'] || [] }));
    });
    const cacheCounts = () => page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem('iw.cache') || '{}');
      return { records: (c.records || []).length, plans: (c.plans || []).length };
    });
    /** 真实 HTML5 拖拽：dragstart → dragover → drop（组件按 React state 记录拖拽源，不依赖 dataTransfer 内容） */
    const dragAndDrop = async (fromSel, toSel) => {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
      }, fromSel);
      await new Promise((r) => setTimeout(r, 260));
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
      }, toSel);
      await new Promise((r) => setTimeout(r, 200));
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
      }, toSel);
      await new Promise((r) => setTimeout(r, 600));
    };

    await navHash('#/plans');
    const nav67 = await page.evaluate(() => ({
      labels: Array.from(document.querySelectorAll('.iw-nav a')).map((a) => (a.textContent || '').trim()),
      active: (document.querySelector('.iw-nav a.iw-nav-active') || {}).textContent || '',
      hash: window.location.hash,
    }));
    record('v6.7-1 一级导航出现「清单」页签（与列表/看板/设置齐平）',
      nav67.labels.join(',') === '列表,看板,清单,设置'
        && nav67.active.trim() === '清单'
        && nav67.hash.startsWith('#/plans'),
      `导航=[${nav67.labels.join('、')}]，当前选中=「${nav67.active.trim()}」，hash=${nav67.hash}`);

    const beforePlans67 = await cachePlans();
    const layout67 = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="iw-plans-grid"]');
      if (!grid) return null;
      const cards = Array.from(document.querySelectorAll('[data-testid^="iw-plan-card-"]'))
        .filter((el) => el.tagName === 'SECTION');
      const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      const first = cards[0];
      const firstId = first ? (first.getAttribute('data-testid') || '').replace('iw-plan-card-', '') : '';
      return {
        cols,
        cards: cards.length,
        firstId,
        rows: first ? first.querySelectorAll('li[data-testid^="iw-plan-card-row-"]').length : 0,
        firstRowText: first && first.querySelector('li[data-testid^="iw-plan-card-row-"]')
          ? (first.querySelector('li[data-testid^="iw-plan-card-row-"]').textContent || '').trim() : '',
        memberUl: Boolean(first && first.querySelector('[data-testid^="iw-plan-card-members-"]')),
      };
    });
    const firstPlan = beforePlans67.find((p) => p.id === (layout67 && layout67.firstId));
    record('v6.7-2 清单模块两列平铺，数量与数据一致，模块内直接列出记录',
      Boolean(layout67)
        && layout67.cols === 2
        && layout67.cards === beforePlans67.length
        && (!firstPlan || layout67.rows === firstPlan.members.length)
        && (layout67.rows === 0 || layout67.memberUl),
      layout67
        ? `栅格列数=${layout67.cols}，模块 ${layout67.cards} 个（数据 ${beforePlans67.length} 份），首个模块「${firstPlan ? firstPlan.名称 : '?'}」列出 ${layout67.rows} 条（成员 ${firstPlan ? firstPlan.members.length : '?'} 条），首行=「${layout67.firstRowText}」`
        : '未找到清单栅格');

    // 需求 4（v6.9 需求 1 简化）：新增清单弹层只填名称，无筛选与挑选内容
    await page.evaluate(() => document.querySelector('[data-testid="iw-plans-new"]').click());
    await new Promise((r) => setTimeout(r, 600));
    const modal67 = await page.evaluate(() => ({
      hasName: Boolean(document.querySelector('[data-testid="iw-new-plan-name"]')),
      hasSearch: Boolean(document.querySelector('[data-testid="iw-new-plan-search"]')),
      catChips: Array.from(document.querySelectorAll('[data-testid^="iw-new-plan-cat-"]')).length,
      seasonChips: Array.from(document.querySelectorAll('[data-testid^="iw-new-plan-season-"]')).length,
      brandChips: Array.from(document.querySelectorAll('[data-testid^="iw-new-plan-brand-"]')).length,
      styleChips: Array.from(document.querySelectorAll('[data-testid^="iw-new-plan-style-"]')).length,
      ownChips: Array.from(document.querySelectorAll('[data-testid^="iw-new-plan-own-"]')).length,
      picksBefore: document.querySelectorAll('[data-testid^="iw-new-plan-pick-"]').length,
      text: (document.querySelector('[role="dialog"]') || { textContent: '' }).textContent || '',
    }));
    record('v6.7-3/v6.9-1 新增清单弹层仅填名称：有名称输入框，无搜索/筛选 chips/候选挑选列表，文案写明空清单',
      modal67.hasName && !modal67.hasSearch && modal67.catChips === 0 && modal67.seasonChips === 0
        && modal67.brandChips === 0 && modal67.styleChips === 0 && modal67.ownChips === 0 && modal67.picksBefore === 0
        && modal67.text.includes('空清单') && modal67.text.includes('＋ 添加记录'),
      `名称=${modal67.hasName}，搜索=${modal67.hasSearch}，分类 chip ${modal67.catChips} 个，季节 chip ${modal67.seasonChips} 个，品牌 chip ${modal67.brandChips} 个，款式 chip ${modal67.styleChips} 个，拥有形态 chip ${modal67.ownChips} 个，候选 ${modal67.picksBefore} 条，文案含空清单提示=${modal67.text.includes('空清单')}`);

    // v6.9-2：经「＋ 添加记录」挑选页给新清单批量加入成员（多选 + 已在清单置灰）
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="iw-new-plan-name"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '冒烟v67清单');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return;
      const btn = Array.from(dlg.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '创建清单');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 900));
    const created67 = (await cachePlans()).find((p) => p.名称 === '冒烟v67清单') || null;
    const newPlanId67 = created67 ? created67.id : null;
    record('v6.7-5/v6.9-1 新增清单创建成功：只带名称、初始 0 条成员（空清单）',
      Boolean(created67) && created67.members.length === 0,
      created67 ? `新清单 ${created67.id}「${created67.名称}」成员=${JSON.stringify(created67.members)}` : '未创建成功');

    let picked67 = [];
    if (newPlanId67) {
      // 挑选页入口：模块右上「＋ 添加记录」
      await page.evaluate((pid) => {
        const b = document.querySelector(`[data-testid="iw-plan-card-add-${pid}"]`);
        if (b) b.click();
      }, newPlanId67);
      const planAddOk = await waitFor(async () => (await page.evaluate(() => document.querySelector('[data-testid="iw-plan-add-view"]')) !== null, 6000));
      const planAddTitle = await page.evaluate(() => (document.querySelector('[data-testid="iw-plan-add-title"]') || { textContent: '' }).textContent || '');
      const planAddLayout = await page.evaluate(() => ({
        hasSearch: Boolean(document.querySelector('.iw-toolbar input')),
        hasFilter: Boolean(document.querySelector('.iw-filter-panel')),
        hasTable: Boolean(document.querySelector('[data-testid="iw-plan-add-table"]')),
        hasPager: Boolean(document.querySelector('.iw-pager')),
      }));
      record('v6.9-2 「＋ 添加记录」跳转挑选页：标题与列表页同款布局（搜索框/筛选面板/表格/分页器）',
        planAddOk && planAddTitle.includes('加入清单') && planAddLayout.hasSearch && planAddLayout.hasFilter && planAddLayout.hasTable && planAddLayout.hasPager,
        `挑选页出现=${planAddOk}，标题=「${planAddTitle}」，搜索=${planAddLayout.hasSearch}，筛选=${planAddLayout.hasFilter}，表格=${planAddLayout.hasTable}，分页=${planAddLayout.hasPager}`);

      if (planAddOk) {
        // 勾两条不在清单里的记录（行点击）；再验证「已在清单」置灰不可勾
        picked67 = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('[data-testid^="iw-plan-add-row-"]')).slice(0, 2);
          const ids = rows.map((r) => Number((r.getAttribute('data-testid') || '').replace('iw-plan-add-row-', '')));
          rows.forEach((r) => r.click());
          return ids;
        });
        await new Promise((r) => setTimeout(r, 400));
        const confirmText67 = await page.evaluate(() => (document.querySelector('[data-testid="iw-plan-add-confirm"]') || { textContent: '' }).textContent || '');
        await page.evaluate(() => { const b = document.querySelector('[data-testid="iw-plan-add-confirm"]'); if (b) b.click(); });
        await new Promise((r) => setTimeout(r, 900));
        const afterAdd67 = (await cachePlans()).find((p) => p.id === newPlanId67);
        const backOnPlans = await page.evaluate(() => Boolean(document.querySelector('[data-testid="iw-plans-view"]')));
        record('v6.9-2 挑选页多选确认：批量加入清单并返回清单页即时可见',
          Array.isArray(picked67) && picked67.length === 2 && confirmText67.includes('2')
            && Boolean(afterAdd67) && JSON.stringify(afterAdd67.members.slice(-2)) === JSON.stringify(picked67)
            && backOnPlans,
          `勾选=${JSON.stringify(picked67)}，按钮文案=「${confirmText67}」，加入后成员=${afterAdd67 ? JSON.stringify(afterAdd67.members) : '清单缺失'}，已回清单页=${backOnPlans}`);

        // 已在清单的记录在挑选页置灰且不可重复加入（再进一次挑选页）
        await page.evaluate((pid) => {
          const b = document.querySelector(`[data-testid="iw-plan-card-add-${pid}"]`);
          if (b) b.click();
        }, newPlanId67);
        const inPlanState69 = await (async () => {
          // 注意：waitFor 只返回布尔，这里需要 evaluate 的对象结果，改手动轮询
          for (let i = 0; i < 10; i += 1) {
            const st = await page.evaluate((rid) => {
              const row = document.querySelector(`[data-testid="iw-plan-add-row-${rid}"]`);
              if (!row) return null;
              const chk = document.querySelector(`[data-testid="iw-plan-add-check-${rid}"]`);
              return {
                rowClass: row.className || '',
                disabled: chk ? chk.disabled : null,
                tag: Boolean(document.querySelector(`[data-testid="iw-plan-add-in-${rid}"]`)),
              };
            }, picked67[0]);
            if (st) return st;
            await new Promise((r) => setTimeout(r, 600));
          }
          return null;
        })();
        record('v6.9-2 已在清单的记录整行置灰、勾选框禁用并带「已在清单」标识（防重复加入）',
          Boolean(inPlanState69) && inPlanState69.rowClass.includes('iw-plan-add-row-in')
            && inPlanState69.disabled === true && inPlanState69.tag,
          `#${picked67[0]} 行class=「${inPlanState69 ? inPlanState69.rowClass : '行未找到'}」，勾选禁用=${inPlanState69 ? inPlanState69.disabled : '?'}，标识=${inPlanState69 ? inPlanState69.tag : '?'}`);
        await page.evaluate(() => { const b = document.querySelector('[data-testid="iw-plan-add-back"]'); if (b) b.click(); });
        await new Promise((r) => setTimeout(r, 700));
      }
    }

    if (newPlanId67) {
      // 需求 5（v6.8 需求 3/4）：模块「编辑」入口已移除；清单名后编辑图标只重命名
      const noEditBtn67 = await page.evaluate((pid) => !document.querySelector(`[data-testid="iw-plan-edit-${pid}"]`), newPlanId67);
      const noEditText67 = await page.evaluate(() => !Array.from(document.querySelectorAll('[data-testid^="iw-plan-card-"]'))
        .some((el) => (el.textContent || '').trim() === '编辑'));
      await page.evaluate((pid) => {
        const b = document.querySelector(`[data-testid="iw-plan-card-rename-${pid}"]`);
        if (b) b.click();
      }, newPlanId67);
      await new Promise((r) => setTimeout(r, 500));
      const hasRenameModal67 = await page.evaluate(() => Boolean(document.querySelector('[data-testid="iw-plan-card-rename-input"]')));
      let renameOk67 = false;
      let renamedTitle67 = '';
      let membersUnchanged67 = false;
      if (hasRenameModal67) {
        await page.focus('[data-testid="iw-plan-card-rename-input"]');
        const curLen67 = await page.evaluate(() => (document.querySelector('[data-testid="iw-plan-card-rename-input"]') || {}).value.length || 0);
        for (let i = 0; i < curLen67 + 2; i += 1) await page.keyboard.press('Backspace');
        await page.keyboard.type('冒烟v67改名');
        await new Promise((r) => setTimeout(r, 300));
        await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          if (!dlg) return;
          const btn = Array.from(dlg.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '保存');
          if (btn) btn.click();
        });
        await new Promise((r) => setTimeout(r, 700));
        renamedTitle67 = await page.evaluate((pid) => (document.querySelector(`[data-testid="iw-plan-card-title-${pid}"]`) || {}).textContent || '', newPlanId67);
        const renamedPlan67 = (await cachePlans()).find((p) => p.id === newPlanId67);
        renameOk67 = renamedTitle67.includes('冒烟v67改名')
          && Boolean(renamedPlan67) && renamedPlan67.名称 === '冒烟v67改名';
        membersUnchanged67 = renamedPlan67
          ? JSON.stringify(renamedPlan67.members) === JSON.stringify(picked67) : false;
      }
      record('v6.7-6/v6.8-3·4 模块无「编辑」入口；清单名后编辑图标仅重命名（成员不动）',
        noEditBtn67 && noEditText67 && hasRenameModal67 && renameOk67 && membersUnchanged67,
        `编辑按钮不存在=${noEditBtn67}，模块无「编辑」文本=${noEditText67}，重命名弹层=${hasRenameModal67}，重命名后标题=「${renamedTitle67}」，名称写回=${renameOk67}，成员不变=${membersUnchanged67}`);

      // 需求 6：拖拽清单顺序（把新清单拖到第一份清单的位置；v6.9.2 起落点是整卡，从手柄发起）
      await navHash('#/plans');
      const orderBefore = (await cachePlans()).map((p) => p.id);
      const targetPlanId = orderBefore.find((id) => id !== newPlanId67);
      const movedTo67 = orderBefore.indexOf(targetPlanId);
      const expectedOrder = orderBefore.slice();
      expectedOrder.splice(expectedOrder.indexOf(newPlanId67), 1);
      expectedOrder.splice(movedTo67, 0, newPlanId67);
      await dragAndDrop(`[data-testid="iw-plan-drag-${newPlanId67}"]`, `[data-testid="iw-plan-card-${targetPlanId}"]`);
      const orderAfter = (await cachePlans()).map((p) => p.id);
      record('v6.7-7 拖拽清单模块调整排列顺序（顺序写回清单数据）',
        JSON.stringify(orderAfter) === JSON.stringify(expectedOrder),
        `拖前=[${orderBefore.join('>')}]，期望=[${expectedOrder.join('>')}]，实际=[${orderAfter.join('>')}]`);

      // 需求 7：拖拽清单内记录顺序（两条成员互换；v6.9.2 起从行手柄发起）
      const membersBefore = ((await cachePlans()).find((p) => p.id === newPlanId67) || { members: [] }).members;
      const bodyVisible67 = await page.evaluate((pid) => Boolean(document.querySelector(`[data-testid="iw-plan-card-body-${pid}"]`)), newPlanId67);
      if (bodyVisible67 && membersBefore.length === 2) {
        await dragAndDrop(
          `[data-testid="iw-plan-member-drag-${newPlanId67}-${membersBefore[0]}"]`,
          `[data-testid="iw-plan-card-row-${newPlanId67}-${membersBefore[1]}"]`,
        );
        const membersAfter = ((await cachePlans()).find((p) => p.id === newPlanId67) || { members: [] }).members;
        record('v6.7-8 拖拽清单内记录调整记录顺序',
          JSON.stringify(membersAfter) === JSON.stringify([membersBefore[1], membersBefore[0]]),
          `拖前=${JSON.stringify(membersBefore)}，实际=${JSON.stringify(membersAfter)}`);
      } else {
        record('v6.7-8 拖拽清单内记录调整记录顺序', false, `模块不可见=${!bodyVisible67}，成员数=${membersBefore.length}`);
      }

      // v6.9.2：拖拽修复 —— 只手柄可拖、文本拖拽被取消（不再弹「搜索文本」）
      {
        const dragFix = await page.evaluate((pid, rid) => {
          const handle = document.querySelector(`[data-testid="iw-plan-drag-${pid}"]`);
          const memberHandle = document.querySelector(`[data-testid="iw-plan-member-drag-${pid}-${rid}"]`);
          const card = document.querySelector(`[data-testid="iw-plan-card-${pid}"]`);
          const title = document.querySelector(`[data-testid="iw-plan-card-title-${pid}"]`);
          const row = document.querySelector(`[data-testid="iw-plan-card-row-${pid}-${rid}"]`);
          const dragAttr = (el) => (el ? el.getAttribute('draggable') : 'missing');
          const probe = (el) => {
            let prevented = null;
            const l = (e) => { prevented = e.defaultPrevented; };
            document.addEventListener('dragstart', l);
            try {
              el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
            } finally {
              document.removeEventListener('dragstart', l);
            }
            return prevented;
          };
          return {
            planHandleDraggable: dragAttr(handle),
            memberHandleDraggable: dragAttr(memberHandle),
            cardDraggable: dragAttr(card),
            titleDraggable: dragAttr(title),
            rowDraggable: dragAttr(row),
            titleDragPrevented: probe(title),
            rowDragPrevented: probe(row),
            handleDragPrevented: probe(handle),
            memberHandleDragPrevented: probe(memberHandle),
          };
        }, newPlanId67, ((membersBefore[0] !== undefined) ? membersBefore[0] : 1));
        // 探针触发过 dragstart，补发 dragend 复位组件内拖拽态，避免影响后续用例
        await page.evaluate((pid, rid) => {
          const mk = (el) => el && el.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
          mk(document.querySelector(`[data-testid="iw-plan-drag-${pid}"]`));
          mk(document.querySelector(`[data-testid="iw-plan-member-drag-${pid}-${rid}"]`));
        }, newPlanId67, ((membersBefore[0] !== undefined) ? membersBefore[0] : 1));
        record('v6.9.2-1 拖拽只绑手柄：手柄 draggable=true，模块卡/标题/条目行均无 draggable',
          dragFix.planHandleDraggable === 'true'
            && dragFix.memberHandleDraggable !== 'missing'
            && dragFix.cardDraggable === null
            && dragFix.titleDraggable === null
            && dragFix.rowDraggable === null,
          `模块手柄=${dragFix.planHandleDraggable}，条目手柄=${dragFix.memberHandleDraggable}，卡=${dragFix.cardDraggable}，标题=${dragFix.titleDraggable}，行=${dragFix.rowDraggable}`);
        record('v6.9.2-2 非手柄文本发起 dragstart 被取消，手柄发起不被拦（不弹搜索文本）',
          dragFix.titleDragPrevented === true
            && dragFix.rowDragPrevented === true
            && dragFix.handleDragPrevented === false
            && dragFix.memberHandleDragPrevented === false,
          `标题拖拽取消=${dragFix.titleDragPrevented}，条目行拖拽取消=${dragFix.rowDragPrevented}，模块手柄放行=${!dragFix.handleDragPrevented}，条目手柄放行=${!dragFix.memberHandleDragPrevented}`);
      }

      // 需求 5：删除 —— 二次确认，只解除关联不删记录
      const countsBeforeDel = await cacheCounts();
      await page.evaluate((pid) => {
        const b = document.querySelector(`[data-testid="iw-plan-delete-${pid}"]`);
        if (b) b.click();
      }, newPlanId67);
      await new Promise((r) => setTimeout(r, 600));
      const delDialog67 = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        return dlg ? (dlg.textContent || '') : '';
      });
      await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return;
        const btn = Array.from(dlg.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '删除清单');
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 800));
      const afterDel67 = await cacheCounts();
      const stillThere67 = (await cachePlans()).some((p) => p.id === newPlanId67);
      record('v6.7-9 模块「删除」二次确认，只解除关联（清单消失、记录数不变）',
        delDialog67.includes('只解除记录关联') && delDialog67.includes('不会被删除或修改')
          && !stillThere67
          && afterDel67.records === countsBeforeDel.records
          && afterDel67.plans === countsBeforeDel.plans - 1,
        `确认文案含「只解除记录关联」=${delDialog67.includes('只解除记录关联')}，清单已删除=${!stillThere67}，记录数 ${afterDel67.records}（原 ${countsBeforeDel.records}），清单数 ${afterDel67.plans}（原 ${countsBeforeDel.plans}）`);
    }

    /* ---------------- v6.8 条目移出清单两入口 + 管理入口跳转（浏览器逐项验证） ---------------- */
    // 需求 2：右键菜单与悬停 × 两个入口都只改成员关系；列表页清单列与行填色即时一致
    await navHash('#/plans');
    const spring68 = (await cachePlans()).find((p) => p.名称 === '2026 春季');
    if (spring68 && spring68.members.length >= 1) {
      const rid68 = spring68.members[0];
      // 移出前：该记录在清单里 → 列表行不填色
      await goto(`#/list?q=${encodeURIComponent('#' + rid68)}`);
      const clsBefore68 = await page.evaluate(() => (document.querySelector('.iw-table tbody tr') || { className: '' }).className);
      // 入口一：条目右键菜单「移出清单」
      await navHash('#/plans');
      const ctxOk68 = await page.evaluate((pid, rid) => {
        const row = document.querySelector(`[data-testid="iw-plan-card-row-${pid}-${rid}"]`);
        if (!row) return false;
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 160, clientY: 180 }));
        return true;
      }, spring68.id, rid68);
      await new Promise((r) => setTimeout(r, 500));
      const ctxMenu68 = await page.evaluate(() => {
        const m = document.querySelector('[data-testid="iw-plan-ctx-menu"]');
        return m ? (m.textContent || '').includes('移出清单') : false;
      });
      await page.evaluate(() => { const b = document.querySelector('[data-testid="iw-plan-ctx-remove"]'); if (b) b.click(); });
      await new Promise((r) => setTimeout(r, 700));
      const afterCtx68 = await page.evaluate((pid, rid) => {
        const c = JSON.parse(localStorage.getItem('iw.cache') || '{}');
        const plan = (c.plans || []).find((p) => p.id === pid);
        return {
          members: plan ? plan['记录ID列表'] : null,
          recordAlive: (c.records || []).some((r) => r.id === rid),
          rowGone: !document.querySelector(`[data-testid="iw-plan-card-row-${pid}-${rid}"]`),
        };
      }, spring68.id, rid68);
      record('v6.8-2a 条目右键菜单「移出清单」：菜单弹出、成员移除、记录保留、模块即时更新',
        ctxOk68 && ctxMenu68 && Array.isArray(afterCtx68.members) && !afterCtx68.members.includes(rid68)
          && afterCtx68.recordAlive && afterCtx68.rowGone,
        `右键触发=${ctxOk68}，菜单含「移出清单」=${ctxMenu68}，成员表=${JSON.stringify(afterCtx68.members)}，记录存在=${afterCtx68.recordAlive}，模块条目已移除=${afterCtx68.rowGone}`);

      // 经详情页 chip 加回，再验证 v6.9.1：常显「移出」按钮已删除，右键「移出清单」仍可用
      await goto(`#/detail/${rid68}`);
      await new Promise((r) => setTimeout(r, 800));
      const readd68 = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('[data-testid="iw-plan-chips"] button'))
          .find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      await new Promise((r) => setTimeout(r, 700));
      await navHash('#/plans');
      const xBtnGone68 = await page.evaluate((pid, rid) => !document.querySelector(`[data-testid="iw-plan-card-remove-${pid}-${rid}"]`), spring68.id, rid68);
      const removeBtnGone691 = await page.evaluate((pid, rid) => !document.querySelector(`[data-testid="iw-plan-member-remove-${pid}-${rid}"]`), spring68.id, rid68);
      const ctxOk691 = await page.evaluate((pid, rid) => {
        const row = document.querySelector(`[data-testid="iw-plan-card-row-${pid}-${rid}"]`);
        if (!row) return false;
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 160, clientY: 180 }));
        return true;
      }, spring68.id, rid68);
      await new Promise((r) => setTimeout(r, 500));
      const ctxRemove691 = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="iw-plan-ctx-remove"]');
        if (b) { b.click(); return (b.textContent || '').trim(); }
        return null;
      });
      await new Promise((r) => setTimeout(r, 700));
      const afterX68 = await page.evaluate((pid, rid) => {
        const c = JSON.parse(localStorage.getItem('iw.cache') || '{}');
        const plan = (c.plans || []).find((p) => p.id === pid);
        return {
          members: plan ? plan['记录ID列表'] : null,
          recordAlive: (c.records || []).some((r) => r.id === rid),
        };
      }, spring68.id, rid68);
      record('v6.8-2b/v6.9.1-4 条目常显「移出」按钮已删除；右键「移出清单」移出且记录本身保留',
        readd68 && xBtnGone68 && removeBtnGone691 && ctxOk691 && ctxRemove691 === '移出清单'
          && Array.isArray(afterX68.members) && !afterX68.members.includes(rid68) && afterX68.recordAlive,
        `加回=${readd68}，×按钮已删除=${xBtnGone68}，常显移出按钮已删除=${removeBtnGone691}，右键触发=${ctxOk691}，菜单项=「${ctxRemove691 || '未找到'}」，成员表=${JSON.stringify(afterX68.members)}，记录存在=${afterX68.recordAlive}`);

      // 列表页即时一致：清单列不含该记录、整行由不填色转浅黄（在清单→不在清单的填色翻转边界）
      await goto(`#/list?q=${encodeURIComponent('#' + rid68)}`);
      const afterList68 = await page.evaluate((rid, ci) => {
        const rows = Array.from(document.querySelectorAll('.iw-table tbody tr'));
        const row = rows.find((tr) => { const a = tr.querySelector('td a'); return a && a.getAttribute('href') === `#/detail/${rid}`; });
        if (!row) return null;
        const cell = row.children[ci];
        return { cls: row.className, cell: cell ? (cell.textContent || '') : null };
      }, rid68, colIdx66);
      record('v6.8-2c/v6.9-3 移出后列表页即时一致：清单列不含该记录、整行转浅黄（没做过且不在任何清单）',
        Boolean(afterList68) && !(afterList68.cell || '').includes('2026 春季')
          && (afterList68.cls || '').includes('iw-row-noformat') && !(afterList68.cls || '').includes('iw-row-incomplete'),
        `移出前 class=「${clsBefore68 || '(无class)'}」，移出后 class=「${afterList68 ? afterList68.cls : '行未找到'}」，清单单元格=「${afterList68 ? afterList68.cell : ''}」`);

      // 恢复成员关系（后续 v6.2.1 段期望「2026 春季」含原成员）
      await goto(`#/detail/${rid68}`);
      await new Promise((r) => setTimeout(r, 800));
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('[data-testid="iw-plan-chips"] button'))
          .find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 700));

      /* ---------------- v6.9-5 条目右键「加入其他清单」—— 迁移语义 ---------------- */
      // 挑一份非当前清单做迁移目标（fixture 自带多份清单，运行时从缓存取，不硬编码 id）
      const moveDest69 = (await cachePlans()).find((p) => p.id !== spring68.id && !p.members.includes(rid68));
      if (moveDest69) {
        const destBefore69 = moveDest69.members.slice();
        await navHash('#/plans');
        // 右键条目 → 菜单应同时含「移出清单」与「加入其他清单…」
        const ctxOk69 = await page.evaluate((pid, rid) => {
          const row = document.querySelector(`[data-testid="iw-plan-card-row-${pid}-${rid}"]`);
          if (!row) return false;
          row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
          return true;
        }, spring68.id, rid68);
        await new Promise((r) => setTimeout(r, 500));
        const ctxMove69 = await page.evaluate(() => {
          const m = document.querySelector('[data-testid="iw-plan-ctx-menu"]');
          const moveBtn = document.querySelector('[data-testid="iw-plan-ctx-move"]');
          const hasBoth = Boolean(m) && (m.textContent || '').includes('移出清单') && moveBtn;
          if (moveBtn) moveBtn.click();
          return { hasBoth, clicked: Boolean(moveBtn) };
        });
        await new Promise((r) => setTimeout(r, 600));
        const moveDlg69 = await page.evaluate((rid, dest, fromPid) => {
          const dlg = document.querySelector('[role="dialog"]');
          const subject = document.querySelector('[data-testid="iw-plan-move-subject"]');
          const list = document.querySelector('[data-testid="iw-plan-move-list"]');
          return {
            text: dlg ? (dlg.textContent || '') : '',
            subjectOk: subject ? (subject.textContent || '').includes(`#${rid}`) : false,
            destOption: list ? Boolean(document.querySelector(`[data-testid="iw-plan-move-option-${dest}"]`)) : false,
            // 候选必须排除当前清单（以及该记录已在的任何清单）——在弹层真正渲染后检查
            selfExcluded: list ? !document.querySelector(`[data-testid="iw-plan-move-option-${fromPid}"]`) : false,
          };
        }, rid68, moveDest69.id, spring68.id);
        await page.evaluate((dest) => { const b = document.querySelector(`[data-testid="iw-plan-move-option-${dest}"]`); if (b) b.click(); }, moveDest69.id);
        await new Promise((r) => setTimeout(r, 800));
        const afterMove69 = await page.evaluate((fromPid, destPid, rid) => {
          const c = JSON.parse(localStorage.getItem('iw.cache') || '{}');
          const from = (c.plans || []).find((p) => p.id === fromPid);
          const dest = (c.plans || []).find((p) => p.id === destPid);
          return {
            fromMembers: from ? from['记录ID列表'] : null,
            destMembers: dest ? dest['记录ID列表'] : null,
            recordAlive: (c.records || []).some((r) => r.id === rid),
            rowGoneFrom: !document.querySelector(`[data-testid="iw-plan-card-row-${fromPid}-${rid}"]`),
            rowInDest: Boolean(document.querySelector(`[data-testid="iw-plan-card-row-${destPid}-${rid}"]`)),
          };
        }, spring68.id, moveDest69.id, rid68);
        record('v6.9-5 条目右键「加入其他清单」迁移：弹层文案明确迁移语义、候选排除当前清单、目标加入且当前移出、记录保留',
          ctxOk69 && ctxMove69.hasBoth && moveDlg69.selfExcluded
            && moveDlg69.text.includes('加入目标清单，并同时从当前清单移出') && moveDlg69.subjectOk && moveDlg69.destOption
            && Array.isArray(afterMove69.fromMembers) && !afterMove69.fromMembers.includes(rid68)
            && Array.isArray(afterMove69.destMembers) && afterMove69.destMembers.includes(rid68)
            && afterMove69.recordAlive && afterMove69.rowGoneFrom && afterMove69.rowInDest,
          `右键=${ctxOk69}，菜单双入口=${ctxMove69.hasBoth}，候选排除当前清单=${moveDlg69.selfExcluded}，文案含迁移语义=${moveDlg69.text.includes('加入目标清单，并同时从当前清单移出')}，主体含 #${rid68}=${moveDlg69.subjectOk}，目标选项=${moveDlg69.destOption}，源成员=${JSON.stringify(afterMove69.fromMembers)}，目标成员=${JSON.stringify(afterMove69.destMembers)}，记录存在=${afterMove69.recordAlive}，源模块条目移除=${afterMove69.rowGoneFrom}，目标模块条目出现=${afterMove69.rowInDest}`);

        // 恢复原成员关系：目标清单移出 + 重新加回「2026 春季」（与测试前状态一致）
        await goto(`#/detail/${rid68}`);
        await new Promise((r) => setTimeout(r, 800));
        await page.evaluate((destName) => {
          const btn = Array.from(document.querySelectorAll('[data-testid="iw-plan-chips"] button'))
            .find((b) => (b.getAttribute('aria-label') || '').includes(destName));
          if (btn) btn.click();
        }, moveDest69.名称);
        await new Promise((r) => setTimeout(r, 600));
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('[data-testid="iw-plan-chips"] button'))
            .find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
          if (btn) btn.click();
        });
        await new Promise((r) => setTimeout(r, 700));
      } else {
        record('v6.9-5 条目右键「加入其他清单」迁移', false, '没有可用于迁移的其他清单（fixture 清单不足）');
      }
    } else {
      record('v6.8-2/v6.9-4·5 清单页条目移出清单与加入其他清单（右键菜单 + 条目「移出」按钮）', false,
        `「2026 春季」或成员缺失：plan=${!!spring68}，成员数=${spring68 ? spring68.members.length : 0}`);
    }

    // 需求 1：筛选面板「管理清单…」未选清单 → 跳「清单」页签（不再依赖设置页）
    await goto('#/list');
    await clickByText('筛选条件');
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => { const b = document.querySelector('[data-testid="iw-filter-manage-plans"]'); if (b) b.click(); });
    await new Promise((r) => setTimeout(r, 700));
    const manageHash68 = await page.evaluate(() => window.location.hash);
    record('v6.8-1b 筛选面板「管理清单…」未选清单时跳「清单」页签',
      manageHash68.startsWith('#/plans'), `点击后 hash=${manageHash68}`);

    await navHash('#/list');

    /* ---------------- v6.2.1 表单里的计划清单入口（浏览器逐项验证） ---------------- */
    // 需求 1/2：新增表单勾选清单 → 保存后成员写入 → 按清单筛选命中；
    //           编辑表单取消勾选 → 即时生效 → 筛选不再命中。此时「2026 春季」已有 1 名成员（v6.2-3 加入的 joinTarget）。
    await goto('#/editor/new');
    const formPlanInfo = await page.evaluate(() => {
      const block = document.querySelector('[data-testid="iw-form-plan-block"]');
      if (!block) return null;
      const chips = Array.from(block.querySelectorAll('[data-testid="iw-form-plan-chips"] button'))
        .map((b) => ({ label: b.getAttribute('aria-label') || '', pressed: b.getAttribute('aria-pressed') }));
      return { chips, text: block.textContent || '' };
    });
    record('v6.2.1-1 新增表单有「计划清单」分区且列出当前清单（2026 春季未选中）',
      !!formPlanInfo && formPlanInfo.chips.some((c) => c.label.includes('计划清单：2026 春季') && c.pressed === 'false'),
      formPlanInfo ? `chips：${formPlanInfo.chips.map((c) => `${c.label.slice(5)}=${c.pressed}`).join('、')}` : '未找到计划清单分区');

    await page.focus('#fld-名称');
    await page.keyboard.type('冒烟v621新记录');
    // 品牌为枚举字段：既有校验要求只能从已有选项中选择（手输新品牌会被拦），
    // 因此这里从下拉里选一个真实存在的品牌，而不是手输新值。
    await page.select('select[aria-label="品牌"]', '卫兰');
    await new Promise((r) => setTimeout(r, 300));
    // 勾选清单（草稿态：不触发 store，仅本地选中）
    const draftTicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[data-testid="iw-form-plan-chips"] button'))
        .find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 400));
    const draftPressed = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[data-testid="iw-form-plan-chips"] button'))
        .find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
      return btn ? btn.getAttribute('aria-pressed') : 'missing';
    });
    await clickByText('保存', '.iw-main');
    await new Promise((r) => setTimeout(r, 1000));
    const newRecordId = Number(await page.evaluate(() => {
      const m = (location.hash || '').match(/#\/detail\/(\d+)/);
      return m ? m[1] : '';
    }));
    const detailAfterCreate = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="iw-plan-card"]');
      const chip = Array.from(document.querySelectorAll('[data-testid="iw-plan-chips"] button'))
        .find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
      return {
        cardText: card ? card.textContent || '' : '',
        pressed: chip ? chip.getAttribute('aria-pressed') : 'missing',
      };
    });
    record('v6.2.1-2 新增表单勾选清单 → 保存后成员写入（详情页 chip 选中、共在 1 份清单）',
      draftTicked && draftPressed === 'true' && newRecordId > 0
      && detailAfterCreate.pressed === 'true' && detailAfterCreate.cardText.includes('当前共在 1 份清单里'),
      `新记录 #${newRecordId || '?'}，草稿勾选=${draftPressed}，详情 chip=${detailAfterCreate.pressed}`);

    // 按该清单筛选：应命中 2 行（v6.2-3 的 joinTarget + 新记录）
    await goto('#/list');
    await clickByText('筛选条件');
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.iw-filter-panel button'))
        .find((b) => (b.getAttribute('aria-label') || '').includes('计划清单：2026 春季'));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 900));
    const filteredNew = await page.evaluate(() => document.querySelectorAll('.iw-table tbody tr').length);
    record('v6.2.1-3 新增记录后按清单筛选命中（该清单共 2 名成员）', filteredNew === 2,
      `筛选后行数 ${filteredNew}（期望 2：原成员 + 新记录）`);

    // 编辑表单取消勾选 → 即时生效（不经保存按钮）→ 筛选不再命中新记录
    await goto(`#/editor/${newRecordId}`);
    await new Promise((r) => setTimeout(r, 600));
    const editPressedBefore = await page.evaluate((rid) => {
      const btn = Array.from(document.querySelectorAll('[data-testid="iw-form-plan-chips"] button'))
        .find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
      void rid;
      return btn ? btn.getAttribute('aria-pressed') : 'missing';
    }, newRecordId);
    const untick = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[data-testid="iw-form-plan-chips"] button'))
        .find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 800));
    const editPressedAfter = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[data-testid="iw-form-plan-chips"] button'))
        .find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
      return btn ? btn.getAttribute('aria-pressed') : 'missing';
    });
    // 去详情页核对同一事实源：取消勾选后详情页 chip 也为未选中
    await goto(`#/detail/${newRecordId}`);
    await new Promise((r) => setTimeout(r, 600));
    const detailAfterUntick = await page.evaluate(() => {
      const chip = Array.from(document.querySelectorAll('[data-testid="iw-plan-chips"] button'))
        .find((b) => (b.getAttribute('aria-label') || '').includes('2026 春季'));
      return chip ? chip.getAttribute('aria-pressed') : 'missing';
    });
    await goto('#/list');
    await clickByText('筛选条件');
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.iw-filter-panel button'))
        .find((b) => (b.getAttribute('aria-label') || '').includes('计划清单：2026 春季'));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 900));
    const filteredAfterUntick = await page.evaluate(() => document.querySelectorAll('.iw-table tbody tr').length);
    record('v6.2.1-4 编辑表单取消勾选即时生效（筛选不再命中新记录）',
      editPressedBefore === 'true' && untick && editPressedAfter === 'false'
      && detailAfterUntick === 'false' && filteredAfterUntick === 1,
      `编辑前=${editPressedBefore}→编辑后=${editPressedAfter}，详情页=${detailAfterUntick}，筛选行数=${filteredAfterUntick}（期望 1）`);
    // 清掉筛选，避免影响后续断言
    await goto('#/list');

    /* ---------------- v6.3 需求 2：品牌自由输入 → 沉淀 → 删除（浏览器逐项验证） ---------------- */
    // 手动输入新品牌 → 保存成功 → 重新打开表单候选里出现 → 设置页删除候选 → 历史记录取值不变 → 同步写回 options.json
    const NEW_BRAND = '冒烟新品牌';
    await goto('#/editor/new');
    await page.focus('#fld-名称');
    await page.keyboard.type('冒烟v630新记录');
    // 品牌下拉切到「＋ 其他（手动输入）」→ 出现自由输入框
    await page.select('select[aria-label="品牌"]', '__custom__');
    await new Promise((r) => setTimeout(r, 400));
    const brandInput = await page.$('input[placeholder="输入新的品牌"]');
    let brandTyped = false;
    if (brandInput) {
      await brandInput.click();
      await brandInput.type(NEW_BRAND);
      brandTyped = true;
    }
    await new Promise((r) => setTimeout(r, 300));
    await clickByText('保存', '.iw-main');
    await new Promise((r) => setTimeout(r, 1200));
    const v63NewId = Number(await page.evaluate(() => {
      const m = (location.hash || '').match(/#\/detail\/(\d+)/);
      return m ? m[1] : '';
    }));
    const v63DetailText = await bodyText();
    record('v6.3-1 手动输入新品牌保存成功（不再被「只能从已有选项中选择」拦下）',
      brandTyped && v63NewId > 0 && v63DetailText.includes(NEW_BRAND)
        && !v63DetailText.includes('只能从已有选项中选择'),
      `新记录 #${v63NewId || '?'}，详情页含「${NEW_BRAND}」=${v63DetailText.includes(NEW_BRAND)}`);

    // 重新打开新增表单：新值已沉淀为候选
    await goto('#/editor/new');
    await new Promise((r) => setTimeout(r, 500));
    const brandCandidates = await page.evaluate(() => {
      const sel = document.querySelector('select[aria-label="品牌"]');
      if (!sel) return [];
      return Array.from(sel.options).map((o) => o.value);
    });
    record('v6.3-2 新输入的品牌沉淀为下次录入的候选（刷新后仍在）',
      brandCandidates.includes(NEW_BRAND),
      `候选共 ${brandCandidates.length} 项，含「${NEW_BRAND}」=${brandCandidates.includes(NEW_BRAND)}`);

    // 设置页删除该候选：先看提示（说明在用记录数），确认后删除
    await goto('#/settings');
    await navTo('options');
    await new Promise((r) => setTimeout(r, 600));
    const optDeleteClicked = await page.evaluate((val) => {
      const btn = Array.from(document.querySelectorAll('[data-testid="iw-options-admin"] button'))
        .find((b) => (b.getAttribute('aria-label') || '') === `删除选项：${val}`);
      if (!btn) return false;
      btn.click();
      return true;
    }, NEW_BRAND);
    await new Promise((r) => setTimeout(r, 400));
    const optModalHint = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="iw-delete-option-hint"]');
      return el ? (el.textContent || '') : '';
    });
    const optConfirmClicked = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return false;
      const btn = Array.from(dlg.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '删除');
      if (!btn) return false;
      btn.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 600));
    record('v6.3-3 删除候选时提示在用记录数（提示后仍允许删除）',
      optDeleteClicked && optConfirmClicked && optModalHint.includes('条记录正在使用这个值')
        && optModalHint.includes('历史记录仍保留原值'),
      `提示：${optModalHint.replace(/\s+/g, ' ').trim().slice(0, 90)}`);

    // 删除后候选里不再有该值；历史记录详情页取值不变
    await goto('#/editor/new');
    await new Promise((r) => setTimeout(r, 500));
    const brandCandidatesAfter = await page.evaluate(() => {
      const sel = document.querySelector('select[aria-label="品牌"]');
      if (!sel) return [];
      return Array.from(sel.options).map((o) => o.value);
    });
    await goto(`#/detail/${v63NewId}`);
    await new Promise((r) => setTimeout(r, 600));
    const v63DetailAfterDelete = await bodyText();
    record('v6.3-4 删除后该值不再出现在录入候选里', !brandCandidatesAfter.includes(NEW_BRAND),
      `候选含「${NEW_BRAND}」=${brandCandidatesAfter.includes(NEW_BRAND)}`);
    record('v6.3-5 删除候选后历史记录取值不受影响（详情页仍显示原值）',
      v63NewId > 0 && v63DetailAfterDelete.includes(NEW_BRAND),
      `#${v63NewId || '?'} 详情页仍含「${NEW_BRAND}」=${v63DetailAfterDelete.includes(NEW_BRAND)}`);

    // 同步写回 options.json（PUT 拦截）
    await goto('#/settings');
    await new Promise((r) => setTimeout(r, 400));
    const putBeforeOptions = putCount;
    const putStartIdx36 = putUrls.length;
    await clickByText('同步到 GitHub', '.iw-main');
    // 等目标文件自己的 PUT（见 v6.2-6 同款竞态说明：只等 putCount 会提前扫描）
    await waitFor(async () => putUrls.slice(putStartIdx36).some((u) => u.includes('options.json')), 15000);
    await new Promise((r) => setTimeout(r, 300));
    const syncTextOptions = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    let optionsPutOk = false;
    let optionsPutMsg = `未捕获 options.json PUT；api尾部=[${apiHits.slice(-8).join(' | ')}]；同步状态=「${(syncTextOptions.match(/(同步|拉取|备份)[^\n]{0,80}/) || [''])[0]}」`;
    for (let i = 0; i < putUrls.length; i += 1) {
      if (!putUrls[i].includes('options.json')) continue;
      try {
        const body = JSON.parse(putBodies[i] || '{}');
        const decoded = JSON.parse(Buffer.from(body.content || '', 'base64').toString('utf8'));
        const brandField = decoded.fields && decoded.fields['品牌'];
        if (brandField && (brandField.removed || []).includes(NEW_BRAND)) {
          optionsPutOk = true;
          optionsPutMsg = `写回 options.json dataVersion=${decoded.dataVersion}，品牌 removed 含「${NEW_BRAND}」`;
        }
      } catch (e) { /* skip */ }
    }
    record('v6.3-6 字段选项随同步写回数据仓（PUT options.json）', optionsPutOk, optionsPutMsg);
    /* ---------------- v6.5 需求 2/3：设置页直接新增/删除 品牌·款式·尺码 选项 ---------------- */
    const NEW_BRAND65 = '冒烟v650品牌';
    const NEW_SIZE65 = '202';
    await goto('#/settings');
    await navTo('options');
    await new Promise((r) => setTimeout(r, 600));
    const addInputs65 = await page.evaluate(() => ({
      brand: !!document.querySelector('[data-testid="iw-option-add-input-品牌"]'),
      style: !!document.querySelector('[data-testid="iw-option-add-input-款式"]'),
      esize: !!document.querySelector('[data-testid="iw-option-add-input-电子版尺码"]'),
      psize: !!document.querySelector('[data-testid="iw-option-add-input-纸质版尺码"]'),
    }));
    record('v6.5-2/3 设置页「字段选项管理」提供品牌/款式/尺码的新增入口',
      addInputs65.brand && addInputs65.style && addInputs65.esize && addInputs65.psize,
      `品牌=${addInputs65.brand} 款式=${addInputs65.style} 电子版尺码=${addInputs65.esize} 纸质版尺码=${addInputs65.psize}`);

    const addOption65 = async (fieldKey, value) => {
      const ok = await page.evaluate((k) => {
        const el = document.querySelector(`[data-testid="iw-option-add-input-${k}"]`);
        if (!el) return false;
        el.focus();
        return true;
      }, fieldKey);
      if (!ok) return false;
      await page.keyboard.type(value, { delay: 30 });
      await page.evaluate((k) => {
        const btn = document.querySelector(`[data-testid="iw-option-add-${k}"]`);
        if (btn) btn.click();
      }, fieldKey);
      await new Promise((r) => setTimeout(r, 500));
      return true;
    };
    const deleteOption65 = async (value) => {
      await page.evaluate((val) => {
        const btn = Array.from(document.querySelectorAll('[data-testid="iw-options-admin"] button'))
          .find((b) => (b.getAttribute('aria-label') || '') === `删除选项：${val}`);
        if (btn) btn.click();
      }, value);
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return;
        const btn = Array.from(dlg.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '删除');
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 500));
    };

    if (addInputs65.brand) {
      const brandAdded65 = await addOption65('品牌', NEW_BRAND65);
      await goto('#/list');
      await clickByText('筛选条件');
      await new Promise((r) => setTimeout(r, 500));
      const brandChips65 = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-filter-panel button'))
        .map((b) => b.getAttribute('aria-label') || ''));
      const hasBrand65 = brandChips65.some((l) => l === `品牌：${NEW_BRAND65}`);
      record('v6.5-2 设置页新增品牌选项即时同步到筛选面板候选',
        brandAdded65 && hasBrand65, `筛选候选含「${NEW_BRAND65}」=${hasBrand65}`);

      await goto('#/editor/new');
      await new Promise((r) => setTimeout(r, 600));
      const brandSelect65 = await page.evaluate(() => {
        const sel = document.querySelector('select[aria-label="品牌"]');
        return sel ? Array.from(sel.options).map((o) => o.value) : [];
      });
      record('v6.5-2 设置页新增品牌选项同步到新增/编辑表单下拉',
        brandSelect65.includes(NEW_BRAND65),
        `候选共 ${brandSelect65.length} 项，含「${NEW_BRAND65}」=${brandSelect65.includes(NEW_BRAND65)}`);

      await goto('#/settings');
      await navTo('options');
      await new Promise((r) => setTimeout(r, 500));
      await deleteOption65(NEW_BRAND65);
      await goto('#/list');
      await clickByText('筛选条件');
      await new Promise((r) => setTimeout(r, 500));
      const brandChipsAfter65 = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-filter-panel button'))
        .map((b) => b.getAttribute('aria-label') || ''));
      record('v6.5-2 设置页删除品牌选项即时同步（筛选面板候选移除）',
        !brandChipsAfter65.some((l) => l === `品牌：${NEW_BRAND65}`),
        `筛选候选含「${NEW_BRAND65}」=${brandChipsAfter65.some((l) => l === `品牌：${NEW_BRAND65}`)}`);
    } else {
      record('v6.5-2 设置页品牌新增入口', false, '未找到品牌新增输入框');
    }

    if (addInputs65.esize) {
      // 品牌块结束时停留在列表页——先回到「设置 › 字段选项」再新增尺码选项
      await goto('#/settings');
      await navTo('options');
      await new Promise((r) => setTimeout(r, 600));
      const sizeAdded65 = await addOption65('电子版尺码', NEW_SIZE65);
      await goto('#/list');
      await clickByText('筛选条件');
      await new Promise((r) => setTimeout(r, 500));
      const sizeChips65 = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-filter-panel button'))
        .map((b) => b.getAttribute('aria-label') || ''));
      const hasSize65 = sizeChips65.some((l) => l === `尺码：${NEW_SIZE65}`);
      record('v6.5-3 设置页新增尺码选项即时同步到筛选面板「尺码」候选',
        sizeAdded65 && hasSize65, `尺码候选含「${NEW_SIZE65}」=${hasSize65}`);

      // 表单快捷标签同步：需打开「拥有电子版」的记录（未勾选形态时尺码输入不渲染）
      const esizeOwner65 = allFile.records.find((r) => (r['拥有形态'] || []).includes('电子版'));
      if (esizeOwner65) {
        await goto(`#/editor/${esizeOwner65.id}`);
        await new Promise((r) => setTimeout(r, 700));
        const quickLabels65 = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-quick-tags button'))
          .map((b) => b.getAttribute('aria-label') || ''));
        const quickHas65 = quickLabels65.some((l) => l.includes(NEW_SIZE65));
        record('v6.5-3 设置页新增尺码选项同步到表单快捷标签',
          quickHas65, `#${esizeOwner65.id} 快捷标签含「${NEW_SIZE65}」=${quickHas65}`);
      }

      await goto('#/settings');
      await navTo('options');
      await new Promise((r) => setTimeout(r, 500));
      await deleteOption65(NEW_SIZE65);
      await goto('#/list');
      await clickByText('筛选条件');
      await new Promise((r) => setTimeout(r, 500));
      const sizeChipsAfter65 = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-filter-panel button'))
        .map((b) => b.getAttribute('aria-label') || ''));
      record('v6.5-3 设置页删除尺码选项即时同步（筛选面板候选移除）',
        !sizeChipsAfter65.some((l) => l === `尺码：${NEW_SIZE65}`),
        `尺码候选含「${NEW_SIZE65}」=${sizeChipsAfter65.some((l) => l === `尺码：${NEW_SIZE65}`)}`);
    } else {
      record('v6.5-3 设置页尺码新增入口', false, '未找到电子版尺码新增输入框');
    }



    /* ---------------- 阶段 B：第 1 条修复后的写回校验行为 ---------------- */
    const v4File = JSON.parse(recordsBuf.toString('utf8'));
    const schemaObj = JSON.parse(schemaBuf.toString('utf8'));
    const sample = v4File.records.find((r) => String(r.名称 ?? '').trim() !== '');
    const shellRecord = { ...sample, id: 795, 名称: '', 品牌: '兴达', 分类: [], 款式: '', 季节: '', 备注: '' };
    const softDeletedRecord = { ...sample, id: 996, 名称: '软删残留样本', deletedAt: '2026-01-01T00:00:00.000Z' };
    const dirtyRecords = [sample, shellRecord, softDeletedRecord];
    const dirtyFile = {
      schemaVersion: 3,
      dataVersion: 1,
      updatedAt: new Date().toISOString(),
      recordCount: dirtyRecords.length,
      records: dirtyRecords,
    };
    servedRecords = Buffer.from(JSON.stringify(dirtyFile, null, 2), 'utf8');

    await page.evaluate((payload) => {
      localStorage.clear();
      localStorage.setItem('iw.config', JSON.stringify({
        owner: 'AhDaiMolly', repo: 'info-workbench-data', branch: 'main', token: 'smoke-local-token', sessionOnly: false,
      }));
      // 缓存里刻意保留「名称为空」的空壳记录与「软删残留」记录 —— 复现用户被阻断的那份数据
      localStorage.setItem('iw.cache', JSON.stringify({
        schemaVersion: 3,
        dataVersion: 1,
        updatedAt: payload.updatedAt,
        records: payload.records,
        schema: payload.schema,
        baseSha: payload.sha,
        lastSyncedAt: null,
      }));
      // 造一条未同步改动 → 启动时自动拉取被暂停，本地状态完全由缓存决定
      localStorage.setItem('iw.pending', JSON.stringify({
        baseSha: payload.sha,
        changes: [{ id: 'seed-1', 记录ID: payload.records[0].id, 动作: '编辑', 字段: ['备注'], 时间: payload.updatedAt }],
      }));
    }, { records: dirtyRecords, schema: schemaObj, sha: MOCK_SHA, updatedAt: dirtyFile.updatedAt });

    await page.goto(`http://127.0.0.1:${PORT}/#/settings`, { waitUntil: 'networkidle2' });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 900));
    await navTo('data');

    // 阶段 B 的脏数据里含一条「名称为空」的空壳记录（#795）——「数据体检」必须把它识别出来
    const dirtyHealth = await bodyText();
    record('v4 阶段 B：脏数据里的空壳记录被「数据体检」识别（#795）',
      dirtyHealth.includes('数据体检') && dirtyHealth.includes('#795'),
      dirtyHealth.includes('#795') ? '数据体检列出了 #795' : '未识别出 #795');

    const putBefore = putCount;
    await navTo('connection');
    await clickByText('同步到 GitHub', '.iw-main');
    await waitFor(async () => {
      if (putCount > putBefore) return true;
      const t = await bodyText();
      return /校验未通过|同步成功|无需写入|写回前校验/.test(t);
    }, 20000);
    await new Promise((r) => setTimeout(r, 600));

    const syncText = await bodyText();
    record('v4 写回校验不再报「必填项不能为空」',
      !syncText.includes('必填项不能为空'),
      syncText.includes('必填项不能为空') ? '仍报必填项为空' : '未出现「必填项不能为空」');
    record('v4 写回校验不再点名 795 号记录',
      !/795\s*号记录/.test(syncText),
      /795\s*号记录/.test(syncText) ? '仍点名 795 号记录' : '未点名 795');
    record('v4 含空名称 / 软删残留的数据可完成写回（PUT 已发出）', putCount > putBefore,
      `PUT 次数 ${putCount - putBefore}`);

    const logAfter = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-log-item'))
      .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()));
    record('v4 操作日志记录了本次「同步写回」',
      logAfter.some((t) => t.includes('同步写回')),
      logAfter[0] || '无日志');
    record('v4 操作日志记录同步结果为成功',
      logAfter.some((t) => t.includes('同步写回') && t.includes('成功')),
      logAfter.find((t) => t.includes('同步写回')) || '无同步写回日志');

    // 写回内容里不应再出现空壳记录以外的脏字段，也不应包含已废弃字段
    let wroteRecords = null;
    try {
      // v6.3：同步写回顺序为 records → plans → options，最后一次 PUT 不一定是 records，
      // 因此按 URL 定位 records.json 的那次 PUT 再解析载荷。
      let idx = -1;
      for (let i = putUrls.length - 1; i >= 0; i -= 1) {
        if (putUrls[i].includes('records.json')) { idx = i; break; }
      }
      const body = idx >= 0 ? (putBodies[idx] || '') : '';
      const parsed = JSON.parse(body);
      const content = Buffer.from(parsed.content, 'base64').toString('utf8');
      wroteRecords = JSON.parse(content).records;
    } catch (e) { wroteRecords = null; }
    record('v4 写回载荷中不再含软删残留记录',
      Array.isArray(wroteRecords) && !wroteRecords.some((r) => 'deletedAt' in r),
      Array.isArray(wroteRecords) ? `写回 ${wroteRecords.length} 条，均无 deletedAt` : '未取到写回载荷');

    /* ---------------- 阶段 C：v6.1 旧浏览器缓存兜底（自报 v5 但仍旧结构，不白屏、不脏写） ---------------- */
    const staleBase = JSON.parse(recordsBuf.toString('utf8'));
    const withEs = staleBase.records.find((r) => (r['拥有形态'] || []).includes('电子版'));
    // 旧键形态 A：v4 结构（想做 + 电子版尺码组），却自报 schemaVersion 5
    const staleA = { ...withEs };
    delete staleA.计划;
    delete staleA.电子版尺码;
    staleA.想做 = '想做';
    staleA.电子版尺码组 = ['女士全码'];
    // 旧键形态 B：字符串形态的电子版尺码（历史脏缓存）
    const staleB = { ...withEs, id: 990, 名称: '字符串尺码缓存样本' };
    delete staleB.计划;
    staleB.想做 = '不确定';
    staleB.电子版尺码 = '大小童全码、男士全码';
    const staleRecords = staleBase.records.filter((r) => r.id !== withEs.id).concat([staleA, staleB]);
    const staleFile = {
      schemaVersion: 5,
      dataVersion: 999,
      updatedAt: new Date().toISOString(),
      recordCount: staleRecords.length,
      records: staleRecords,
    };
    servedRecords = Buffer.from(JSON.stringify(staleFile), 'utf8');
    const putBeforeC = putCount;
    await page.evaluate((payload) => {
      localStorage.clear();
      localStorage.setItem('iw.config', JSON.stringify({
        owner: 'AhDaiMolly', repo: 'info-workbench-data', branch: 'main', token: 'smoke-local-token', sessionOnly: false,
      }));
      localStorage.setItem('iw.cache', JSON.stringify({
        schemaVersion: 5,
        dataVersion: 999,
        updatedAt: payload.updatedAt,
        records: payload.records,
        schema: payload.schema,
        baseSha: payload.sha,
        lastSyncedAt: payload.updatedAt,
      }));
    }, { records: staleRecords, schema: schemaObj, sha: MOCK_SHA, updatedAt: staleFile.updatedAt });
    await page.goto(`http://127.0.0.1:${PORT}/#/list`, { waitUntil: 'networkidle2' });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 900));
    const staleListOk = await page.evaluate(() => !!document.querySelector('.iw-table tbody tr'));
    record('v6.1-C 旧缓存（自报 v5 但含旧键）加载不白屏，列表正常渲染',
      staleListOk, staleListOk ? '列表已渲染' : '列表为空/白屏');

    await goto(`#/detail/${staleA.id}`);
    const staleADetail = await bodyText();
    const staleAKeys = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-kv-key'))
      .map((n) => (n.textContent || '').trim()));
    await goto(`#/editor/${staleA.id}`);
    const staleAPlan = await page.evaluate((rid) => {
      try {
        const j = JSON.parse(localStorage.getItem('iw.cache') || '{}');
        const r = (j.records || []).find((x) => x.id === rid);
        return r ? String(r['计划'] ?? '') : null;
      } catch (e) { return null; }
    }, staleA.id);
    record('v6.1-C 「想做：想做」加载时归一为「计划：在计划中」，「女士全码」映射为字母码全码',
      staleAPlan === '在计划中'
        && staleAKeys.includes('电子版尺码')
        && staleADetail.includes('XS') && staleADetail.includes('2XL') && staleADetail.includes('4XL'),
      `#${staleA.id} keys=${staleAKeys.join('、')}；计划(缓存)=${staleAPlan}；详情片段=${staleADetail.replace(/\s+/g, ' ').slice(0, 160)}`);

    await goto(`#/detail/${staleB.id}`);
    const staleBDetail = await bodyText();
    const staleBKeys = await page.evaluate(() => Array.from(document.querySelectorAll('.iw-kv-key'))
      .map((n) => (n.textContent || '').trim()));
    await goto(`#/editor/${staleB.id}`);
    const staleBPlan = await page.evaluate((rid) => {
      try {
        const j = JSON.parse(localStorage.getItem('iw.cache') || '{}');
        const r = (j.records || []).find((x) => x.id === rid);
        return r ? String(r['计划'] ?? '') : null;
      } catch (e) { return null; }
    }, staleB.id);
    record('v6.1-C 字符串尺码拆开映射（大小童全码→身高码；男士全码丢弃），「不确定」归一为「不是现在」',
      staleBPlan === '不是现在'
        && staleBKeys.includes('电子版尺码')
        && staleBDetail.includes('110') && staleBDetail.includes('170') && staleBDetail.includes('180'),
      `#${staleB.id} keys=${staleBKeys.join('、')}；计划(缓存)=${staleBPlan}；详情片段=${staleBDetail.replace(/\s+/g, ' ').slice(0, 160)}`);
    record('v6.1-C 兜底归一只发生在内存，未触发写回（PUT 不增加）', putCount === putBeforeC,
      `PUT 次数 ${putCount - putBeforeC}`);

    record('运行期间无 JS 报错', consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : '无');

    console.log('API hits:', JSON.stringify([...new Set(apiHits)]));
    await page.screenshot({ path: path.resolve(__dirname, '../smoke-dashboard.png'), fullPage: false }).catch(() => {});
  } catch (err) {
    record('冒烟脚本执行', false, err && err.message ? err.message : String(err));
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
  process.exit(failed.length ? 1 : 0);
})();
