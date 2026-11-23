/**
 * v6.6 · 行标注色新口径（纯函数）
 *
 *   · 灰：分类/款式/季节任一为空（清单为空不单独触发灰，但与三者缺叠加时自然落灰）
 *   · 黄：三者齐 但 拥有形态或清单任一为空
 *   · 灰优先于黄；「清单为空的记录至少会被标黄（若分类/款式/季节也缺则标灰）」
 */

import { describe, expect, it } from 'vitest';
import { rowAnnotation } from '../features/list/derivedCells';

const full = { 分类: ['女装'], 款式: '外套', 季节: '夏', 拥有形态: ['电子版'] };

describe('v6.6：清单纳入行标注色口径', () => {
  it('清单为空 + 三者齐 + 有拥有形态 → 浅黄（清单为空至少标黄）', () => {
    expect(rowAnnotation(full, false)).toBe('noformat');
  });

  it('清单为空 + 三者齐 + 拥有形态也为空 → 仍浅黄（同一条黄规则）', () => {
    expect(rowAnnotation({ ...full, 拥有形态: [] }, false)).toBe('noformat');
  });

  it('清单为空 + 分类缺失 → 浅灰（灰优先于黄）', () => {
    expect(rowAnnotation({ ...full, 分类: [] }, false)).toBe('incomplete');
  });

  it('清单为空 + 款式缺失 → 浅灰', () => {
    expect(rowAnnotation({ ...full, 款式: '' }, false)).toBe('incomplete');
  });

  it('清单为空 + 季节缺失 → 浅灰', () => {
    expect(rowAnnotation({ ...full, 季节: '' }, false)).toBe('incomplete');
  });

  it('在清单里 + 三者齐 + 拥有形态为空 → 浅黄（v6.5 旧规则不变）', () => {
    expect(rowAnnotation({ ...full, 拥有形态: [] }, true)).toBe('noformat');
  });

  it('在清单里 + 三者齐 + 拥有形态有值 → 无标注色', () => {
    expect(rowAnnotation(full, true)).toBeNull();
  });

  it('在清单里 + 三要素缺 → 浅灰（与清单无关的旧灰规则）', () => {
    expect(rowAnnotation({ ...full, 分类: [] }, true)).toBe('incomplete');
  });

  it('缺省 hasPlan（调用方给不出清单信息）→ 退化为 v6.5 旧口径，只看拥有形态', () => {
    expect(rowAnnotation(full)).toBeNull();
    expect(rowAnnotation({ ...full, 拥有形态: [] })).toBe('noformat');
    expect(rowAnnotation({ ...full, 分类: [] })).toBe('incomplete');
  });
});
