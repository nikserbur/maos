/**
 * Вкладки разделов (владелец: «выбор из радио-пилюль — не нравится»): подчёркивание акцентом под
 * активной вкладкой, без «таблетки» — навигация больше не похожа на переключатель режима.
 * Правило выбора (kit/index.ts): другой раздел/другие данные → Tabs; тот же контент в другом виде → Segmented.
 *  - Все пункты с `href` → <nav> со ссылками и aria-current="page" (Cmd/Ctrl-клик открывает в новой вкладке).
 *  - `kind="nav"` без href → <nav> с кнопками aria-current (совместимость со старым Segmented kind="nav").
 *  - Иначе → ARIA tablist: role=tab, roving tabindex, ←/→/Home/End; `activation="manual"` — стрелки
 *    только двигают фокус, Enter/Space выбирает (панели, которые грузят данные, APG).
 * Счётчик — отдельный бейдж с числом; пояснение («2 из 76 рядов заданы вручную») — в `countLabel`.
 * Иконки — только у вкладок панели (`size="panel"`); вкладки страницы на всех экранах — текстом.
 * Не помещаются — полоса прокручивается, а край, за которым есть ещё вкладки, гаснет и получает
 * кнопку-шеврон (вкладки не пропадают молча за правым краем).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { Icon, type IconName } from '../../shell/icons'
import { rovingNext } from './rovingKeys'
import './kit.css'

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
  /** Ссылка раздела (маршрут в URL) — вкладки становятся ссылками. */
  href?: string
  icon?: IconName
  /** Число в бейдже; 0 скрывается, если не `showZero`. */
  count?: number
  /** Пояснение счётчика для подсказки и экранного диктора: «2 из 76 рядов заданы вручную». */
  countLabel?: string
  showZero?: boolean
  /** Глиф состояния рядом с подписью (▲ ■) — всегда вместе со словом в `title`. */
  status?: ReactNode
  title?: string
  disabled?: boolean
  /** Причина недоступности — видна в подсказке и диктору. */
  reason?: string
}

export interface TabsProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>
  value: T
  onChange?: (id: T) => void
  /** Доступное имя группы: «Разделы сценария». */
  label: string
  /** page — разделы экрана (40 px, 14 px); panel — панели и вторичные разделы (32 px, 13 px). */
  size?: 'page' | 'panel'
  /** Только для tablist: auto — выбор стрелками; manual — стрелки двигают фокус, Enter/Space выбирает. */
  activation?: 'auto' | 'manual'
  /** Префикс id для связи tab ↔ tabpanel: `${idBase}-tab-<id>` / `${idBase}-panel-<id>`. */
  idBase?: string
  /** Навигация кнопками (aria-current) вместо tablist, когда href нет, а выбор меняет URL. */
  kind?: 'tablist' | 'nav'
  /** Хвост справа на той же базовой линии (легенда, «i», действия). */
  end?: ReactNode
  /** Значение aria-current у ссылок/навигации: page — разделы экрана; location — оглавление страницы (scroll-spy). */
  current?: 'page' | 'location'
  className?: string
}

const isModified = (e: MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

/** Доля видимой ширины полосы, на которую прокручивает шеврон. */
const SCROLL_SHARE = 0.7

/** Есть ли вкладки за левым/правым краем прокручиваемой полосы. */
function useEdgeOverflow(listRef: RefObject<HTMLDivElement>, count: number): { start: boolean; end: boolean; scroll: (dir: -1 | 1) => void } {
  const [edge, setEdge] = useState({ start: false, end: false })
  const update = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const start = el.scrollLeft > 1
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setEdge((p) => (p.start === start && p.end === end ? p : { start, end }))
  }, [listRef])
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return undefined
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', update); ro?.disconnect() }
  }, [listRef, update, count])
  const scroll = (dir: -1 | 1) => {
    const el = listRef.current
    if (el) el.scrollBy({ left: dir * Math.max(80, el.clientWidth * SCROLL_SHARE), behavior: 'smooth' })
  }
  return { ...edge, scroll }
}

