/**
 * Единый UI-кит (X1 §10 2.1): один ScreenHeader, одни вкладки, один Segmented, один Chip, одно пустое
 * состояние, один skeleton, один баннер ошибки, одна таблица данных, одна плитка показателя,
 * одна Δ к базе, крошки, боковая панель, тост отмены.
 *
 * Правило выбора контрола «один из N»:
 *  - Другой раздел/другие данные (другой заголовок) → `Tabs`. Состояние в URL — пункты с `href`
 *    (ссылки, aria-current="page"); локальное — tablist + `TabPanel` (`activation="manual"`, если
 *    панель грузит данные). Вкладки разделов — под шапкой экрана слева, не в действиях шапки.
 *  - Тот же контент в другом виде/фильтр/режим, 2–5 коротких вариантов, применяется сразу → `Segmented`
 *    (sm 24 px — панели инструментов, md 30 px — формы). Подпись группы — только `caption` (слева,
 *    обычным регистром, без CAPS и без ручных подписей рядом); непонятный без пояснения вариант
 *    («по факту», «по часам») — `describe` + `hint`/`title`: что изменится, видимой строкой под сегментом.
 *  - Счётчик у вкладки и сегмента — один бейдж (`count` + `countLabel`), глиф состояния — `status`
 *    (не внутри `label`). Иконки — только у вкладок панели; вкладки страницы — текстом на всех экранах.
 *  - Больше 5 вариантов или нужны пояснения → выпадающий список/`Menu`, либо `ChoiceCards` (фраза на вариант).
 *  - Много значений/множественный выбор → `ChoiceChip`; да/нет → `Switch`.
 *
 * Таблицы: `DataTable` сам выбирает гибкую колонку имени (`primary`), числа — по содержимому;
 * заголовки — полные русские фразы без сокращений, у числовых — «…, единица».
 */
export { ScreenHeader, Section, rise } from './ScreenHeader'
export { Segmented, PillTabs, type SegOption, type PillTab } from './Segmented'
export { Tabs, TabPanel, type TabItem, type TabsProps } from './Tabs'
export { ChoiceCards, type ChoiceCardOption } from './ChoiceCards'
export { Chip, ChoiceChip, StatusChip, chipTone, type Tone, type ChipTone } from './Chip'
export { Skeleton, SkeletonRows, ErrorBanner, InlineError, errorText, errorDetail, EmptyState, KandinskyMark, useDelayedFlag, type MarkVariant, type EmptyKind } from './States'
export { Switch, IconButton } from './Controls'
export { DataTable, type DataColumn, type MinWidthCh } from './DataTable'
export { columnLayouts, primaryIndex, layoutClass, type ColumnLayout, type ColumnLayoutSpec } from './columnLayout'
export { sortRows, groupRows, nextSort, groupLabel, countLabel, type SortState, type SortDir } from './tableModel'
export { Menu, type MenuItem } from './Menu'
export { CapsLabel, capsNode } from './CapsLabel'
export { DeltaChip, deltaTone, type DeltaBetter, type DeltaTone } from './DeltaChip'
export { KpiTile, TailStrip, splitUnit, type KpiTileProps, type KpiDelta, type TailStripProps } from './KpiTile'
export { Breadcrumbs, type Crumb } from './Breadcrumbs'
export { SidePanel } from './SidePanel'
export { UndoToast, showUndo, useUndoToast } from './UndoToast'
