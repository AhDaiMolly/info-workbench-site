/**
 * 信息汇总工作台 · ECharts 图表容器
 * 所有依赖在构建期打包，运行期不加载任何第三方 CDN 脚本（架构 7.2 第 8 条）。
 */

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, TitleComponent, DatasetComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent,
  TitleComponent, DatasetComponent, CanvasRenderer,
]);

interface Props {
  option: echarts.EChartsCoreOption;
  height?: number;
}

export function Chart({ option, height = 300 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const instRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    const inst = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    instRef.current = inst;
    const onResize = () => inst.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      inst.dispose();
      instRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (instRef.current) instRef.current.setOption(option, true);
  }, [option]);

  return <div ref={ref} className="iw-chart" style={{ height }} role="img" aria-label="图表" />;
}

export { echarts };
