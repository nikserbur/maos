import { describe, expect, it } from 'vitest'
import { badgeForProvenance, badgeForStatus, ownerLabel } from './passportBadge'

describe('passport badge mapping', () => {
  it('maps every server status to a human label, keeps the passport letter in `code` and never calls [К]/[НОРМ] «оценено»', () => {
    expect(badgeForStatus('Н')).toMatchObject({ code: 'Н', short: 'наблюдение', glyph: '●' })
    expect(badgeForStatus('О')).toMatchObject({ code: 'О', short: 'оценено', tone: 'good', label: 'оценено по данным' })
    expect(badgeForStatus('К')).toMatchObject({ code: 'К', short: 'калибровка', tone: 'neutral' })
    expect(badgeForStatus('НОРМ')).toMatchObject({ code: 'НОРМ', short: 'норматив', tone: 'neutral', glyph: '◆' })
    for (const st of ['К', 'НОРМ', 'UI', 'техн.', 'синтетика'] as const) expect(badgeForStatus(st).label).not.toContain('оцен')
    // Буквы паспорта никогда не попадают в короткую подпись бейджа.
    for (const st of ['Н', 'О', 'К', 'НОРМ'] as const) expect(badgeForStatus(st).short).not.toBe(st)
  })

  it('uses the map glyph dictionary: ● estimated · ■ manual · ◆ normative · ○ default · ▲ stale', () => {
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
