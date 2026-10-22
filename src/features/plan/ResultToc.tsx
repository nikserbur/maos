/**
 * Оглавление результата плана (UX-V2 §4.2 шаг 7): якоря KPI · узкое место · Гант · очереди ·
 * загрузка · правила · рабочие · касса. Липкое под шапкой; активный раздел — по IntersectionObserver.
 */
import { useEffect, useState } from 'react'
import './plan-screen.css'

export interface TocItem { id: string; label: string; planned?: boolean }

export function ResultToc({ items }: { items: readonly TocItem[] }) {
  const [active, setActive] = useState<string>(items[0]?.id ?? '')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (hit) setActive(hit.target.id)
    }, { rootMargin: '-96px 0px -60% 0px', threshold: 0.01 })
    for (const it of items) { const el = document.getElementById(it.id); if (el) io.observe(el) }
    return () => io.disconnect()
  }, [items])
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <nav className="pl-toc" aria-label="Разделы результата">
      {items.map((it) => (
        <button key={it.id} type="button" className={`pl-toc__item${active === it.id ? ' is-active' : ''}${it.planned ? ' is-planned' : ''}`}
                aria-current={active === it.id ? 'location' : undefined} onClick={() => go(it.id)}>
          {it.label}
        </button>
      ))}
    </nav>
  )
}
