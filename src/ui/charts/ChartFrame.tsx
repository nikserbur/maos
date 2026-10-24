/**
 * Рамка графика (X1 §8 «ChartFrame»). Шапка (владелец: «надписи странно отрисовались»):
 *  1) заголовок на всю ширину (до 2 строк, text-wrap: balance) + компактный кластер иконок справа;
 *  2) мета-колонка на всю ширину: строка бейджей («пересчитывается…», Δ, «своя шкала»), под ней —
 *     подзаголовок/предупреждение отдельной строкой во всю ширину (не сжимается рядом с чипом).
 * Бейджи и действия больше не съедают колонку заголовка. У карточки-действия (`onTitleClick`) —
 * видимая кнопка «⤢ Открыть» и вся карточка как цель наведения. Встроенные действия («Показать таблицей» —
 * WCAG-двойник со всеми значениями, «Скачать SVG» для отчётов) — в одном меню «⋯»; в шапке не больше
 * двух контролов. `variant="multiple"` (малые кратные) и `"nested"` (вложенный график) — без встроенных
 * действий: двойник — общая таблица сетки/родителя. Честные состояния (X2): первая загрузка без данных —
 * зарезервированная сетка-скелет, пересчёт — приглушённый прежний кадр, «пусто» — только после загрузки.
 */
import { useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { downloadSvg, mainSvg, serializeSvg, svgFileName } from './exportSvg'
import type { LegendItem } from './palette'
import { Menu, type MenuItem } from '../kit/Menu'
import { IconButton } from '../kit/Controls'
import '../kit/kit.css'
import './charts.css'

/** Табличный двойник: заголовки колонок и строки готовых (отформатированных) текстов. */
export interface ChartTable {
  /** Заголовки: полные фразы с единицами; первый — что в строках («Месяц», «Вариант»). */
  columns: ReadonlyArray<string>
  rows: ReadonlyArray<ReadonlyArray<string>>
  /** Индексы числовых колонок — выравниваются вправо. По умолчанию все, кроме первой. */
  numeric?: ReadonlyArray<number>
}

/** default — обычная рамка; multiple — карточка малых кратных; nested — график внутри другого графика/плитки. */
export type FrameVariant = 'default' | 'multiple' | 'nested'

interface ChartFrameProps {
  title?: ReactNode
  /** Подзаголовок/предупреждение — мета-строка под заголовком на всю ширину. */
  subtitle?: ReactNode
  /** Бейджи (Δ, «своя шкала») — в мета-строке, не рядом с заголовком. */
  badges?: ReactNode
  /** Действия потребителя: иконки (IconButton) или одна короткая кнопка. */
  actions?: ReactNode
  legend?: ReadonlyArray<LegendItem>
  /** Что изображено — для экранного диктора. */
  ariaLabel: string
  table?: ChartTable | null
  loading?: boolean
  /** Пустое состояние: заголовок (строка) или готовый узел; при нём тело графика не рисуется. */
  empty?: ReactNode
  emptyText?: ReactNode
  className?: string
  /** Компактная рамка: меньше отступов; без «Скачать SVG». */
  compact?: boolean
  variant?: FrameVariant
  /** Заголовок как главное действие карточки («открыть веер»). */
  onTitleClick?: () => void
  /** Подсказка/доступное описание действия заголовка: «Открыть веер». */
  titleActionLabel?: string
  /** «Скачать SVG» в меню: по умолчанию — у некомпактных рамок с заголовком. */
  exportable?: boolean
  /** Имя файла экспорта; по умолчанию — заголовок (если строка) или aria-label. */
  exportName?: string
  /** Высота скелета при первой загрузке (обычно — высота графика), px. */
  skeletonHeight?: number
  children?: ReactNode
}

/** Клик по карточке-действию: свои кнопки, ссылки и меню внутри карточки обрабатывают клик сами. */
const OWN_TARGETS = 'button, a, input, select, textarea, summary, [role="menu"], [role="menuitem"], .ch-tablewrap'

/** Подсказка заголовка — только если он действительно урезан (2 строки). */
function titleIfClamped(e: MouseEvent<HTMLElement>, full: ReactNode) {
  if (typeof full !== 'string') return
  const el = e.currentTarget
  el.title = el.scrollHeight > el.clientHeight + 1 ? full : ''
}

export function ChartFrame({
  title, subtitle, badges, actions, legend, ariaLabel, table, loading = false, empty, emptyText, className, compact = false,
  variant = 'default', onTitleClick, titleActionLabel, exportable, exportName, skeletonHeight = 160, children,
}: ChartFrameProps) {
  // «Пусто» — только когда загрузка закончилась; первая загрузка — скелет, пересчёт — прежний кадр.
  const hasEmpty = Boolean(empty)
  const skeleton = hasEmpty && loading
  const showEmpty = hasEmpty && !loading
  const refetching = loading && !hasEmpty
  const [showTable, setShowTable] = useState(false)
  const bodyId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [hasSvg, setHasSvg] = useState(false)
  const builtins = variant === 'default'
  const canExport = builtins && (exportable ?? (!compact && Boolean(title))) && !hasEmpty
  // «Скачать SVG» — только если в теле действительно есть SVG (у HTML-форм его нет).
  useLayoutEffect(() => { setHasSvg(canExport && !showTable && Boolean(bodyRef.current?.querySelector('svg'))) })
  const exportSvg = () => {
    const svg = mainSvg(bodyRef.current)
    if (!svg || !bodyRef.current) return
    const bg = getComputedStyle(bodyRef.current.closest('.ch-frame') ?? document.body).backgroundColor
    const opaque = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : getComputedStyle(document.body).backgroundColor
    downloadSvg(serializeSvg(svg, opaque), svgFileName(exportName ?? (typeof title === 'string' ? title : ariaLabel)))
  }
  const menu: MenuItem[] = [
    ...(builtins && table && !skeleton && !showEmpty
      ? [{ id: 'table', icon: showTable ? 'chart' as const : undefined, label: showTable ? 'Показать график' : 'Показать таблицей', onSelect: () => setShowTable((v) => !v) }]
      : []),
    ...(hasSvg ? [{ id: 'svg', label: 'Скачать SVG', hint: 'График файлом со стилями текущей темы — для отчёта', onSelect: exportSvg }] : []),
  ]
  const openLabel = titleActionLabel ?? 'Открыть'
  const hasOpen = Boolean(onTitleClick && title)
  const hasTop = Boolean(title || actions || menu.length)
  const hasMeta = Boolean(subtitle || badges || refetching)
  const cls = ['ch-frame', compact ? 'ch-frame--compact' : '', variant !== 'default' ? `ch-frame--${variant}` : '',
    hasOpen ? 'ch-frame--clickable' : '', refetching ? 'ch-frame--loading is-refetching' : '', className ?? ''].filter(Boolean).join(' ')
  // Вся карточка — цель наведения и клика; клавиатура — заголовок-кнопка и «⤢ Открыть».
  const onCardClick = hasOpen ? (e: MouseEvent<HTMLElement>) => {
    if (e.target instanceof Element && e.target.closest(OWN_TARGETS)) return
    onTitleClick?.()
  } : undefined

  return (
    <figure className={cls} aria-busy={loading || undefined} onClick={onCardClick}>
      {(hasTop || hasMeta) && (
        <figcaption className="ch-head">
          {hasTop && (
            <div className="ch-head__top">
              {title && onTitleClick ? (
                <button type="button" className="ch-title-btn" onClick={onTitleClick} title={titleActionLabel}
                        aria-label={titleActionLabel && typeof title === 'string' ? `${title}. ${titleActionLabel}` : undefined}>
                  <span className="ch-title">{title}</span>
                </button>
              ) : title ? (
                <span className="ch-title" onMouseEnter={(e) => titleIfClamped(e, title)}>{title}</span>
              ) : <span className="ch-title ch-title--none" aria-hidden="true" />}
              {(actions || menu.length > 0 || hasOpen) && (
                <div className="ch-actions">
                  {actions}
                  {hasOpen && onTitleClick && <IconButton icon="expand" variant="ghost" size="sm" title={openLabel} onClick={onTitleClick} />}
                  {menu.length > 0 && <Menu items={menu} label="Действия графика" size="sm" />}
                </div>
              )}
            </div>
          )}
          {hasMeta && (
            <div className="ch-head__meta">
              {(refetching || badges) && (
                <div className="ch-head__badges">
                  {refetching && <span className="ch-refetch" role="status">пересчитывается…</span>}
                  {badges}
                </div>
              )}
              {subtitle && <span className="ch-sub">{subtitle}</span>}
            </div>
          )}
        </figcaption>
      )}

      {skeleton ? (
        <ChartSkeleton height={skeletonHeight} />
      ) : showEmpty ? (
        <ChartEmpty title={empty} text={emptyText} />
      ) : showTable && table ? (
        <div id={bodyId} className="ch-tablewrap">
          <DataTwin table={table} />
        </div>
      ) : (
        <div id={bodyId} ref={bodyRef} className="ch-body" role="img" aria-label={ariaLabel}>
          {children}
        </div>
      )}

      {!hasEmpty && !showTable && legend && legend.length >= 2 && <Legend items={legend} />}
    </figure>
  )
}

/** Легенда: образец в цвете ряда + подпись текстовым токеном (текст не носит цвет ряда). */
export function Legend({ items, className }: { items: ReadonlyArray<LegendItem>; className?: string }) {
  return (
    <ul className={`ch-legend${className ? ` ${className}` : ''}`} aria-label="Легенда">
      {items.map((it) => (
        <li key={it.key} className="ch-legend__item">
          <Swatch item={it} />
          <span className="ch-legend__label">{it.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** Образец цвета: линия (с пунктиром для проекции), прямоугольник, точка или полоса; глиф/класс — по запросу. */
export function Swatch({ item }: { item: LegendItem }) {
  if (item.glyph) return <span className={`ch-swatch ch-swatch--glyph ${item.glyph}`} aria-hidden="true" />
  if (item.swatchClass) return <i className={`ch-swatch ch-swatch--custom ${item.swatchClass}`} aria-hidden="true" />
  const shape = item.shape ?? 'line'
  const cls = `ch-swatch ch-swatch--${shape}${item.dashed ? ' ch-swatch--dashed' : ''}`
  return (
    <svg className={cls} viewBox="0 0 16 10" width="16" height="10" aria-hidden="true">
      {shape === 'line' && <line x1="1" y1="5" x2="15" y2="5" stroke={item.color} strokeWidth="2" strokeLinecap="round" strokeDasharray={item.dashed ? '3 2' : undefined} />}
      {shape === 'rect' && <rect x="1" y="1" width="14" height="8" rx="2" fill={item.color} />}
      {shape === 'dot' && <circle cx="8" cy="5" r="4" fill={item.color} />}
      {shape === 'band' && <rect x="1" y="1" width="14" height="8" rx="2" fill={item.color} fillOpacity="0.28" />}
    </svg>
  )
}

/**
 * Таблица-двойник на классах таблицы кита (.dk-table): первая колонка — подпись (гибкая, перенос до
 * 2 строк), числа — вправо по содержимому, `tabular-nums`; липкая шапка внутри прокрутки.
 */
export function DataTwin({ table }: { table: ChartTable }) {
  const numeric = new Set(table.numeric ?? table.columns.map((_, i) => i).filter((i) => i > 0))
  const cellCls = (i: number) => (i === 0 ? 'dk-col-primary' : numeric.has(i) ? 'num dk-col-fit' : undefined)
  return (
    <table className="dk-table dk-table--tight ch-twin">
      <thead>
        <tr>
          {table.columns.map((c, i) => (
            <th key={i} scope="col" className={cellCls(i)}><span className="dk-th__label">{c || (i === 0 ? 'Показатель' : 'Значение')}</span></th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((cell, ci) => ci === 0
              ? <th key={ci} scope="row" className={cellCls(0)}><span className="dk-cell-text dk-cell-text--l2">{cell}</span></th>
              : <td key={ci} className={cellCls(ci)}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Скелет первой загрузки: место графика зарезервировано (без скачка макета), сетка из 4 линий. */
export function ChartSkeleton({ height = 160 }: { height?: number }) {
  const lines = [0.12, 0.38, 0.64, 0.9]
  return (
    <div className="ch-skel" role="status" aria-live="polite" aria-busy="true">
      <span className="ch-vh">Загрузка графика…</span>
      <svg className="ch-skel__svg" width="100%" height={height} aria-hidden="true" preserveAspectRatio="none" viewBox={`0 0 100 ${height}`}>
        {lines.map((f) => <line key={f} x1="0" x2="100" y1={f * height} y2={f * height} className="ch-skel__line" />)}
      </svg>
    </div>
  )
}

/** Пустое состояние графика: три приглушённых столбика + заголовок + пояснение. */
export function ChartEmpty({ title, text }: { title: ReactNode; text?: ReactNode }) {
  return (
    <div className="ch-empty" role="status">
      <svg className="ch-empty__mark" viewBox="0 0 48 28" width="48" height="28" aria-hidden="true">
        <line x1="2" y1="26" x2="46" y2="26" className="ch-empty__axis" />
        <rect x="8" y="16" width="7" height="10" rx="2" />
        <rect x="20" y="9" width="7" height="17" rx="2" />
        <rect x="32" y="4" width="7" height="22" rx="2" />
      </svg>
      <p className="ch-empty__title">{title}</p>
      {text && <p className="ch-empty__text">{text}</p>}
    </div>
  )
}
