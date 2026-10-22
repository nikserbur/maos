/**
 * Единый UI-кит (X1 §10 2.1): один ScreenHeader, один Segmented, один Chip, одно пустое
 * состояние, один skeleton, один баннер ошибки, одна таблица данных.
 */
export { ScreenHeader, Section, rise } from './ScreenHeader'
export { Segmented, PillTabs, type SegOption, type PillTab } from './Segmented'
export { Chip, StatusChip, chipTone, type Tone, type ChipTone } from './Chip'
export { Skeleton, SkeletonRows, ErrorBanner, InlineError, errorText, EmptyState, KandinskyMark, type MarkVariant } from './States'
export { Switch, IconButton } from './Controls'
export { DataTable, type DataColumn } from './DataTable'
export { sortRows, groupRows, nextSort, type SortState, type SortDir } from './tableModel'
export { Menu, type MenuItem } from './Menu'
