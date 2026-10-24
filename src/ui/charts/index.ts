/**
 * Chart-система PESCADITO (X1 §8, G3 1.1): один набор примитивов, из которых собираются графики
 * всех экранов. Палитра — только `--chart-*`; числа — только через src/explain/format.ts.
 */
export { ChartFrame, Legend, Swatch, DataTwin, ChartEmpty, ChartSkeleton, type ChartTable } from './ChartFrame'
export { Grid, XAxis, YAxis, Crosshair, Marker, X_AXIS_H, X_AXIS_ROTATED_H } from './Axis'
export { ChartTooltip, type TipRow } from './Tooltip'
export { LineChart, AreaChart, ColumnChart, Cartesian, columnPath, type Series, type Annotation, type CartesianProps, type CartesianKind } from './Cartesian'
export { BarList, type BarRow } from './BarList'
export { StackBar, Meter, type StackSegment, type MeterTone } from './Bars'
export { Histogram, type Bin, type HistMarker } from './Histogram'
export { Scatter, type ScatterPoint, type Emphasis, type PointShape } from './Scatter'
export { Heatmap, heatStep, type HeatRow } from './Heatmap'
export { RangeStrip, type RangeMark, type RangeGlyph } from './RangeStrip'
export { Fan, fanLegend, fanTicks, type FanSeries, type FanProps, type FanRefLine } from './Fan'
export { Forest, forestVerdict, type ForestRow } from './Forest'
export { Sparkline } from './Sparkline'
export { Sankey, wrapFull, type SankeyLink } from './Sankey'
export { seriesColor, colorOf, CHART_SLOTS, ENTITY_SLOTS, slotForEntity, entityLegend, type EntitySlot, type LegendItem, type SwatchShape } from './palette'
export { useMeasuredWidth, useHoverIndex } from './hooks'
export * from './scale'
export { placeXLabels, overlaps, TICK_CHAR_W, TICK_GAP, type PlacedLabel } from './axisLayout'
