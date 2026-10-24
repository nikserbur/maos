/**
 * Единый UI-кит (X1 §10 2.1): один ScreenHeader, один Segmented, один Chip, одно пустое
 * состояние, один skeleton, один баннер ошибки, одна таблица данных, одна плитка показателя,
 * одна Δ к базе, крошки, боковая панель, тост отмены.
 */
export { ScreenHeader, Section, rise } from './ScreenHeader'
export { Segmented, PillTabs, type SegOption, type PillTab } from './Segmented'
export { Chip, ChoiceChip, StatusChip, chipTone, type Tone, type ChipTone } from './Chip'
export { Skeleton, SkeletonRows, ErrorBanner, InlineError, errorText, errorDetail, EmptyState, KandinskyMark, useDelayedFlag, type MarkVariant, type EmptyKind } from './States'
export { Switch, IconButton } from './Controls'
export { DataTable, type DataColumn } from './DataTable'
export { sortRows, groupRows, nextSort, groupLabel, countLabel, type SortState, type SortDir } from './tableModel'
export { Menu, type MenuItem } from './Menu'
export { CapsLabel, capsNode } from './CapsLabel'
export { DeltaChip, deltaTone, type DeltaBetter, type DeltaTone } from './DeltaChip'
export { KpiTile, TailStrip, splitUnit, type KpiTileProps, type KpiDelta, type TailStripProps } from './KpiTile'
export { Breadcrumbs, type Crumb } from './Breadcrumbs'
export { SidePanel } from './SidePanel'
export { UndoToast, showUndo, useUndoToast } from './UndoToast'
