import { describe, expect, it } from 'vitest'
import { buildContext } from '../context'
import { optFixture, planFixture, rlFixture, stateFixture } from '../mentatFixtures'
import { parseNumbers, splitClaims, verifyAnswer } from './index'

const ctx = buildContext({ state: stateFixture(), opt: optFixture(), plan: planFixture(), rl: rlFixture(), asked: 'crit.profit.f.cvar', budgetTokens: 20_000 })
const planCtx = buildContext({ state: stateFixture(), opt: optFixture(), plan: planFixture(), rl: rlFixture(), asked: 'crit.schedule', budgetTokens: 20_000 })

describe('parseNumbers', () => {
  it('reads interface formats: groups, decimal comma, minus, orders, units', () => {
    const [a, b, c, d] = parseNumbers('Cmax 1 263 ч, CVaR −53,3 млн ₽, α 10 %, ставка 16,5 п. п.')
    expect(a).toMatchObject({ value: 1263, unit: 'hours', decimals: 0 })
    expect(b).toMatchObject({ value: -53.3e6, unit: 'money', decimals: 1, scale: 1e6, sign: '-' })
    expect(c).toMatchObject({ value: 10, unit: 'percent' })
    expect(d).toMatchObject({ value: 16.5, unit: 'percent', unitText: 'п. п.' })
    expect(parseNumbers('ДИ [+1,01; +1,92] %').map((n) => n.value)).toEqual([1.01, 1.92])
    expect(parseNumbers('1 234 567 ₽')[0]).toMatchObject({ value: 1_234_567, unit: 'money' })
    expect(parseNumbers('1,85 тыс. ₽')[0]).toMatchObject({ value: 1850, scale: 1e3 })
  })

  it('ignores digits inside designations and treats a range dash as a separator', () => {
    expect(parseNumbers('станок 16К20 и x2')).toEqual([])
    expect(parseNumbers('10–15 ч').map((n) => n.value)).toEqual([10, 15])
  })
})

describe('splitClaims', () => {
  it('splits sentences, strips bullets, attaches trailing citations to the previous claim', () => {
    const claims = splitClaims('**Вывод:** CVaR −53,3 млн ₽ ⟦node:crit.profit.f.cvar⟧. ⟦node:crit.profit⟧ Хвост определяет α.\n- 1,2 тыс. ₽ — цена часа ⟦node:dec.portfolio.duals⟧.')
    expect(claims.map((c) => c.citations)).toEqual([['crit.profit.f.cvar', 'crit.profit'], [], ['dec.portfolio.duals']])
    expect(claims[0].text).toBe('Вывод: CVaR −53,3 млн ₽.')
    expect(claims[2].numbers[0].value).toBe(1200)
  })
})

describe('verifyAnswer', () => {
  it('passes a faithful answer: numbers copied from cited nodes, format rounding tolerated', () => {
    const good = [
      'Вывод: CVaR прибыли робастного портфеля равен −53,3 млн ₽ при α = 10 % ⟦node:crit.profit.f.cvar⟧.',
      'Почему: больше всего дисперсии прибыли даёт первое изделие, 58 % ⟦node:crit.profit.risk_contrib⟧.',
      'Мощность токарного типа связывает решение, двойственная цена 1,85 тыс. ₽ ⟦node:dec.portfolio.duals⟧.',
      'Что проверить: уровень хвоста α ⟦node:crit.profit.alpha⟧.',
      'Сценариев 3000, это расчёт Монте-Карло ⟦node:crit.profit.f.cvar⟧.',
    ].join('\n')
    const r = verifyAnswer(good, ctx)
    expect(r.pass).toBe(true)
    expect(r.counts.verified).toBe(4)
    expect(r.counts.cited).toBe(1)
    expect(r.claims[0].numbers.map((n) => n.match?.key)).toEqual(['cvar', 'alpha'])
  })

  it('flags a wrong number, an uncited number and an unknown node', () => {
    const bad = [
      'CVaR прибыли равен −54,9 млн ₽ ⟦node:crit.profit.f.cvar⟧.',
      'Ожидаемая прибыль 41,2 млн ₽.',
      'Цена риска 3 млн ₽ ⟦node:crit.profit.secret⟧.',
      'В контексте нет данных о курсе.',
    ].join('\n')
    const r = verifyAnswer(bad, ctx)
    expect(r.claims.map((c) => c.verdict)).toEqual(['mismatch', 'uncited', 'unknown_node', 'free'])
    expect(r.claims[2].unknown).toEqual(['crit.profit.secret'])
    expect(r.pass).toBe(false)
  })

  it('a number is checked only against the nodes cited by the same claim', () => {
    // 1 263 ч есть в плане (dec.schedule.f.makespan), но утверждение ссылается на CVaR
    const r = verifyAnswer('Длительность плана 1 263 ч ⟦node:crit.schedule⟧.', planCtx)
    expect(r.claims[0].verdict).toBe('mismatch')
    const ok = verifyAnswer('E[Cmax] плана 1 263 ч ⟦node:dec.schedule.f.makespan⟧.', planCtx)
    expect(ok.claims[0].verdict).toBe('verified')
  })

  it('matches by modulus when no sign is written; an explicit wrong sign is a mismatch', () => {
    const abs = verifyAnswer('Убыток в хвосте 53,3 млн ₽ ⟦node:crit.profit.f.cvar⟧.', ctx)
    expect(abs.claims[0].numbers[0].match).toMatchObject({ key: 'cvar', absOnly: true })
    expect(verifyAnswer('CVaR +53,3 млн ₽ ⟦node:crit.profit.f.cvar⟧.', ctx).claims[0].verdict).toBe('mismatch')
  })

  it('accepts percentage-point CIs of the RL gate and text values with numbers', () => {
    const rlCtx = buildContext({ state: stateFixture(), rl: rlFixture(), asked: 'ag.rl.gate' })
    const r = verifyAnswer('Гейт не пройден: выигрыш к лучшему правилу [+1,01; +1,92] % ⟦node:ag.rl.gate⟧, а к «эвристика + гасить кредит» ДИ [0; +0,02] % ⟦node:ag.rl.gate⟧.', rlCtx)
    expect(r.pass).toBe(true)
  })
})
