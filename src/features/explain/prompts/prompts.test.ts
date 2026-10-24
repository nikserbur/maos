import { describe, expect, it } from 'vitest'
import { getNode } from '../../method-map/registry'
import { buildContext } from '../context'
import { optFixture, planFixture, rlFixture, stateFixture } from '../mentatFixtures'
import { verifyAnswer } from '../verify'
import {
  CUSTOM_TEMPLATE, FEW_SHOTS, NO_DATA, SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, TEMPLATES,
  askedNodeFor, buildPrompt, missingNeeds, templateForFocus, cite, getTemplate, renderPrompt, templatesFor,
} from './index'

const ctx = () => buildContext({ state: stateFixture(), opt: optFixture(), plan: planFixture(), rl: rlFixture(), asked: 'crit.profit.f.cvar' })

describe('system prompt', () => {
  it('states the citation form, the refusal phrase and the passport language', () => {
    expect(SYSTEM_PROMPT_VERSION).toMatch(/^mentat-sys\/\d+\.\d+\.\d+$/)
    expect(SYSTEM_PROMPT).toContain(cite('id'))
    expect(SYSTEM_PROMPT).toContain(NO_DATA)
    expect(SYSTEM_PROMPT).toContain('статусы К и НОРМ никогда не называй «оценёнными»')
    expect(SYSTEM_PROMPT).toMatch(/Запрещено: прогнозировать, оптимизировать, оценивать параметры/)
    expect(SYSTEM_PROMPT).toContain('Вывод:')
  })
})

describe('templates', () => {
  it('has at least 10 versioned templates with unique ids targeting real map nodes', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(10)
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length)
    for (const t of [...TEMPLATES, CUSTOM_TEMPLATE]) {
      expect(getNode(t.target), t.id).toBeDefined()
      expect(t.version).toMatch(/^\d+\.\d+$/)
      expect(t.task.length, t.id).toBeGreaterThan(40)
    }
    for (const id of ['why_decision', 'cvar_driver', 'compare_runs', 'bottleneck', 'agent_move', 'invest_payback', 'crisis', 'param_origin', 'rl_gate', 'cash_risk']) {
      expect(getTemplate(id).id).toBe(id)
    }
    expect(getTemplate('nope')).toBe(CUSTOM_TEMPLATE)
  })

  it('orders templates by screen and applies the focused node only where allowed', () => {
    expect(templatesFor('agents')[0].id).toBe('agent_move')
    expect(templatesFor('agents')).toHaveLength(TEMPLATES.length)
    expect(askedNodeFor(getTemplate('param_origin'), 'crit.cash.f.cfar')).toBe('crit.cash.f.cfar')
    expect(askedNodeFor(getTemplate('rl_gate'), 'crit.cash.f.cfar')).toBe('ag.rl')
    expect(askedNodeFor(getTemplate('param_origin'), null)).toBe('crit.profit.alpha')
  })

  it('picks a template for a node asked about from the map', () => {
    expect(templateForFocus('dec.schedule.f.bottleneck', 'formula')).toBe('bottleneck')
    expect(templateForFocus('crit.cash.l_min', 'parameter')).toBe('param_origin')
    expect(templateForFocus('crit.cash.f.cfar', 'formula')).toBe('custom')
    expect(askedNodeFor(getTemplate(templateForFocus('crit.cash.f.cfar', 'formula')), 'crit.cash.f.cfar')).toBe('crit.cash.f.cfar')
  })

  it('lists the calculations a template still needs', () => {
    const none = { opt: false, plan: false, cash: false, rl: false, invest: false, compare: false }
    expect(missingNeeds(getTemplate('compare_runs'), { ...none, opt: true })).toEqual(['compare'])
    expect(missingNeeds(getTemplate('param_origin'), none)).toEqual([])
  })
})

describe('few-shot examples', () => {
  it('use real graph ids and pass the same faithfulness check as model answers', () => {
    for (const ex of FEW_SHOTS) {
      for (const n of ex.context.nodes) expect(getNode(n.mapNode), `${ex.id}:${n.id}`).toBeDefined()
      const r = verifyAnswer(ex.answer, ex.context)
      expect(r.pass, ex.id).toBe(true)
      expect(r.counts.verified + r.counts.cited, ex.id).toBeGreaterThan(0)
    }
  })
})

describe('buildPrompt', () => {
  it('assembles system → labelled examples → task + context + question', () => {
    const p = buildPrompt({ template: getTemplate('cvar_driver'), question: '', context: ctx() })
    expect(p.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT })
    expect(p.messages).toHaveLength(2 + FEW_SHOTS.length * 2)
    expect(p.messages[1].content).toContain('ПРИМЕР ФОРМАТА')
    const last = p.messages[p.messages.length - 1]
    expect(last.role).toBe('user')
    expect(last.content).toContain('УЗЕЛ ВОПРОСА: crit.profit.f.cvar')
    expect(last.content).toContain('"id": "crit.profit.risk_contrib"')
    expect(last.content).toContain(`ВОПРОС: ${getTemplate('cvar_driver').question}`)
    expect(p.version).toBe(`${SYSTEM_PROMPT_VERSION}+cvar_driver@1.0+mentat-ctx/1`)
    expect(p.tokens).toBeGreaterThan(500)
  })

  it('is deterministic, can drop examples and renders the exact text for «Показать промпт»', () => {
    const a = buildPrompt({ template: getTemplate('custom'), question: 'Почему CVaR отрицательный?', context: ctx(), withExamples: false })
    const b = buildPrompt({ template: getTemplate('custom'), question: 'Почему CVaR отрицательный?', context: ctx(), withExamples: false })
    expect(a).toEqual(b)
    expect(a.messages).toHaveLength(2)
    const text = renderPrompt(a)
    expect(text).toContain('## SYSTEM')
    expect(text).toContain('## USER')
    expect(text).toContain('Почему CVaR отрицательный?')
    expect(text).not.toContain('53312000')
  })
})
