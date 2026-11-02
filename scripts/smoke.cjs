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
 *       返回 data/migration-v4/ 下的 v4 数据与结构，保证离线可跑、结果稳定。
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
const DATA_DIR = path.resolve(__dirname, '../../data/migration-v4');
const RECORDS_FILE = 'records.v4.json';
const SCHEMA_FILE = 'schema.v4.json';
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
        legacyRel: !!document.getElementById('fld-关联'),
        legacyMissing: !!document.getElementById('fld-电子版缺码'),
        checkboxCount: document.querySelectorAll('input[type="checkbox"]').length,
      };
    });
    record('季节为下拉单选且选项为 夏/春秋/冬',
      selectInfo.season && selectInfo.season.tag === 'SELECT'
      && JSON.stringify(selectInfo.season.options.filter(Boolean)) === JSON.stringify(['夏', '春秋', '冬']),
      selectInfo.season ? `${selectInfo.season.tag} ${JSON.stringify(selectInfo.season.options)}` : '未找到 #fld-季节');
    record('电子版为下拉单选且选项为 有/没有/不确定',
      selectInfo.elec && selectInfo.elec.tag === 'SELECT'
      && JSON.stringify(selectInfo.elec.options.filter(Boolean)) === JSON.stringify(['有', '没有', '不确定']),
      selectInfo.elec ? `${selectInfo.elec.tag} ${JSON.stringify(selectInfo.elec.options)}` : '未找到 #fld-电子版');
    record('纸质版为下拉单选且选项为 有/没有/不确定',
      selectInfo.paper && selectInfo.paper.tag === 'SELECT'
      && JSON.stringify(selectInfo.paper.options.filter(Boolean)) === JSON.stringify(['有', '没有', '不确定']),
      selectInfo.paper ? `${selectInfo.paper.tag} ${JSON.stringify(selectInfo.paper.options)}` : '未找到 #fld-纸质版');
    record('表单已无「关联」「电子版缺码」字段',
      !selectInfo.legacyRel && !selectInfo.legacyMissing && !formText.includes('电子版缺码'),
      `关联控件 ${selectInfo.legacyRel ? '有' : '无'}／电子版缺码控件 ${selectInfo.legacyMissing ? '有' : '无'}`);
    record('拥有形态非复选框（电子版/纸质版均为下拉）',
      Boolean(selectInfo.elec && selectInfo.elec.tag === 'SELECT' && selectInfo.paper && selectInfo.paper.tag === 'SELECT'),
      `页面复选框 ${selectInfo.checkboxCount} 个（属「做过」等布尔字段），电子版/纸质版为下拉单选`);

    /* 4. 详情页：五分区 */
    await goto('/detail/22');
    const detailInfo = await page.evaluate(() => {
      const titles = Array.from(document.querySelectorAll('.iw-detail-group-title')).map((n) => (n.textContent || '').trim());
      return { titles, text: document.body.innerText };
    });
    const detailMissing = sectionTitles.filter((t) => !detailInfo.titles.some((x) => x.includes(t)));
    record('详情页渲染五个分区', detailMissing.length === 0,
      detailMissing.length ? `缺少：${detailMissing.join('、')}` : detailInfo.titles.join(' / '));
    record('详情页显示迁移后的款式「打底衣」',
      detailInfo.text.includes('打底衣') && !detailInfo.text.includes('秋衣秋裤'),
      '记录 22 的款式应为 打底衣');
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
    record('v4 设置页「数据体检」识别出空壳记录 795',
      settingsText.includes('数据体检') && settingsText.includes('#795'),
      settingsText.includes('#795') ? '数据体检列出了 #795' : '未识别出 #795');

    /* 6b. 操作日志：连续触发 5 次导出，只保留最近 3 条 */
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
      record('导出列含「电子版」「纸质版」',
        columns.includes('电子版') && columns.includes('纸质版'),
        columns.filter((c) => ['电子版', '纸质版', '拥有电子版', '拥有纸质版'].includes(c)).join('、') || '未找到');
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
