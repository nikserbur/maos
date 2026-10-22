import { describe, expect, it } from 'vitest'
import { dueDateFromHours, dueRelativeText, horizonStart, hoursFromDueDate, parseIsoDate, programHorizon, toIsoDate } from './dates'

const START = Date.UTC(2026, 9, 22) // 2026-10-22

describe('order due dates ↔ due_hours', () => {
  it('parses and prints ISO dates symmetrically, rejecting junk', () => {
    expect(toIsoDate(parseIsoDate('2026-10-22')!)).toBe('2026-10-22')
    expect(parseIsoDate('2026-10-22 00:00:00')?.getTime()).toBe(START)
    expect(parseIsoDate('')).toBeNull()
    expect(parseIsoDate('22.10.2026')).toBeNull()
    expect(parseIsoDate(undefined)).toBeNull()
  })

  it('takes the horizon start from the scenario and falls back honestly', () => {
    expect(horizonStart('2026-11-01', new Date(START))).toMatchObject({ source: 'scenario' })
    const fb = horizonStart('', new Date(Date.UTC(2026, 9, 22, 15, 30)))
    expect(fb.source).toBe('fallback')
    expect(toIsoDate(fb.date)).toBe('2026-10-22') // полночь, не 15:30
  })

  it('converts hours to a date by whole days (24 h = next day, 23 h = same day)', () => {
    const start = new Date(START)
    expect(toIsoDate(dueDateFromHours(start, 0))).toBe('2026-10-22')
    expect(toIsoDate(dueDateFromHours(start, 23))).toBe('2026-10-22')
    expect(toIsoDate(dueDateFromHours(start, 24))).toBe('2026-10-23')
    expect(toIsoDate(dueDateFromHours(start, 720))).toBe('2026-11-21')
    expect(toIsoDate(dueDateFromHours(start, 9360))).toBe('2027-11-16')
    expect(toIsoDate(dueDateFromHours(start, Number.NaN))).toBe('2026-10-22')
  })

  it('converts a date back to hours and round-trips whole days; dates before start clamp to 0', () => {
    const start = new Date(START)
    expect(hoursFromDueDate(start, parseIsoDate('2026-10-23')!)).toBe(24)
    expect(hoursFromDueDate(start, parseIsoDate('2026-11-21')!)).toBe(720)
    expect(hoursFromDueDate(start, parseIsoDate('2026-10-01')!)).toBe(0)
    for (const h of [0, 24, 168, 720, 4320, 9360]) expect(hoursFromDueDate(start, dueDateFromHours(start, h))).toBe(h)
    // Лишние часы внутри суток теряются только при обратном переводе — это и есть «техническое поле».
    expect(hoursFromDueDate(start, dueDateFromHours(start, 130))).toBe(120)
  })

  it('describes the due date relative to the start in Russian', () => {
    expect(dueRelativeText(0)).toBe('в день старта')
    expect(dueRelativeText(24)).toBe('через 1 день')
    expect(dueRelativeText(72)).toBe('через 3 дня')
    expect(dueRelativeText(120)).toBe('через 5 дней')
    expect(dueRelativeText(14 * 24)).toBe('через 2 недели')
    expect(dueRelativeText(720)).toBe('через 4 недели')
    expect(dueRelativeText(1500)).toBe('через 2 месяца')
    expect(dueRelativeText(9360)).toBe('через 13 месяцев')
  })

  it('computes the program horizon as the latest due date', () => {
    const h = programHorizon([{ due_hours: 120 }, { due_hours: 720 }, { due_hours: Number.NaN }], new Date(START))
    expect(h.hours).toBe(720)
    expect(toIsoDate(h.end)).toBe('2026-11-21')
    expect(programHorizon([], new Date(START)).hours).toBe(0)
  })
})
