#!/usr/bin/env node
/**
 * 信息汇总工作台 · 数据泄漏闸门（架构 7.1 / 7.2 第 5 条，AC-25）
 *
 * 任一检查不通过即以非零退出，阻断 Pages 发布。三类检查：
 *   1. 产物里不得出现数据文件（records.json / 迁移审计 / 冲突清单）
 *   2. 源码与产物里不得出现真实记录值（品牌等）与令牌前缀
 *   3. 产物里不得出现命名禁用词；也不得加载任何第三方 CDN 脚本
 *
 * ⚠️ 禁用词与样例数据值在本文件里以码点拼装，避免本文件自身触发检查。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src');

/** 由码点拼装敏感字面量，避免脚本自身成为泄漏源 */
const cp = (...codes) => String.fromCodePoint(...codes);

const BANNED_WORDS = [
  cp(0x7f1d, 0x7eab), // 缝纫
  cp(0x7eb8, 0x6837), // 纸样
];

/** 真实记录值样例（来自 PRD 实测基线），出现即视为数据泄漏 */
const DATA_SIGNATURES = [
  cp(0x536b, 0x5170), // 卫兰
  cp(0x5c0f, 0x7ea2, 0x53f6), // 小红叶
  cp(0x7c92, 0x7c92), // 粒粒
  cp(0x88c1, 0x5b66, 0x5b66), // 裁缝学苑
  cp(0x5973, 0x4eec, 0x5f00, 0x59cb), // 女神开创
];

/** 令牌前缀（架构 7.2 第 3 条） */
const TOKEN_PREFIXES = ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'];

/** 数据文件名特征 */
const DATA_FILE_PATTERNS = [
  /^records.*\.json$/i,
  /^migration-audit.*\.json$/i,
  /^pending-conflicts.*\.json$/i,
  /^plans.*\.json$/i,
  /^options.*\.json$/i,
  /^信息汇总\.xlsx$/i,
];

const errors = [];
const warnings = [];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rel(p) {
  return relative(ROOT, p);
}

/* ---------------------------- 1. 数据文件检查 ---------------------------- */

if (!existsSync(DIST)) {
  errors.push('dist 目录不存在：请先执行 npm run build 再运行本闸门。');
}

for (const dir of [DIST, SRC, ROOT]) {
  if (!existsSync(dir)) continue;
  const targets = dir === ROOT
    ? readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && ['data', 'backups'].includes(e.name))
      .flatMap((e) => walk(join(ROOT, e.name)))
    : walk(dir);
  for (const file of targets) {
    const name = file.split(/[\\/]/).pop() ?? '';
    if (DATA_FILE_PATTERNS.some((re) => re.test(name))) {
      errors.push(`发现数据文件：${rel(file)} —— 站点仓内不允许存在任何数据文件。`);
    }
  }
}

/* -------------------------- 2. 内容特征检查 -------------------------- */

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.yml', '.yaml']);
const scanFiles = [...walk(DIST), ...walk(SRC)];

for (const file of scanFiles) {
  const ext = extname(file).toLowerCase();
  const name = file.split(/[\\/]/).pop() ?? '';
  if (!TEXT_EXT.has(ext) && !name.endsWith('.html')) continue;
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const w of BANNED_WORDS) {
    if (content.includes(w)) {
      errors.push(`${rel(file)} 中出现命名禁用词（码点 ${[...w].map((c) => c.codePointAt(0).toString(16)).join(' ')}）—— 命名必须统一为「信息汇总工作台」。`);
    }
  }
  for (const sig of DATA_SIGNATURES) {
    if (content.includes(sig)) {
      errors.push(`${rel(file)} 中出现真实记录值 —— 站点仓内不允许出现任何数据内容。`);
    }
  }
  for (const p of TOKEN_PREFIXES) {
    if (content.includes(p)) {
      errors.push(`${rel(file)} 中出现令牌前缀 —— 令牌绝不能进入源码或构建产物。`);
    }
  }
  // 数据体特征：同时含 schemaVersion 与 records 且 records 数量可观
  if (content.includes('"schemaVersion"') && content.includes('"records"')) {
    const matches = content.match(/"id"\s*:\s*\d+\s*,\s*"名称"/g);
    if (matches && matches.length >= 10) {
      errors.push(`${rel(file)} 中疑似内联了数据文件内容（命中 ${matches.length} 条记录）。`);
    }
  }
}

/* --------------------- 3. 第三方脚本 / 外部域名检查 --------------------- */

for (const file of walk(DIST)) {
  const name = file.split(/[\\/]/).pop() ?? '';
  if (!name.endsWith('.html')) continue;
  const content = readFileSync(file, 'utf8');
  const externalScripts = content.match(/<script[^>]+src\s*=\s*["']https?:\/\/[^"']+/gi);
  if (externalScripts) {
    errors.push(`${rel(file)} 引用了外部脚本：${externalScripts.join(', ')} —— 运行期禁止加载任何第三方 CDN 脚本。`);
  }
  const externalLinks = content.match(/<(link|img|iframe)[^>]+(src|href)\s*=\s*["']https?:\/\/(?!api\.github\.com)[^"']+/gi);
  if (externalLinks) {
    errors.push(`${rel(file)} 引用了外部资源：${externalLinks.join(', ')} —— 所有资源必须打包进产物。`);
  }
  if (!content.includes('Content-Security-Policy')) {
    errors.push(`${rel(file)} 缺少 CSP meta 标签。`);
  }
  if (!content.includes('<title>信息汇总工作台</title>')) {
    errors.push(`${rel(file)} 的页面标题不是「信息汇总工作台」。`);
  }
}

/* ------------------------------- 输出 ------------------------------- */

for (const w of warnings) console.warn(`⚠️  ${w}`);

if (errors.length) {
  console.error('\n✗ 数据泄漏闸门未通过，已阻断发布：\n');
  for (const e of errors) console.error(`  · ${e}`);
  console.error('');
  process.exit(1);
}

console.log('✓ 数据泄漏闸门通过：产物中无数据文件、无真实记录值、无令牌、无命名禁用词、无第三方脚本。');
process.exit(0);
