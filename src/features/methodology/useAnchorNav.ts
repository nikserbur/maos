/**
 * Навигация по якорям «Методики»:
 *  — на монтировании и по `hashchange` (клик по ссылке оглавления, «Назад») читает
 *    `#/methodology/<anchor>` и прокручивает к разделу: плавно, а мгновенно — при
 *    prefers-reduced-motion и в фоновой вкладке (там плавная прокрутка не выполняется);
 *  — scroll-spy: какой раздел сейчас читается (для индикатора в оглавлении).
 */
import { useCallback, useEffect, useState, type RefObject } from 'react'
import { SECTION_IDS, anchorFromHash, isSectionId, type SectionId } from './toc'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** Плавно — только в видимой вкладке без prefers-reduced-motion. */
export function scrollBehavior(): ScrollBehavior {
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  return hidden || prefersReducedMotion() ? 'auto' : 'smooth'
}

export function useAnchorNav(rootRef: RefObject<HTMLElement>): { active: SectionId; scrollTo: (id: SectionId | '') => void } {
  const [active, setActive] = useState<SectionId>(SECTION_IDS[0])

  const scrollTo = useCallback((id: SectionId | '') => {
    const root = rootRef.current
    if (!root) return
    const behavior = scrollBehavior()
    if (!id) { root.scrollTo({ top: 0, behavior }); return }
    const el = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
    if (!el) return
    el.scrollIntoView({ behavior, block: 'start' })
    setActive(id)
  }, [rootRef])

  // Якорь из адреса: при открытии экрана и при каждом hashchange.
  useEffect(() => {
    const apply = () => {
      const anchor = anchorFromHash(window.location.hash)
      if (anchor === null) return
      if (anchor === '' || isSectionId(anchor)) scrollTo(anchor)
    }
    // Два кадра: дождаться раскладки секций (схемы — с плейсхолдерами той же пропорции).
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(apply) })
    // Схемы грузятся лениво и могут сдвинуть раскладку — повторяем после их загрузки.
    const late = window.setTimeout(apply, 700)
    window.addEventListener('hashchange', apply)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.clearTimeout(late)
      window.removeEventListener('hashchange', apply)
    }
  }, [scrollTo])

  // Scroll-spy: активен верхний из разделов, пересекающих полосу чтения.
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const visible = new Set<string>()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target.id)
        else visible.delete(e.target.id)
      }
      const first = SECTION_IDS.find((id) => visible.has(id))
      if (first) setActive(first)
    }, { root, rootMargin: '-12% 0px -62% 0px', threshold: 0 })
    for (const id of SECTION_IDS) {
      const el = root.querySelector(`#${CSS.escape(id)}`)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [rootRef])

  return { active, scrollTo }
}