export function Tabs<T extends string>({
  items, value, onChange, label, size = 'page', activation = 'auto', idBase, kind = 'tablist', end, current = 'page', className,
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const edge = useEdgeOverflow(listRef, items.length)
  const links = items.length > 0 && items.every((t) => t.href)
  const mode: 'links' | 'nav' | 'tablist' = links ? 'links' : kind === 'nav' ? 'nav' : 'tablist'

  // Активная вкладка всегда видна в прокручиваемой полосе (узкие панели).
  // Прокручивается только сама полоса (по горизонтали) — страница не прыгает.
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>('[data-active="true"]')
    if (!list || !el || list.scrollWidth <= list.clientWidth) return
    const left = el.offsetLeft // полоса — position: relative, отсчёт от её края
    if (left < list.scrollLeft) list.scrollLeft = left
    else if (left + el.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = left + el.offsetWidth - list.clientWidth
  }, [value])

  const enabled = items.filter((t) => !t.disabled)
  // Roving tabindex: фокус по Tab — на активной вкладке, а если её нет среди доступных — на первой.
  const focusId = enabled.some((t) => t.id === value) ? value : enabled[0]?.id
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'tablist') return
    const focused = enabled.findIndex((t) => `${t.id}` === (document.activeElement as HTMLElement | null)?.dataset.tab)
    const at = focused >= 0 ? focused : enabled.findIndex((t) => t.id === value)
    const next = rovingNext(e.key, at, enabled.length, 'horizontal')
    if (next < 0 || !enabled[next]) return
    e.preventDefault()
    const target = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? []).find((el) => el.dataset.tab === String(enabled[next].id))
    target?.focus()
    if (activation === 'auto') onChange?.(enabled[next].id)
  }

  const cls = ['dk-tabs', `dk-tabs--${size}`, className ?? ''].filter(Boolean).join(' ')
  const list = (
    <div ref={listRef} className="dk-tabs__list" role={mode === 'tablist' ? 'tablist' : undefined}
         aria-label={mode === 'tablist' ? label : undefined} onKeyDown={onKeyDown}
         data-overflow-start={edge.start || undefined} data-overflow-end={edge.end || undefined}>
      {items.map((t) => {
        const on = t.id === value
        const inner = <TabInner item={t} withIcon={size === 'panel'} />
        const common = {
          className: `dk-tab${on ? ' is-on' : ''}`,
          'data-tab': t.id,
          'data-active': on ? 'true' : undefined,
          title: t.disabled && t.reason ? t.reason : t.title,
        }
        if (mode === 'links') {
          return (
            <a key={t.id} {...common} href={t.disabled ? undefined : t.href} aria-current={on ? current : undefined} aria-disabled={t.disabled || undefined}
               onClick={(e) => {
                 if (t.disabled) { e.preventDefault(); return }
                 if (!onChange || isModified(e)) return
                 e.preventDefault()
                 onChange(t.id)
               }}>
              {inner}
            </a>
          )
        }
        const a11y = mode === 'tablist'
          ? { role: 'tab' as const, 'aria-selected': on, tabIndex: t.id === focusId ? 0 : -1,
              id: idBase ? `${idBase}-tab-${t.id}` : undefined, 'aria-controls': idBase ? `${idBase}-panel-${t.id}` : undefined }
          : { 'aria-current': on ? current : undefined }
        return (
          <button key={t.id} {...common} type="button" disabled={t.disabled} onClick={() => onChange?.(t.id)} {...a11y}>
            {inner}
          </button>
        )
      })}
    </div>
  )
  // Шевроны — для мыши (клавиатура: стрелки/Tab и так прокручивают к вкладке); диктору не нужны.
  const viewport = (
    <div className="dk-tabs__viewport">
      {list}
      {edge.start && <button type="button" className="dk-tabs__scroll dk-tabs__scroll--start" tabIndex={-1} aria-hidden="true" onClick={() => edge.scroll(-1)}>‹</button>}
      {edge.end && <button type="button" className="dk-tabs__scroll dk-tabs__scroll--end" tabIndex={-1} aria-hidden="true" onClick={() => edge.scroll(1)}>›</button>}
    </div>
  )
  return mode === 'tablist'
    ? <div className={cls}>{viewport}{end && <div className="dk-tabs__end">{end}</div>}</div>
    : <nav className={cls} aria-label={label}>{viewport}{end && <div className="dk-tabs__end">{end}</div>}</nav>
}

/** Иконка (только у вкладок панели) · подпись (ширина под жирное начертание зарезервирована — без «прыжка») · счётчик · глиф. */
function TabInner<T extends string>({ item, withIcon }: { item: TabItem<T>; withIcon: boolean }) {
  const showCount = item.count !== undefined && (item.count !== 0 || item.showZero)
  return (
    <>
      {withIcon && item.icon && <Icon name={item.icon} size={16} />}
      <span className="dk-tab__label" data-label={typeof item.label === 'string' ? item.label : undefined}><span className="dk-tab__text">{item.label}</span></span>
      {showCount && (
        <span className="dk-tab__count" title={item.countLabel}>
          <span aria-hidden={item.countLabel ? true : undefined}>{item.count}</span>
          {item.countLabel && <span className="dk-vh">, {item.countLabel}</span>}
        </span>
      )}
      {item.status && <span className="dk-tab__status">{item.status}</span>}
      {item.disabled && item.reason && <span className="dk-vh">, недоступно: {item.reason}</span>}
    </>
  )
}

/** Панель вкладки (tablist): role=tabpanel, связь с вкладкой, фокусируемая для клавиатуры. */
export function TabPanel({ idBase, id, children, className, busy }: {
  idBase: string; id: string; children: ReactNode; className?: string; busy?: boolean
}) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} tabIndex={0} className={className} aria-busy={busy || undefined}>
      {children}
    </div>
  )
}
