/**
 * v6 · 需求 1：站点版本信息（构建时注入）（v6.1 版本号递增）
 *
 * 断言口径：
 *   · package.json 是版本号唯一事实源（断言动态化，发版无需改测试）
 *   · version.ts 在构建注入缺失时必须安全回落（本地源码态），不能抛错
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILD_INFO, buildDateText, buildInfoText } from '../version';

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

describe('v6 · 需求 1 构建版本信息（v6.1）', () => {
  it('package.json 版本号与本轮发布版本一致（动态断言，发版不必改测试）', () => {
    // 版本号唯一事实源是 package.json；这里断言它满足「主.次.修订」三段式且与 v6 系列一致
    expect(pkg.version).toMatch(/^6\.\d+\.\d+$/);
    expect(BUILD_INFO.version === pkg.version || BUILD_INFO.version === '0.0.0-local').toBe(true);
  });

  it('BUILD_INFO 结构完整（版本 / 构建日期 / 提交）', () => {
    expect(typeof BUILD_INFO.version).toBe('string');
    expect(typeof BUILD_INFO.builtAt).toBe('string');
    expect(typeof BUILD_INFO.commit).toBe('string');
    expect(BUILD_INFO.version.length).toBeGreaterThan(0);
  });

  it('未注入构建信息时回落到本地源码标记，不抛错', () => {
    // 构建期注入时 version === pkg.version；本地未注入时为 '0.0.0-local'
    expect([pkg.version, '0.0.0-local']).toContain(BUILD_INFO.version);
    expect(buildInfoText().length).toBeGreaterThan(0);
  });

  it('buildInfoText 输出含版本号，可直接展示给用户', () => {
    expect(buildInfoText()).toContain(BUILD_INFO.version);
  });

  it('buildDateText 为 YYYY-MM-DD 或空串', () => {
    const d = buildDateText();
    expect(d === '' || /^\d{4}-\d{2}-\d{2}$/.test(d)).toBe(true);
  });
});
