/* eslint-disable */
/**
 * 信息汇总工作台 v4 · 真机冒烟测试（headless Chromium + puppeteer-core）
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

const DIST = path.resolve(__dirname, '../dist');
const DATA_DIR = path.resolve(__dirname, '../../data/migration-v61');
const RECORDS_FILE = 'records.v61.json';
const SCHEMA_FILE = 'schema.v61.json';
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
  // 全部记录：断言一律锚定到当前数据，避免线上数据演进后出现假失败
  const allFile = JSON.parse(recordsBuf.toString('utf8'));
  // 与产品代码 src/store/selectors.ts 的排序比较器保持一致
  const APP_COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

  // 拦截期间对外返回的文件（阶段 B 会换成「脏数据」版本）
  let servedRecords = recordsBuf;
  let servedSchema = schemaBuf;
  let putCount = 0;
  const putBodies = [];
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
          try { putBodies.push(req.postData() || ''); } catch (e) { putBodies.push(''); }
          apiHits.push(`PUT ${url.replace(/https:\/\/api\.github\.com/, '')}`);
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
          && bs1.text.includes(`${pendingExpect.suggestions.length} 条建议补全`)
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
      record('v6.1.1-3 单条「忽略」后条目从横幅消失并写入本地存储',
        clickedIg && bs2.present
          && bs2.text.includes(`待人工确认清单：${pendingExpect.conflicts.length - 1} 条矛盾记录`)
          && !bs2.text.includes(`#${igItem.id} `)
          && storedIgnored.length === 1 && storedIgnored[0].key === igKey,
        `点击 ${clickedIg}，忽略键 ${storedIgnored.length ? storedIgnored[0].key : '无'}，横幅 ${bs2.present ? bs2.text.slice(0, 60) : '消失'}`);

      // 刷新后忽略仍然生效（浏览器本地持久化）
      await page.reload({ waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 400));
      const bs3 = await bannerState();
      record('v6.1.1-4 刷新后忽略仍然生效（本地持久化，不随页面重开复原）',
        bs3.present
          && bs3.text.includes(`待人工确认清单：${pendingExpect.conflicts.length - 1} 条矛盾记录`)
          && !bs3.text.includes(`#${igItem.id} `),
        bs3.present ? bs3.text.slice(0, 80) : '横幅未显示');

      // 设置页：查看已忽略项并「恢复」→ 重新出现在横幅
      await goto('/settings');
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
      record('v6.1.1-6 修复记录后矛盾条目自动从清单消失（动态重算，无需静态快照）',
        ticked && savedFix && bs5.present
          && !bs5.text.includes(`#${igItem.id} `)
          && bs5.text.includes(`待人工确认清单：${pendingExpect.conflicts.length - 1} 条矛盾记录`),
        `勾选 ${ticked}，保存 ${savedFix}，横幅 ${bs5.present ? bs5.text.slice(0, 80) : '未显示'}`);
    }

    // 全部忽略 → 横幅收起；刷新后仍不显示；随后清理本地忽略清单，不影响后续阶段
    const expectLeft = (() => {
      // 修复后的剩余期望：若上一步完成了修复，矛盾数已减 1
      const fixedApplied = Boolean(igItem && bs5 && bs5.present && !bs5.text.includes(`#${igItem.id} `));
      return (fixedApplied ? pendingExpect.conflicts.length - 1 : pendingExpect.conflicts.length)
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
    const sectionTitles = ['基础信息', '拥有形态', '状态及评价', '备注', '系统信息'];
    const missingSections = sectionTitles.filter((t) => !formText.includes(t));
    record('新增表单渲染五个分区', missingSections.length === 0,
      missingSections.length ? `缺少：${missingSections.join('、')}` : sectionTitles.join(' / '));

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
    record('详情页渲染五个分区', detailMissing.length === 0,
      detailMissing.length ? `缺少：${detailMissing.join('、')}` : detailInfo.titles.join(' / '));
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

    /* 6. 设置页（v4 第 5 / 6 条 + 导出入口 + 数据体检） */
    await goto('/settings');
    const settingsText = await bodyText();
    record('v4 设置页无「安全须知」', !settingsText.includes('安全须知'),
      settingsText.includes('安全须知') ? '仍存在「安全须知」' : '未出现');
    record('v4 设置页有「同步和备份」区', settingsText.includes('同步和备份'), '包含「同步和备份」');
    record('v4 设置页有「操作日志（最近 3 条）」区', settingsText.includes('操作日志（最近 3 条）'), '包含操作日志区');
    record('v4 设置页有「数据管理」区与导出入口',
      settingsText.includes('数据管理')
      && (await clickByText('导出全部 Excel', '.iw-main')) !== null
      && (await clickByText('导出全部 JSON', '.iw-main')) !== null,
      '含「导出全部 Excel」「导出全部 JSON」');
    record('v4 设置页无「回收站」入口', !settingsText.includes('回收站'), '未出现');
    const shellIdsNow = allFile.records.filter((r) => !String(r.名称 ?? '').trim()).map((r) => `#${r.id}`);
    record('v4 设置页「数据体检」与当前数据一致（空壳记录编号）',
      settingsText.includes('数据体检')
        && (shellIdsNow.length
          ? shellIdsNow.every((id) => settingsText.includes(id))
          : settingsText.includes('没有发现「名称为空」的导入遗留记录')),
      shellIdsNow.length
        ? `当前数据 ${shellIdsNow.length} 条空壳记录：${shellIdsNow.join('、')}`
        : '当前数据无「名称为空」的空壳记录');

    /* ---------------- v6 五项体验优化（浏览器逐项验证） ---------------- */
    // 本段跑在完整数据集（799 条，v6.1 已迁移口径）已加载的阶段，断言一律锚定当前数据
    await page.evaluate(() => {
      localStorage.removeItem('iw.prefs');
    });

    // 需求 1：设置页底部版本信息（构建时注入 version / 构建日期 / 提交）
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
      verInfo.hasCard && verInfo.bodyHasFields && verInfo.text.includes('v6.1.1'),
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

      // 需求 2：状态及评价顺序 + 「计划」新枚举选项
      const statusInfo = await page.evaluate(() => {
        const section = document.querySelectorAll('.iw-form-section')[2];
        const labels = Array.from(section.querySelectorAll('.iw-label')).map((el) => el.textContent || '');
        const i = (t) => labels.findIndex((l) => l.startsWith(t));
        const planSelect = document.querySelector('#fld-计划');
        const options = planSelect ? Array.from(planSelect.options).map((o) => o.value) : [];
        return { labels, done: i('做过'), rec: i('推荐'), plan: i('计划'), options };
      });
      record('v6.1-2 「状态及评价」分区顺序：做过 → 推荐 → 计划',
        statusInfo.done >= 0 && statusInfo.done < statusInfo.rec && statusInfo.rec < statusInfo.plan,
        `分区标签序 ${JSON.stringify(statusInfo.labels)}`);
      record('v6.1-3 「计划」下拉选项为新枚举（在计划中/不想做/不是现在/未标记），旧选项消失',
        ['在计划中', '不想做', '不是现在', '未标记'].every((v) => statusInfo.options.includes(v))
          && !statusInfo.options.includes('想做') && !statusInfo.options.includes('不确定'),
        `选项 ${statusInfo.options.join('/')}`);

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
        record('v6.1-9 详情页展示「计划」字段取值',
          detText.includes('计划') && (!esizeRec['计划'] || detText.includes(esizeRec['计划'])),
          `计划=${esizeRec['计划']}`);
      } else {
        record('v6.1-8 详情页展示电子版尺码双轨标签', false, '当前数据中未找到含电子版尺码标签的记录');
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


    /* 6b. 操作日志：连续触发 5 次导出，只保留最近 3 条 */
    await goto('/settings');
    for (let i = 0; i < 5; i += 1) {
      await clickByText('导出全部 JSON', '.iw-main');
      await new Promise((r) => setTimeout(r, 350));
    }
    await new Promise((r) => setTimeout(r, 500));
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

    // 阶段 B 的脏数据里含一条「名称为空」的空壳记录（#795）——「数据体检」必须把它识别出来
    const dirtyHealth = await bodyText();
    record('v4 阶段 B：脏数据里的空壳记录被「数据体检」识别（#795）',
      dirtyHealth.includes('数据体检') && dirtyHealth.includes('#795'),
      dirtyHealth.includes('#795') ? '数据体检列出了 #795' : '未识别出 #795');

    const putBefore = putCount;
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
      const body = putBodies[putBodies.length - 1] || '';
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
    record('v6.1-C 「想做：想做」加载时归一为「计划：在计划中」，「女士全码」映射为字母码全码',
      staleADetail.includes('计划') && staleADetail.includes('在计划中')
        && staleADetail.includes('XS、S、M、L、XL、2XL、3XL、4XL'),
      `#${staleA.id} 详情已含新字段值`);

    await goto(`#/detail/${staleB.id}`);
    const staleBDetail = await bodyText();
    record('v6.1-C 字符串尺码拆开映射（大小童全码→身高码；男士全码丢弃），「不确定」归一为「不是现在」',
      staleBDetail.includes('不是现在') && staleBDetail.includes('100、110、120、130、140、150、160、170、180'),
      `#${staleB.id} 详情已含映射结果`);
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
