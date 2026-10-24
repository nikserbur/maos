/**
 * Список реестров (P-55): ссылки `#/nsi/<id>` (Cmd/Ctrl+клик — новая вкладка), текущий — aria-current,
 * рядом приглушённое число записей и ▲, если есть неполные записи (рабочие без цеха, станки без типа…).
 */
import { num, countText } from '../../explain/format'
import { buildHash } from '../../shell/router'
import type { NsiData, NsiLookups } from './nsiLookups'
import { REGISTRIES } from './registries'
import { incompleteCount, type RegistryLists } from './useNsiData'

const RECORD_FORMS = ['запись неполна', 'записи неполны', 'записей неполны'] as const

interface RegistryNavProps {
  activeId: string
  lists: RegistryLists
  data: NsiData
  lk: NsiLookups
}

export function RegistryNav({ activeId, lists, data, lk }: RegistryNavProps) {
  return (
    <nav className="nsi__list" aria-labelledby="nsi-list-title">
      <p className="nsi__list-title" id="nsi-list-title">Реестры</p>
      <ul className="nsi__items">
        {REGISTRIES.map((r) => {
          const list = lists[r.id]
          const bad = list?.loaded ? incompleteCount(r.id, data, lk) : 0
          const current = r.id === activeId
          return (
            <li key={r.id}>
              <a className={current ? 'nsi__item nsi__item--active' : 'nsi__item'} href={buildHash('nsi', r.id)} aria-current={current ? 'page' : undefined}>
                <span className="nsi__item-t">{r.title}</span>
                {bad > 0 && (
                  <span className="glyph-setup nsi__item-flag" title={countText(bad, RECORD_FORMS)}>
                    <span className="dk-vh">{countText(bad, RECORD_FORMS)}</span>
                  </span>
                )}
                <span className="nsi__item-n num">{list?.loaded ? num(list.data.length, 0) : list?.error ? '✕' : ''}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
