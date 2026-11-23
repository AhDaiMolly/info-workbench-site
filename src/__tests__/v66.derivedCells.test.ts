/**
 * 行标注色 · 纯函数口径（v6.9 双参单规则）
 *
 *   · 单规则：「没做过」且「不在任何清单中」的记录 → 浅黄（noformat），其余一律不填色。
 *     做过 ✓ 的记录即使不在任何清单也不标色。
 *   · 分类 / 款式 / 季节 / 拥有形态不参与行标注色（v6.8 起废除旧浅灰与形态标黄）。
 */

import { describe, expect, it } from 'vitest';
import { rowAnnotation } from '../features/list/derivedCells';

describe('v6.9：行标注色单规则（没做过且不在任何清单 → 浅黄）', () => {
  it('没做过且不在任何清单 → 浅黄（noformat）', () => {
    expect(rowAnnotation(false, false)).toBe('noformat');
  });

  it('不在任何清单但做过 → 无标注色（做过 ✓ 豁免标色）', () => {
    expect(rowAnnotation(false, true)).toBeNull();
  });

  it('没做过但在清单里 → 无标注色', () => {
    expect(rowAnnotation(true, false)).toBeNull();
  });

  it('缺省参数（调用方给不出清单 / 做过信息）→ 保守不标色', () => {
    expect(rowAnnotation()).toBeNull();
    expect(rowAnnotation(false)).toBeNull();
    expect(rowAnnotation(true)).toBeNull();
  });
});
