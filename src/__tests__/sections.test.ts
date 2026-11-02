import { describe, expect, it } from 'vitest';
import {
  FIELD_SECTION, SECTION_TITLES, buildSectionPlan, editableFieldsOf, sectionOfField, systemFieldsOf,
} from '../sections';
import { DEFAULT_SCHEMA } from '../schema';
import type { Schema } from '../types';

/**
 * v3 需求 1：新增/编辑表单与记录详情页共用同一套五分区版面契约。
 */

describe('五分区版面契约', () => {
  it('分区顺序固定为五个', () => {
    expect([...SECTION_TITLES]).toEqual(['基础信息', '拥有形态', '状态及评价', '备注', '系统信息']);
  });

  it('按 schema 分出五个分区，且顺序与契约一致', () => {
    const plan = buildSectionPlan(DEFAULT_SCHEMA);
    expect(plan.map((s) => s.title)).toEqual([...SECTION_TITLES]);
  });

  it('字段归属符合约定', () => {
    expect(sectionOfField('名称')).toBe('基础信息');
    expect(sectionOfField('品牌')).toBe('基础信息');
    expect(sectionOfField('分类')).toBe('基础信息');
    expect(sectionOfField('款式')).toBe('基础信息');
    expect(sectionOfField('季节')).toBe('基础信息');
    expect(sectionOfField('教程')).toBe('拥有形态');
    expect(sectionOfField('拥有形态')).toBe('拥有形态');
    expect(sectionOfField('电子版尺码组')).toBe('拥有形态');
    expect(sectionOfField('纸质版尺码')).toBe('拥有形态');
    expect(sectionOfField('推荐')).toBe('状态及评价');
    expect(sectionOfField('做过')).toBe('状态及评价');
    expect(sectionOfField('想做')).toBe('状态及评价');
    expect(sectionOfField('备注')).toBe('备注');
    expect(sectionOfField('创建时间')).toBe('系统信息');
    expect(sectionOfField('更新时间')).toBe('系统信息');
  });

  it('系统字段一律落在系统信息分区（即使未登记归属）', () => {
    expect(sectionOfField('某个未登记字段', true)).toBe('系统信息');
  });

  it('未登记归属的业务字段落到基础信息（远端新增字段不丢）', () => {
    expect(sectionOfField('某个未登记字段')).toBe('基础信息');
  });

  it('每个业务字段恰好落在一个分区里', () => {
    const plan = buildSectionPlan(DEFAULT_SCHEMA);
    const seen = plan.flatMap((s) => s.fields.map((f) => f.key));
    const all = DEFAULT_SCHEMA.fields.map((f) => f.key);
    expect(seen.sort()).toEqual([...all].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('表单可编辑字段排除系统字段与只读字段', () => {
    const editable = editableFieldsOf(DEFAULT_SCHEMA);
    expect(editable.some((f) => f.key === '创建时间')).toBe(false);
    expect(editable.some((f) => f.key === '记录ID')).toBe(false);
    expect(editable.some((f) => f.key === '名称')).toBe(true);
  });

  it('系统信息分区可拿到只读系统字段', () => {
    const sys = systemFieldsOf(DEFAULT_SCHEMA);
    expect(sys.map((f) => f.key)).toContain('创建时间');
    expect(sys.map((f) => f.key)).toContain('更新时间');
    expect(sys.every((f) => f.readonly)).toBe(true);
  });

  it('远端新增字段落进正确分区', () => {
    const schema: Schema = {
      ...DEFAULT_SCHEMA,
      fields: [
        ...DEFAULT_SCHEMA.fields,
        { key: '自定义字段', jsonKey: '自定义字段', type: 'text', label: '自定义字段' },
      ],
    };
    const plan = buildSectionPlan(schema);
    const basic = plan.find((s) => s.title === '基础信息')!;
    expect(basic.fields.map((f) => f.key)).toContain('自定义字段');
  });

  it('归属表覆盖内置的全部业务字段', () => {
    for (const f of DEFAULT_SCHEMA.fields) {
      if (f.system) continue;
      expect(Object.values(FIELD_SECTION)).toContain(sectionOfField(f.key));
    }
  });
});