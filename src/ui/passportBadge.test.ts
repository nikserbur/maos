import { describe, expect, it } from 'vitest'
import { badgeForField, badgeForProvenance, badgeForStatus, ownerLabel } from './passportBadge'
import { VOCABULARY, vocabForState } from './stateVocabulary'

describe('passport badge mapping', () => {
  it('maps every server status to a human label, keeps the passport letter in `code` and never calls [К]/[НОРМ] «оценено»', () => {
    expect(badgeForStatus('Н')).toMatchObject({ code: 'Н', short: 'по данным', glyph: '●', label: 'по данным: наблюдение' })
    expect(badgeForStatus('О')).toMatchObject({ code: 'О', short: 'по данным', tone: 'good', label: 'оценено по данным' })
    expect(badgeForStatus('К')).toMatchObject({ code: 'К', short: 'по данным', label: 'по данным: калибровка по план-факту' })
    expect(badgeForStatus('НОРМ')).toMatchObject({ code: 'НОРМ', short: 'норматив', tone: 'neutral', glyph: '◆' })
    for (const st of ['К', 'НОРМ', 'UI', 'техн.', 'синтетика'] as const) expect(badgeForStatus(st).label).not.toContain('оцен')
    // Буквы паспорта никогда не попадают в короткую подпись бейджа.
    for (const st of ['Н', 'О', 'К', 'НОРМ'] as const) expect(badgeForStatus(st).short).not.toBe(st)
  })

  it('uses the shared vocabulary: ● по данным · ■ manual · ◆ normative · ○ default · ▲ stale; «в плане» без глифа', () => {
    expect(badgeForProvenance('estimated', { stage: 'w2' })).toMatchObject({ short: 'в плане', glyph: '' })
    // «для UI» и «константа кода» — тоже «по умолчанию» (○), подробность в label
    expect(badgeForStatus('UI')).toMatchObject({ short: 'по умолчанию', glyph: '○' })
    expect(badgeForStatus('техн.')).toMatchObject({ short: 'по умолчанию', glyph: '○' })
    expect(badgeForProvenance('estimated').glyph).toBe('●')
    expect(badgeForProvenance('manual').glyph).toBe('■')
    expect(badgeForProvenance('normative').glyph).toBe('◆')
    expect(badgeForProvenance('default').glyph).toBe('○')
    expect(badgeForProvenance('synthetic').glyph).toBe('▲')
    expect(badgeForStatus('UI', { deprecated: true }).glyph).toBe('▲')
  })

  it('turns UI into «не в расчёте» only when the field is deprecated', () => {
    expect(badgeForStatus('UI').key).toBe('ui')
    expect(badgeForStatus('UI', { deprecated: true })).toMatchObject({ key: 'deprecated', tone: 'warn', glyph: '▲' })
    expect(badgeForStatus(undefined, { deprecated: true }).key).toBe('deprecated')
  })

  it('flags synthetic data with a warning tone and unknown statuses as defaults', () => {
    expect(badgeForStatus('синтетика')).toMatchObject({ key: 'synthetic', tone: 'warn' })
    expect(badgeForStatus('техн.').key).toBe('technical')
    expect(badgeForStatus('что-то').key).toBe('default')
  })

  it('maps map provenance, with planned waves and deprecation taking precedence', () => {
    expect(badgeForProvenance('estimated').key).toBe('estimated')
    expect(badgeForProvenance('manual').key).toBe('manual')
    expect(badgeForProvenance('ui').key).toBe('ui')
    expect(badgeForProvenance('synthetic').key).toBe('synthetic')
    expect(badgeForProvenance('estimated', { stage: 'w3' }).key).toBe('planned')
    expect(badgeForProvenance('normative', { deprecated: true }).key).toBe('deprecated')
    expect(badgeForProvenance('calibrated', { stage: 'done' }).key).toBe('calibrated')
  })

  it('labels the owner of a value', () => {
    expect(ownerLabel('run')).toBe('этот прогон')
    expect(ownerLabel('scenario', 'Базовый')).toBe('из сценария «Базовый»')
    expect(ownerLabel('scenario')).toBe('из сценария')
    expect(ownerLabel('project')).toContain('НСИ')
  })
})

describe('state vocabulary', () => {
  it('within a family every glyph means exactly one state', () => {
    const byFamily = new Map<string, string[]>()
    for (const e of Object.values(VOCABULARY)) {
      if (!e.glyph) continue
      byFamily.set(e.family, [...(byFamily.get(e.family) ?? []), e.glyph])
    }
    for (const glyphs of byFamily.values()) expect(new Set(glyphs).size).toBe(glyphs.length)
    expect(VOCABULARY.error.glyph).toBe('✕')
    expect(VOCABULARY.manual.glyph).toBe('■')
    expect(VOCABULARY.planned.glyph).toBe('')
  })

  it('maps every map node state; calibrated and estimated share «по данным»', () => {
    expect(vocabForState('calibrated').word).toBe(vocabForState('estimated').word)
    expect(vocabForState('unconfigured').glyph).toBe('◌')
    expect(vocabForState('error').word).toBe('ошибка')
  })

  it('a manual field never shows «норматив» even when the passport status says НОРМ', () => {
    expect(badgeForField({ provenance: 'manual', status: 'НОРМ' }).key).toBe('manual')
    expect(badgeForField({ status: 'НОРМ' }).key).toBe('normative')
    expect(badgeForField({ provenance: 'estimated', stage: 'w3' }).key).toBe('planned')
  })
})
