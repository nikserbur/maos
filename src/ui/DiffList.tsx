/**
 * «Наследовано · Изменено · Не задано» (UX-V2 §4.2 шаг 6) и таблица диффа A/B
 * (UX-V2 §5.3): только отличающиеся поля (по видимому значению), у каждой колонки — Δ к базе
 * (первая колонка) с ▲▼ и словом «лучше/хуже»; цвет — только на стрелке.
 */
import type { ReactNode } from 'react'
import { DeltaChip } from './kit/DeltaChip'
import './fields.css'

export type DiffOrigin = 'inherited' | 'changed' | 'unset'

export interface DiffRow {
  key: string
  label: string
  /** Откуда значение: «из сценария «Базовый»», «из портфеля 10-21», «этот прогон». */
  owner?: string
  value: ReactNode
  /** Для изменённых — унаследованное значение. */
  base?: ReactNode
  origin: DiffOrigin
  /** Шаг мастера, куда ведёт клик. */
  step?: string
}

const GROUP: Record<DiffOrigin, { title: string; glyph: string }> = {
  changed: { title: 'Изменено', glyph: '■' },
  inherited: { title: 'Наследовано', glyph: '●' },
  unset: { title: 'Не задано', glyph: '◌' },
}

export function DiffList({ rows, onGo }: { rows: readonly DiffRow[]; onGo?: (step: string) => void }) {
  const groups = (['changed', 'inherited', 'unset'] as const).map((o) => ({ origin: o, items: rows.filter((r) => r.origin === o) }))
  return (
    <div className="pf-diff">
      <div className="pf-diff__summary">
        {groups.map((g) => (
          <span key={g.origin} className={`pf-diff__count pf-diff__count--${g.origin}`}>
            <span aria-hidden="true">{GROUP[g.origin].glyph}</span> {GROUP[g.origin].title} <b className="num">{g.items.length}</b>
          </span>
        ))}
      </div>
      {groups.filter((g) => g.items.length > 0).map((g) => (
        <section key={g.origin} className={`pf-diff__group pf-diff__group--${g.origin}`} aria-label={GROUP[g.origin].title}>
          <ul className="pf-diff__list">
            {g.items.map((r) => (
              <li key={r.key} className="pf-diff__row">
                <span className="pf-diff__label">
                  {r.step && onGo ? <button type="button" className="pf-link" onClick={() => onGo(r.step!)}>{r.label}</button> : r.label}
                </span>
                <span className="pf-diff__value num">
                  {r.origin === 'changed' && r.base !== undefined && <span className="pf-diff__base">{r.base} →</span>}
                  {r.value}
                </span>
                {r.owner && <span className="pf-diff__owner">{r.owner}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/* ── Сравнение A / B (N колонок): только отличающиеся строки, Δ к первой колонке (база) ── */

export interface DiffTableRow<T> {
  key: string
  label: string
  get: (item: T) => number | string | null | undefined
  fmt?: (v: number) => string
  better?: 'high' | 'low'
  /** Показывать и при равенстве. */
  always?: boolean
  /** Форматтер разницы со знаком (по умолчанию — `fmt` с «+»/U+2212). */
  fmtDelta?: (v: number) => string
}

interface DiffTableProps<T> {
  columns: ReadonlyArray<{ id: string; title: string; item: T }>
  rows: ReadonlyArray<DiffTableRow<T>>
  caption?: string
  emptyText?: string
}

/** Текст значения так, как его видит пользователь; сравнение «отличается ли» — по нему (эффективное значение). */
function cellText<T>(r: DiffTableRow<T>, v: number | string | null | undefined): string {
  if (typeof v === 'number') return Number.isFinite(v) ? (r.fmt ? r.fmt(v) : String(v)) : '—'
  return v == null || v === '' ? '—' : String(v)
}

/** «+» перед положительной разницей; минус форматтер даёт сам (U+2212). */
function signedText(v: number, fmt?: (v: number) => string): string {
  const text = fmt ? fmt(v) : String(v)
  return v > 0 && !text.startsWith('+') ? `+${text}` : text
}

export function DiffTable<T>({ columns, rows, caption, emptyText = 'Отличий нет' }: DiffTableProps<T>) {
  const visible = rows.map((r) => {
    const vals = columns.map((c) => r.get(c.item))
    const texts = vals.map((v) => cellText(r, v))
    const differs = texts.some((t) => t !== texts[0])
    return { r, vals, texts, differs }
  }).filter((x) => x.differs || x.r.always)
  if (visible.length === 0) return <p className="pf-diff__empty">{emptyText}</p>
  const base = columns[0]?.title
  return (
    <table className="pf-dtable">
      {caption && <caption className="text-caps">{caption}</caption>}
      <thead>
        <tr><th>Показатель</th>{columns.map((c, i) => <th key={c.id}>{i === 0 ? `${c.title} (база)` : c.title}</th>)}</tr>
      </thead>
      <tbody>
        {visible.map(({ r, vals, texts }) => {
          const b = vals[0]
          return (
            <tr key={r.key}>
              <td className="pf-dtable__label">{r.label}</td>
              {vals.map((v, i) => {
                const delta = i > 0 && typeof v === 'number' && typeof b === 'number' && Number.isFinite(v) && Number.isFinite(b) && texts[i] !== texts[0] ? v - b : null
                return (
                  <td key={columns[i].id} className="num">
                    <span className="pf-dtable__cell">
                      {texts[i]}
                      {delta !== null && <DeltaChip value={delta} fmt={(d) => signedText(d, r.fmtDelta ?? r.fmt)} better={r.better} base={base} />}
                    </span>
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
