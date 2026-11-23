/**
 * 行标注色 · 纯函数口径（v6.8 单规则）
 *
 *   · 单规则：不在任何清单中的记录 → 浅黄（noformat），其余一律不填色。
 *   · v6.8 废除旧浅灰（incomplete）与「拥有形态为空标黄」——
 *     分类 / 款式 / 季节 / 拥有形态不再参与行标注色。
 */

import { describe, expect, it } from 'vitest';
import { rowAnnotation } from '../features/list/derivedCells';

describe('v6.8：行标注色单规则（不在任何清单 → 浅黄）', () => {
  it('不在任何清单 → 浅黄（noformat）', () => {
    expect(rowAnnotation(false)).toBe('noformat');
  });

  it('在清单里 → 无标注色', () => {
    expect(rowAnnotation(true)).toBeNull();
  });

  it('缺省 hasPlan（调用方给不出清单信息）→ 保守不标色', () => {
    expect(rowAnnotation()).toBeNull();
  });
});
