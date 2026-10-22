/**
 * «Наследовано · Изменено · Не задано» (UX-V2 §4.2 шаг 6) и таблица диффа A/B
 * (UX-V2 §5.3): только отличающиеся поля, направление «лучше» — глифом и тоном.
 */
import type { ReactNode } from 'react'
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

/* ── Сравнение A / B (N колонок): только отличающиеся строки, «лучше» — тоном ── */

export interface DiffTableRow<T> {
  key: string
  label: string
  get: (item: T) => number | string | null | undefined
  fmt?: (v: number) => string
  better?: 'high' | 'low'
  /** Показывать и при равенстве. */
  always?: boolean
}

interface DiffTableProps<T> {
  columns: ReadonlyArray<{ id: string; title: string; item: T }>
  rows: ReadonlyArray<DiffTableRow<T>>
  caption?: string
  emptyText?: string
}

export function DiffTable<T>({ columns, rows, caption, emptyText = 'Отличий нет' }: DiffTableProps<T>) {
  const visible = rows.map((r) => {
    const vals = columns.map((c) => r.get(c.item))
    const differs = vals.some((v) => String(v ?? '') !== String(vals[0] ?? ''))
    return { r, vals, differs }
  }).filter((x) => x.differs || x.r.always)
  if (visible.length === 0) return <p className="pf-diff__empty">{emptyText}</p>
  return (
    <table className="pf-dtable">
      {caption && <caption className="text-caps">{caption}</caption>}
      <thead>
        <tr><th>Показатель</th>{columns.map((c) => <th key={c.id}>{c.title}</th>)}</tr>
      </thead>
      <tbody>
        {visible.map(({ r, vals }) => {
          const nums = vals.map((v) => (typeof v === 'number' ? v : Number.NaN))
          const finite = nums.filter(Number.isFinite)
          const best = r.better && finite.length > 1 ? (r.better === 'high' ? Math.max(...finite) : Math.min(...finite)) : null
          const worst = r.better && finite.length > 1 ? (r.better === 'high' ? Math.min(...finite) : Math.max(...finite)) : null
          return (
            <tr key={r.key}>
              <td className="pf-dtable__label">{r.label}</td>
              {vals.map((v, i) => {
                const n = nums[i]
                const tone = best !== null && best !== worst ? (n === best ? ' is-best' : n === worst ? ' is-worst' : '') : ''
                const text = typeof v === 'number' ? (r.fmt ? r.fmt(v) : String(v)) : v == null || v === '' ? '—' : String(v)
                return <td key={columns[i].id} className={`num${tone}`}>{text}</td>
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
