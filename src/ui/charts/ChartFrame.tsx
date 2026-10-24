/**
 * Рамка графика (X1 §8 «ChartFrame»): заголовок · подзаголовок · бейджи слева, действия справа,
 * легенда (всегда при ≥ 2 рядов), честные состояния (X2): первая загрузка без данных — зарезервированная
 * сетка-скелет (не «пусто»!), пересчёт с прежними данными — приглушённый прежний кадр и пометка
 * «пересчитывается», «пусто» — только когда загрузка закончилась, `role="img"` + `aria-label` на теле графика и переключатель
 * «Таблица» — WCAG-двойник, в котором есть каждое значение графика. Действие «SVG» (G4) выгружает
 * тело графика файлом со вписанными стилями текущей темы (exportSvg.ts) — для отчётов и диплома.
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { downloadSvg, mainSvg, serializeSvg, svgFileName } from './exportSvg'
import type { LegendItem } from './palette'
import './charts.css'

/** Табличный двойник: заголовки колонок и строки готовых (отформатированных) текстов. */
export interface ChartTable {
  columns: ReadonlyArray<string>
  rows: ReadonlyArray<ReadonlyArray<string>>
  /** Индексы числовых колонок — выравниваются вправо. По умолчанию все, кроме первой. */
  numeric?: ReadonlyArray<number>
}

interface ChartFrameProps {
  title?: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
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
  /** Компактная рамка: без отступов и подписи «Таблица» в заголовке (вложенные графики). */
  compact?: boolean
  /** Кнопка «SVG» в действиях: по умолчанию — у некомпактных рамок с заголовком. */
  exportable?: boolean
  /** Имя файла экспорта; по умолчанию — заголовок (если строка) или aria-label. */
  exportName?: string
  /** Высота скелета при первой загрузке (обычно — высота графика), px. */
  skeletonHeight?: number
  children?: ReactNode
}

export function ChartFrame({
  title, subtitle, badges, actions, legend, ariaLabel, table, loading = false, empty, emptyText, className, compact = false,
  exportable, exportName, skeletonHeight = 160, children,
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
  const canExport = (exportable ?? (!compact && Boolean(title))) && !hasEmpty
  // Кнопка «SVG» — только если в теле действительно есть SVG (у HTML-форм её нет).
  useLayoutEffect(() => { setHasSvg(canExport && !showTable && Boolean(bodyRef.current?.querySelector('svg'))) })
  const exportSvg = () => {
    const svg = mainSvg(bodyRef.current)
    if (!svg || !bodyRef.current) return
    const bg = getComputedStyle(bodyRef.current.closest('.ch-frame') ?? document.body).backgroundColor
    const opaque = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : getComputedStyle(document.body).backgroundColor
    downloadSvg(serializeSvg(svg, opaque), svgFileName(exportName ?? (typeof title === 'string' ? title : ariaLabel)))
  }
  const hasHead = Boolean(title || subtitle || badges || actions || table)
  const cls = ['ch-frame', compact ? 'ch-frame--compact' : '', refetching ? 'ch-frame--loading is-refetching' : '', className ?? ''].filter(Boolean).join(' ')

  return (
    <figure className={cls} aria-busy={loading || undefined}>
      {hasHead && (
        <figcaption className="ch-head">
          <div className="ch-head__text">
            {title && <span className="ch-title">{title}</span>}
            {subtitle && <span className="ch-sub">{subtitle}</span>}
          </div>
          {(badges || refetching) && (
            <div className="ch-badges">
              {refetching && <span className="ch-refetch" role="status">пересчитывается…</span>}
              {badges}
            </div>
          )}
          <div className="ch-actions">
            {actions}
            {hasSvg && (
              <button type="button" className="btn btn--ghost ch-table-toggle" onClick={exportSvg} title="Скачать график в SVG (стили текущей темы)">SVG</button>
            )}
            {table && !skeleton && (
              <button
                type="button"
                className="btn btn--ghost ch-table-toggle"
                aria-pressed={showTable}
                aria-controls={bodyId}
                onClick={() => setShowTable((v) => !v)}
              >
                {showTable ? 'График' : 'Таблица'}
              </button>
            )}
          </div>
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

/** Таблица-двойник: первая колонка — подпись, остальные — числа вправо, `tabular-nums`. */
export function DataTwin({ table }: { table: ChartTable }) {
  const numeric = new Set(table.numeric ?? table.columns.map((_, i) => i).filter((i) => i > 0))
  return (
    <table className="ch-table">
      <thead>
        <tr>
          {table.columns.map((c, i) => (
            <th key={i} scope="col" className={numeric.has(i) ? 'num' : undefined}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((cell, ci) => ci === 0
              ? <th key={ci} scope="row">{cell}</th>
              : <td key={ci} className={numeric.has(ci) ? 'num' : undefined}>{cell}</td>)}
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
