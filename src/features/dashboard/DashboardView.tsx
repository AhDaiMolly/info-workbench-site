/**
 * 信息汇总工作台 · 可视化看板（PRD 第 6 章 / AC-22 / AC-23）
 * 6 个图表 + KPI 概览；与筛选联动（应用当前筛选后图表随之刷新）。
 * 分类为「选项级计数」：多值记录在每个命中的选项各计 1 次，图注已说明口径。
 */

import { useMemo } from 'react';
import { useApp } from '../../store/store';
import { applyQuery, computeStats } from '../../store/selectors';
import { Chart } from './Chart';
import type { echarts } from './Chart';

const AXIS_COLOR = '#8b95a3';
const PRIMARY = '#2563eb';
const SERIES_COLORS = ['#2563eb', '#60a5fa', '#93c5fd', '#b9a6f3', '#f0abfc', '#fcd34d', '#6ee7b7', '#fda4af', '#fdba74', '#c7d2fe'];

export function DashboardView() {
  const app = useApp();
  const { filters, query } = app;

  const scoped = useMemo(
    () => applyQuery(app.records, filters, query, app.indexes),
    [app.records, filters, query, app.indexes],
  );

  const stats = useMemo(() => computeStats(scoped), [scoped]);

  const brandOption = useMemo<echarts.EChartsCoreOption>(() => {
    const names = stats.brand.map((b) => b.name);
    const values = stats.brand.map((b) => b.value);
    if (stats.brandOther) { names.push('其他'); values.push(stats.brandOther); }
    return {
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', axisLabel: { color: AXIS_COLOR }, splitLine: { lineStyle: { color: '#f0f1f3' } } },
      yAxis: { type: 'category', data: [...names].reverse(), axisLabel: { color: AXIS_COLOR }, axisTick: { show: false } },
      series: [{
        type: 'bar',
        data: [...values].reverse(),
        barMaxWidth: 18,
        itemStyle: { color: PRIMARY, borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: 'right', color: AXIS_COLOR, fontSize: 11 },
      }],
    };
  }, [stats]);

  const categoryOption = useMemo<echarts.EChartsCoreOption>(() => ({
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: stats.category.map((c) => c.name), axisLabel: { color: AXIS_COLOR } },
    yAxis: { type: 'value', axisLabel: { color: AXIS_COLOR }, splitLine: { lineStyle: { color: '#f0f1f3' } } },
    series: [{
      type: 'bar',
      data: stats.category.map((c) => c.value),
      barMaxWidth: 34,
      itemStyle: { color: PRIMARY, borderRadius: [3, 3, 0, 0] },
      label: { show: true, position: 'top', color: AXIS_COLOR, fontSize: 11 },
    }],
  }), [stats]);

  const styleOption = useMemo<echarts.EChartsCoreOption>(() => {
    const names = stats.style.map((s) => s.name);
    const values = stats.style.map((s) => s.value);
    if (stats.styleOther) { names.push('其他'); values.push(stats.styleOther); }
    return {
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', axisLabel: { color: AXIS_COLOR }, splitLine: { lineStyle: { color: '#f0f1f3' } } },
      yAxis: { type: 'category', data: [...names].reverse(), axisLabel: { color: AXIS_COLOR }, axisTick: { show: false } },
      series: [{
        type: 'bar',
        data: [...values].reverse(),
        barMaxWidth: 18,
        itemStyle: { color: '#60a5fa', borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: 'right', color: AXIS_COLOR, fontSize: 11 },
      }],
    };
  }, [stats]);

  const seasonOption = useMemo<echarts.EChartsCoreOption>(() => {
    const data = [...stats.season.map((s) => ({ name: s.name, value: s.value }))];
    if (stats.seasonBlank) data.push({ name: '未填', value: stats.seasonBlank });
    return {
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: data.map((d) => d.name), axisLabel: { color: AXIS_COLOR } },
      yAxis: { type: 'value', axisLabel: { color: AXIS_COLOR }, splitLine: { lineStyle: { color: '#f0f1f3' } } },
      series: [{
        type: 'bar',
        data: data.map((d) => d.value),
        barMaxWidth: 40,
        itemStyle: {
          color: (p: { dataIndex: number }) => (p.dataIndex === data.length - 1 && data[data.length - 1].name === '未填' ? '#d4d7dd' : PRIMARY),
          borderRadius: [3, 3, 0, 0],
        },
        label: { show: true, position: 'top', color: AXIS_COLOR, fontSize: 11 },
      }],
    };
  }, [stats]);

  const ownershipOption = useMemo<echarts.EChartsCoreOption>(() => {
    // v5（R5）：两字段交叉图简化为单字段四态分布（皆无 / 仅电子 / 仅纸质 / 双有）
    const order = ['皆无', '仅电子', '仅纸质', '双有'];
    const map = new Map(stats.ownership.map((o) => [o.name, o.value]));
    const data = order.map((name) => ({ name, value: map.get(name) ?? 0 }));
    return {
      tooltip: { trigger: 'item', formatter: '{b}：{c} 条（{d}%）' },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: AXIS_COLOR, fontSize: 12 } },
      series: [{
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { color: AXIS_COLOR, fontSize: 12 },
        data: data.map((d, i) => ({ ...d, itemStyle: { color: SERIES_COLORS[i] } })),
      }],
    };
  }, [stats]);

  const completionOption = useMemo<echarts.EChartsCoreOption>(() => {
    const order = ['想做', '不确定', '不想做', '未标记'];
    const map = new Map(stats.completion.map((c) => [c.name, c.value]));
    const data = order.map((name) => ({ name, value: map.get(name) ?? 0 }));
    return {
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', axisLabel: { color: AXIS_COLOR }, splitLine: { lineStyle: { color: '#f0f1f3' } } },
      yAxis: { type: 'category', data: [...order].reverse(), axisLabel: { color: AXIS_COLOR }, axisTick: { show: false } },
      series: [{
        type: 'bar',
        data: [...data].reverse().map((d, i) => ({
          value: d.value,
          itemStyle: { color: [ '#d4d7dd', '#fcd34d', '#fda4af', PRIMARY ][i], borderRadius: [0, 3, 3, 0] },
        })),
        barMaxWidth: 18,
        label: { show: true, position: 'right', color: AXIS_COLOR, fontSize: 11 },
      }],
    };
  }, [stats]);

  // v4：移除「有教程」统计口径（KPI 卡片与相关口径一并清理）
  const kpis = [
    { label: '总记录', value: stats.total, note: '当前筛选范围内' },
    { label: '做过', value: stats.做过, note: '已实际完成' },
    { label: '想做', value: stats.想做, note: '计划中' },
  ];

  return (
    <>
      <div className="iw-page-head">
        <div>
          <h1 className="iw-page-title">看板</h1>
          <p className="iw-page-sub">
            图表随列表页的筛选与搜索实时联动；当前口径：{stats.total} 条记录
            {filters && Object.values(filters).some((v) => (Array.isArray(v) ? v.length : v !== undefined))
              ? '（已应用筛选）'
              : '（全量）'}
          </p>
        </div>
      </div>

      <div className="iw-kpi-row">
        {kpis.map((k) => (
          <div className="iw-kpi" key={k.label}>
            <div className="iw-kpi-label">{k.label}</div>
            <div className="iw-kpi-value">{k.value}</div>
            <div className="iw-kpi-note">{k.note}</div>
          </div>
        ))}
      </div>

      <div className="iw-chart-grid">
        <div className="iw-chart-card">
          <div className="iw-chart-card-head">
            <div className="iw-chart-title">品牌分布</div>
            <div className="iw-chart-note">Top 10 品牌 + 其他；回答「记录集中在哪几家来源」</div>
          </div>
          <Chart option={brandOption} />
        </div>

        <div className="iw-chart-card">
          <div className="iw-chart-card-head">
            <div className="iw-chart-title">分类分布</div>
            <div className="iw-chart-note">
              按选项级计数（一条记录命中多个分类时，每个分类各计 1 次）；未分类 {stats.categoryUncategorized} 条
            </div>
          </div>
          <Chart option={categoryOption} />
        </div>

        <div className="iw-chart-card">
          <div className="iw-chart-card-head">
            <div className="iw-chart-title">款式分布</div>
            <div className="iw-chart-note">Top 10 款式 + 其他</div>
          </div>
          <Chart option={styleOption} />
        </div>

        <div className="iw-chart-card">
          <div className="iw-chart-card-head">
            <div className="iw-chart-title">季节分布</div>
            <div className="iw-chart-note">含「未填」段（{stats.seasonBlank} 条）</div>
          </div>
          <Chart option={seasonOption} />
        </div>

        <div className="iw-chart-card">
          <div className="iw-chart-card-head">
            <div className="iw-chart-title">拥有形态</div>
            <div className="iw-chart-note">皆无 / 仅电子 / 仅纸质 / 双有</div>
          </div>
          <Chart option={ownershipOption} />
        </div>

        <div className="iw-chart-card">
          <div className="iw-chart-card-head">
            <div className="iw-chart-title">完成与计划</div>
            <div className="iw-chart-note">
              想做 / 不确定 / 不想做 / 未标记；其中已「做过」{stats.做过} 条
            </div>
          </div>
          <Chart option={completionOption} />
        </div>
      </div>
    </>
  );
}
