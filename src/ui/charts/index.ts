/**
 * Chart-система PESCADITO (X1 §8, G3 1.1): один набор примитивов, из которых собираются графики
 * всех экранов. Палитра — только `--chart-*`; числа — только через src/explain/format.ts.
 */
export { ChartFrame, Legend, Swatch, DataTwin, ChartEmpty, type ChartTable } from './ChartFrame'
export { Grid, XAxis, YAxis, Crosshair, Marker } from './Axis'
export { ChartTooltip, type TipRow } from './Tooltip'
export { LineChart, AreaChart, ColumnChart, Cartesian, columnPath, type Series, type CartesianProps, type CartesianKind } from './Cartesian'
export { BarList, type BarRow } from './BarList'
export { StackBar, Meter, type StackSegment, type MeterTone } from './Bars'
export { Histogram, type Bin, type HistMarker } from './Histogram'
export { Scatter, type ScatterPoint, type Emphasis } from './Scatter'
export { Fan, fanLegend, type FanSeries, type FanProps } from './Fan'
export { Sparkline } from './Sparkline'
export { Sankey, type SankeyLink } from './Sankey'
export { seriesColor, colorOf, CHART_SLOTS, type LegendItem, type SwatchShape } from './palette'
export { useMeasuredWidth, useHoverIndex } from './hooks'
export * from './scale'
