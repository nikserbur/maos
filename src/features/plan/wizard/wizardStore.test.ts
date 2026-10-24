import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_FIELDS, RISK_PRESETS, WIZARD_STEPS, diffFields, effectiveFields, getWizardState, isChanged, parseDraft, stepState, wizardActions,
} from './wizardStore'
import { snapshotOf } from '../runMeta'

const READY = { programOk: true, scenarioOk: true, finOk: true, running: false }

describe('plan wizard store — inherited vs changed', () => {
  beforeEach(() => wizardActions.reset())

  it('starts on the first step with code defaults and no overrides', () => {
    const s = getWizardState()
    expect(s.step).toBe('program')
    expect(s.base).toEqual(DEFAULT_FIELDS)
    expect(s.overrides).toEqual({})
    expect(diffFields(s).every((r) => r.origin === 'inherited' || r.origin === 'unset')).toBe(true)
    expect(diffFields(s).find((r) => r.key === 'tailWeight')?.origin).toBe('unset') // задаёт планировщик
  })

  it('inherits base values with their owner and keeps run overrides on top', () => {
    wizardActions.setBase({ alpha: 0.2, objective: 'worstcase' }, 'из сценария «Кризис»')
    wizardActions.setOverride('alpha', 0.1)
    const s = getWizardState()
    expect(effectiveFields(s).alpha).toBe(0.1)
    expect(effectiveFields(s).objective).toBe('worstcase')
    const rows = diffFields(s)
    expect(rows.find((r) => r.key === 'alpha')).toMatchObject({ origin: 'changed', owner: 'этот прогон', base: '0.2', value: '0.1', step: 'objective' })
    expect(rows.find((r) => r.key === 'objective')).toMatchObject({ origin: 'inherited', owner: 'из сценария «Кризис»' })
    // Новая база не затирает переопределение прогона.
    wizardActions.setBase({ alpha: 0.15 }, 'из сценария «Базовый»')
    expect(effectiveFields(getWizardState()).alpha).toBe(0.1)
  })

  it('treats an override equal to the base as inherited and reverts cleanly', () => {
    wizardActions.setOverride('samples', 500)
    expect(isChanged(getWizardState(), 'samples')).toBe(false)
    wizardActions.setOverride('samples', 800)
    expect(isChanged(getWizardState(), 'samples')).toBe(true)
    wizardActions.revert('samples')
    expect(getWizardState().overrides).not.toHaveProperty('samples')
    expect(diffFields(getWizardState()).filter((r) => r.origin === 'changed')).toHaveLength(0)
  })

  it('applies risk presets as run overrides and leaves them alone in expert mode', () => {
    wizardActions.applyPreset('money')
    const s = getWizardState()
    expect(s.preset).toBe('money')
    expect(effectiveFields(s)).toMatchObject(RISK_PRESETS.money)
    expect(diffFields(s).filter((r) => r.origin === 'changed').map((r) => r.key).sort()).toEqual(['cashCriterion', 'wCost', 'wTime'])
    wizardActions.applyPreset('expert')
    expect(getWizardState().preset).toBe('expert')
    expect(effectiveFields(getWizardState()).wCost).toBe(1)
    wizardActions.applyPreset('time')
    expect(diffFields(getWizardState()).filter((r) => r.origin === 'changed')).toHaveLength(0) // пресет = умолчание
  })

  it('navigates steps in order and records visited ones', () => {
    wizardActions.next(); wizardActions.next()
    expect(getWizardState().step).toBe('distributions')
    wizardActions.prev()
    expect(getWizardState().step).toBe('conditions')
    expect([...getWizardState().visited]).toEqual(['program', 'conditions', 'distributions'])
    wizardActions.setStep('launch')
    for (let i = 0; i < 10; i++) wizardActions.next()
    expect(getWizardState().step).toBe(WIZARD_STEPS[WIZARD_STEPS.length - 1])
    expect(WIZARD_STEPS).toHaveLength(6) // результат — свой адрес #/plan/run/<id>, не шаг мастера
  })

  it('derives step glyphs from readiness and changes', () => {
    const s = getWizardState()
    expect(stepState(s, 'program', { ...READY, programOk: false })).toBe('empty')
    expect(stepState(s, 'program', READY)).toBe('done')
    expect(stepState(s, 'conditions', { ...READY, scenarioOk: false })).toBe('warn')
    expect(stepState(s, 'constraints', READY)).toBe('default')
    wizardActions.setOverride('useCalendar', false)
    expect(stepState(getWizardState(), 'constraints', READY)).toBe('done')
    expect(stepState(getWizardState(), 'launch', { ...READY, running: true })).toBe('running')
  })

  it('starts a fresh flow from a portfolio run («Передать в План»)', () => {
    wizardActions.setOverride('wRisk', 2)
    wizardActions.startFromPortfolio('run-1', 'scn-1')
    const s = getWizardState()
    expect(s).toMatchObject({ source: 'portfolio', runId: 'run-1', scenarioId: 'scn-1', step: 'program' })
    expect(s.overrides).toEqual({})
  })

  it('restores a draft from storage and rejects garbage', () => {
    expect(parseDraft('{not json')).toBeNull()
    expect(parseDraft(null)).toBeNull()
    const d = parseDraft(JSON.stringify({ step: 'objective', source: 'manual', overrides: { alpha: 0.2, samples: 'много', bogus: 1 }, crits: [{ criterion: 'nope', weight: 1 }] }))
    expect(d).toMatchObject({ step: 'objective', source: 'manual', overrides: { alpha: 0.2 } })
    expect(d?.overrides).not.toHaveProperty('samples')
    expect(d?.overrides).not.toHaveProperty('bogus')
    expect(d?.crits).toEqual([{ criterion: 'duration', dir: -1, weight: 1 }])
    expect(parseDraft(JSON.stringify({ step: 'result' }))?.step).toBe('program')
  })

  it('prefills the wizard from a past run («Новый план», «Повторить»)', () => {
    wizardActions.setSource('manual')
    wizardActions.setManualOrders([{ product_id: 'p1', qty: 3, due_hours: 48, priority: 5 }])
    wizardActions.setOverride('samples', 800)
    const snap = snapshotOf(getWizardState())
    wizardActions.reset()
    wizardActions.prefill(snap, 'launch')
    const s = getWizardState()
    expect(s).toMatchObject({ step: 'launch', source: 'manual', overrides: { samples: 800 } })
    expect(s.manualOrders).toHaveLength(1)
  })
})
