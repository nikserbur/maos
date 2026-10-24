/**
 * Единый реестр стадий (X2 P-122/P-123): узел карты с возможностью F и «Подробнее» → раздел X, а раздел
 * X показывает чип той же возможности с той же стадией; каждый раздел с узлами карты ссылается на карту;
 * в «Методике» нет устаревших версий и сроков.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { FEATURES, STAGE_META } from '../../explain/stages'
import { NODES, nodesForSection } from '../method-map/registry'
import { SECTIONS } from './sections'
import { TOC } from './toc'
import type { SectionId } from './toc'

const html = (id: SectionId): string => renderToStaticMarkup(createElement(SECTIONS[id]))

describe('stage registry: map ↔ Методика', () => {
  it('a map node with feature F and learnMore X agrees with the chip of F in section X', () => {
    const linked = NODES.filter((n) => n.feature && n.learnMore)
    expect(linked.length).toBeGreaterThan(5)
    for (const n of linked) {
      const f = n.feature!
      expect(n.stage, n.id).toBe(FEATURES[f].stage)
      const page = html(n.learnMore as SectionId)
      expect(page, `${n.id} → раздел «${n.learnMore}» без чипа «${f}»`).toContain(`data-feature="${f}" data-stage="${FEATURES[f].stage}"`)
    }
  })

  it('stage words come from one STAGE_META: planned waves are never ▲', () => {
    for (const s of Object.values(STAGE_META)) expect(s.glyph).not.toBe('▲')
    expect(STAGE_META.w2.label).toBe('в плане · волна 2')
  })

  it('every section with map nodes links back to the map; no stale version or RL deadlines', () => {
    const ids = TOC.flatMap((g) => g.items.map((it) => it.id))
    let withLinks = 0
    for (const id of ids) {
      const page = html(id)
      if (nodesForSection(id).length > 0) {
        expect(page, id).toContain('href="#/map/')
        expect(page, id).toContain('На карте:')
        withLinks++
      }
      expect(page, id).not.toContain('0.58')
      expect(page, id).not.toMatch(/~4\s*дня/)
    }
    expect(withLinks).toBeGreaterThan(5)
    expect(html('rl')).toContain('49 из 60')
  })
})
