/**
 * Оглавление результата плана (X2 «оглавление подсвечивает то, что видно»): липкое под шапкой внутри
 * скролл-контейнера `.plan`. Видимость секций копится в Map между вызовами наблюдателя; активна первая
 * видимая в порядке документа. Клик — активна сразу, наблюдатель молчит до конца прокрутки
 * (scrollend или запасной таймер), раздел пишется в адрес (replaceState). Высота оглавления —
 * переменная `--pl-toc-h` контейнера: на ней держатся scroll-padding и отступ наблюдателя.
 * Вид — вкладки кита (подчёркивание, aria-current="location"), как и у разделов других экранов.
 */
import { useEffect, useRef, useState } from 'react'
import { Tabs } from '../../ui/kit'
import { revealPlanSection } from './usePlanSelection'
import './plan-screen.css'

export interface TocItem { id: string; slug: string; label: string }

/** Запасной таймер, если браузер не знает scrollend. */
const SCROLL_SETTLE_MS = 900
const TOC_GAP = 8

interface ResultTocProps {
  items: readonly TocItem[]
  /** Раздел из адреса — активен и прокручивается при открытии. */
  initial?: string | null
  onSection?: (slug: string) => void
}

export function ResultToc({ items, initial = null, onSection }: ResultTocProps) {
  const navRef = useRef<HTMLDivElement>(null)
  const start = items.find((it) => it.slug === initial) ?? items[0]
  const [active, setActive] = useState<string>(start?.id ?? '')
  const activeRef = useRef(active)
  const locked = useRef(false)
  const report = useRef(onSection)
  report.current = onSection

  // Раздел из адреса: прокрутить один раз после первой раскладки.
  useEffect(() => {
    if (!start || start === items[0]) return
    locked.current = true
    const t = window.setTimeout(() => { revealPlanSection(start.id); window.setTimeout(() => { locked.current = false }, SCROLL_SETTLE_MS) }, 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const nav = navRef.current
    if (!nav || typeof IntersectionObserver === 'undefined') return undefined
    const root = nav.closest<HTMLElement>('.plan')
    const h = nav.offsetHeight
    root?.style.setProperty('--pl-toc-h', `${h}px`)
    // Высота оглавления меняется (перенос вкладок на узком экране) — шапки таблиц (--dk-sticky-top) следуют за ней.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => root?.style.setProperty('--pl-toc-h', `${nav.offsetHeight}px`))
    ro?.observe(nav)
    const visible = new Map<string, boolean>()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) visible.set(e.target.id, e.isIntersecting)
      if (locked.current) return
      const first = items.find((it) => visible.get(it.id))
      if (!first || activeRef.current === first.id) return
      activeRef.current = first.id
      setActive(first.id)
      report.current?.(first.slug)
    }, { root, rootMargin: `-${h + TOC_GAP}px 0px -55% 0px`, threshold: 0 })
    for (const it of items) { const el = document.getElementById(it.id); if (el) io.observe(el) }
    return () => { io.disconnect(); ro?.disconnect() }
  }, [items])

  const go = (it: TocItem) => {
    activeRef.current = it.id
    setActive(it.id)
    report.current?.(it.slug)
    locked.current = true
    const root = navRef.current?.closest<HTMLElement>('.plan')
    let timer = 0
    const release = () => { locked.current = false; window.clearTimeout(timer); root?.removeEventListener('scrollend', release) }
    root?.addEventListener('scrollend', release, { once: true })
    timer = window.setTimeout(release, SCROLL_SETTLE_MS)
    revealPlanSection(it.id)
  }

  return (
    <div ref={navRef} className="pl-toc">
      <Tabs label="Разделы результата" kind="nav" current="location" size="panel" value={active}
        items={items.map((it) => ({ id: it.id, label: it.label }))}
        onChange={(id) => { const it = items.find((x) => x.id === id); if (it) go(it) }} />
    </div>
  )
}
