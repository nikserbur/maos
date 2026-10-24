/**
 * Хлебные крошки (X2 «одно имя — одна вещь»): «Справочники › Техкарты › ТК-12 Вал». Родители —
 * ссылки (<a href>), последняя — текущая страница (aria-current="page"); одна строка без переноса,
 * средние крошки сжимаются с многоточием, полный текст — в title.
 */
import { Fragment } from 'react'
import './kit.css'

export interface Crumb {
  label: string
  /** Hash-адрес родителя; у текущей страницы не задаётся. */
  href?: string
}

interface BreadcrumbsProps {
  items: ReadonlyArray<Crumb>
  label?: string
  className?: string
}

export function Breadcrumbs({ items, label = 'Путь', className }: BreadcrumbsProps) {
  if (items.length === 0) return null
  const last = items.length - 1
  return (
    <nav className={`dk-crumbs${className ? ` ${className}` : ''}`} aria-label={label}>
      <ol className="dk-crumbs__list">
        {items.map((c, i) => (
          <Fragment key={`${i}-${c.label}`}>
            <li className={`dk-crumbs__item${i === 0 ? ' is-root' : ''}${i === last ? ' is-current' : ''}`}>
              {i === last || !c.href
                ? <span className="dk-crumbs__cur" aria-current={i === last ? 'page' : undefined} title={c.label}>{c.label}</span>
                : <a className="dk-crumbs__link" href={c.href} title={c.label}>{c.label}</a>}
            </li>
            {i < last && <li className="dk-crumbs__sep" aria-hidden="true">›</li>}
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}
