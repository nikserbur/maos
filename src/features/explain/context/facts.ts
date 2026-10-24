/**
 * «Факты» контекста MENTAT — то, чего нет в формулах карты, но что уже посчитано и лежит в ответах API:
 * вклады изделий в риск (Стадия 2), двойственные цены мощности и ликвидности (LP), гейт и ходы агента RL,
 * CRN-оценка инвестпроекта, режим генератора в прогоне. Каждый факт — узел с id `<узел карты>.<суффикс>`,
 * чтобы ссылка ⟦node:…⟧ вела на карту. Только пересказ готовых чисел — ничего не досчитывается.
 */
import type { CashLpResult, InvestmentResult, MacroStress, RlStatus, ScheduleResult } from '../../../lib/api'
import type { OptResultExt } from '../../optimization/optTypes'
import { isSoft } from '../../optimization/optTypes'
import type { BlockId } from '../../method-map/types'
import { moveLabel } from '../../plan/moves/moveKinds'
import type { CtxNode, CtxValue } from './types'
import { compactValues, ctxValue } from './values'

/** Факт без расстояния — его назначает сборщик по узлу карты. */
export type FactNode = Omit<CtxNode, 'distance'>

export interface FactSources {
  opt?: OptResultExt | null
  plan?: ScheduleResult | null
  cash?: CashLpResult | null
  rl?: RlStatus | null
  invest?: InvestmentResult | null
  /** id изделия → наименование (для подписей вкладов). */
  productNames?: Readonly<Record<string, string>>
}

/** Сколько строк факта брать (вклады, двойственные, ходы, кандидаты) — компактность контекста. */
export const TOP_N = 5

function fact(id: string, title: string, block: BlockId, mapNode: string, values: CtxValue[], note?: string): FactNode | null {
  if (!values.length) return null
  return { id, title, kind: 'fact', block, mapNode, parent: mapNode, status: 'расчёт', values, ...(note ? { note } : {}) }
}

function riskContrib(opt: OptResultExt | null | undefined, names: Readonly<Record<string, string>>): FactNode | null {
  if (!opt || isSoft(opt)) return null
  const items = [...opt.robust.items].sort((a, b) => Math.abs(b.risk_contribution) - Math.abs(a.risk_contribution) || a.product_id.localeCompare(b.product_id)).slice(0, TOP_N)
  const values = items.flatMap((it, i) => {
    const name = names[it.product_id] ?? it.product_id
    return compactValues([
      ctxValue(`risk_${i + 1}`, `Доля в дисперсии прибыли (вклад в риск): ${name}`, it.risk_contribution, '%'),
      ctxValue(`contrib_${i + 1}`, `Вклад в ожидаемую прибыль: ${name}`, it.contribution, '₽'),
      ctxValue(`qty_${i + 1}`, `Объём выпуска: ${name}`, it.qty, 'шт'),
    ])
  })
  return fact('crit.profit.risk_contrib', 'Вклады изделий робастного портфеля в риск и прибыль', 'criteria', 'crit.profit', values,
    'Вклад в риск — доля изделия в дисперсии прибыли портфеля, cov(Πₛ, Π)/var(Π), сумма по изделиям 100 %; это разложение σ, а не CVaR. Первые по модулю.')
}

function capacityDuals(opt: OptResultExt | null | undefined, cash: CashLpResult | null | undefined): FactNode | null {
  const fromOpt = opt?.exact?.duals ?? []
  const rows = fromOpt.length
    ? fromOpt.map((d) => ({ wc: d.wc_type, price: d.shadow_price, util: d.utilization, binding: d.binding }))
    : (cash?.duals?.capacity ?? []).map((d) => ({ wc: d.wc_type, price: d.shadow_price, util: d.utilization, binding: d.binding }))
  const top = [...rows].sort((a, b) => Math.abs(b.price) - Math.abs(a.price) || a.wc.localeCompare(b.wc)).slice(0, TOP_N)
  const values = top.flatMap((d, i) => compactValues([
    ctxValue(`dual_${i + 1}`, `Двойственная цена фонда, ₽ за час: ${d.wc}`, d.price, '₽'),
    ctxValue(`util_${i + 1}`, `Загрузка фонда: ${d.wc}`, d.util, '%'),
    d.binding === undefined ? null : ctxValue(`binding_${i + 1}`, `Ограничение активно: ${d.wc}`, d.binding),
  ]))
  return fact('dec.portfolio.duals', 'Двойственные цены мощности (LP)', 'decisions', 'dec.portfolio', values,
    fromOpt.length ? 'Точное решение CVaR-LP (HiGHS) Стадии 2.' : 'CVaR-LP с кассой.')
}

function cashDuals(cash: CashLpResult | null | undefined): FactNode | null {
  // Касса не решена (time_limit, infeasible) — двойственных нет, факта тоже нет.
  if (!cash?.duals) return null
  const d = cash.duals
  return fact('dec.cash.duals', 'Двойственные оценки кассового LP', 'decisions', 'dec.cash', compactValues([
    ctxValue('liq_dual', 'Двойственная оценка ограничения ликвидности (безразмерная)', d.liquidity),
    ctxValue('liq_binding', 'Ограничение ликвидности активно', d.liquidity_binding),
    ctxValue('pol_local', 'Локальная цена ликвидности (двойственная)', d.price_of_liquidity_local),
    ctxValue('credit_limit', 'Лимит кредитной линии', d.credit_limit, '₽'),
    ctxValue('l_min', 'Требуемый минимум кассы L_min', cash.l_min, '₽'),
    ctxValue('beta', 'β хвоста кассы', cash.beta, '%'),
  ]))
}

/** Гейт RL — то же поле `gate_a3` статуса (useRlStatus), что читает экран «Агенты». */
function rlGate(rl: RlStatus | null | undefined): FactNode | null {
  if (!rl) return null
  const g = rl.gate_a3
  const pp = g?.units ?? '% стоимости портфеля'
  const ci = (key: string, label: string, pair: [number, number] | null | undefined) => pair
    ? [ctxValue(`${key}_lo`, `${label}: нижняя граница 95 %-ДИ`, pair[0], pp), ctxValue(`${key}_hi`, `${label}: верхняя граница 95 %-ДИ`, pair[1], pp)]
    : []
  return fact('ag.rl.gate', 'Гейт политики RL и чемпион', 'agents', 'ag.rl', compactValues([
    ctxValue('available', 'Правило «RL» доступно в продукте', rl.available && rl.onnxruntime && rl.l0.ok),
    g ? ctxValue('gate_pass', 'Гейт пройден', g.gate_pass) : null,
    g ? ctxValue('gate_g1', 'Гейт G1 (против лучшего правила) пройден', g.gate_g1) : null,
    g?.gate_g2_prereg === undefined ? null : ctxValue('gate_g2', 'Гейт G2 (предрегистрация) пройден', g.gate_g2_prereg),
    g ? ctxValue('champion', 'Чемпион', g.champion === 'rl_l3' ? 'политика RL' : 'лучшее правило (не RL)') : null,
    ...ci('vs_rule', 'Выигрыш RL к лучшему правилу', g?.ci95_vs_best_rule),
    ...ci('vs_champ', 'Выигрыш RL к чемпиону', g?.ci95_vs_champion),
    ...ci('vs_plus', 'Выигрыш RL к «эвристика + гасить кредит излишком кассы»', g?.ci95_vs_champion_plus),
  ]), g?.source ? `Источник гейта: ${g.source}` : rl.note || undefined)
}

function rlMoves(plan: ScheduleResult | null | undefined): FactNode[] {
  const moves = plan?.moves?.moves ?? []
  return moves.slice(0, TOP_N).map((m, i) => fact(`ag.rl.move.${i + 1}`, `Ход агента ${i + 1}: ${moveLabel(m.kind)}`, 'agents', 'ag.rl', compactValues([
    ctxValue('kind', 'Вид хода', moveLabel(m.kind)),
    ctxValue('status', 'Статус', m.status),
    ctxValue('level', 'Уровень агента', m.agent.level),
    ctxValue('cvar_before', 'CVaR прибыли до хода', m.impact.profit.cvar_before, '₽'),
    ctxValue('cvar_after', 'CVaR прибыли после хода', m.impact.profit.cvar_after, '₽'),
    ctxValue('e_before', 'E[прибыли] до хода', m.impact.profit.e_before, '₽'),
    ctxValue('e_after', 'E[прибыли] после хода', m.impact.profit.e_after, '₽'),
    ctxValue('p_gap_before', 'P(кассового разрыва) до хода', m.impact.cash.p_gap_before, '%'),
    ctxValue('p_gap_after', 'P(кассового разрыва) после хода', m.impact.cash.p_gap_after, '%'),
    ctxValue('win_share', 'Доля сценариев, где ход лучше (CRN)', m.impact.win_share, '%'),
    ctxValue('ci_lo', 'Выигрыш CVaR: нижняя граница 95 %-ДИ', m.impact.ci95[0], '₽'),
    ctxValue('ci_hi', 'Выигрыш CVaR: верхняя граница 95 %-ДИ', m.impact.ci95[1], '₽'),
    ctxValue('regime', 'Режим-обоснование', m.justification.regime.label),
  ]))).filter((f): f is FactNode => f !== null)
}

function invest(inv: InvestmentResult | null | undefined): FactNode[] {
  if (!inv) return []
  const pays = inv.payback_months > 0
  const base = fact('dec.invest.base', 'Инвестпроект: точечная оценка', 'decisions', 'dec.invest', compactValues([
    ctxValue('add', 'Добавляется станков', inv.add_machines, 'шт'),
    ctxValue('capex', 'CAPEX', inv.capex, '₽'),
    ctxValue('npv', 'ЧДД (точечно)', inv.npv, '₽'),
    pays ? ctxValue('payback', 'Срок окупаемости', inv.payback_months, 'мес') : ctxValue('payback', 'Срок окупаемости', 'не окупается за срок жизни'),
    ctxValue('irr', 'IRR годовая', inv.irr_annual, '%'),
    ctxValue('util_before', 'Загрузка узкого места до', inv.util_before, '%'),
    ctxValue('util_after', 'Загрузка узкого места после', inv.util_after, '%'),
    ctxValue('next', 'Следующее узкое место', inv.next_bottleneck.wc_name),
  ]))
  const cands = (inv.crn?.candidates ?? []).slice(0, TOP_N).map((c, i) => fact(`dec.invest.cand.${i + 1}`, `Кандидат L3 ${i + 1}: ${c.cand.kind === 'machine' ? 'станок' : 'модернизация'} ${c.cand.wc_type}`, 'decisions', 'dec.invest', compactValues([
    ctxValue('apply', 'Вердикт «внедрить» (на отложенных сценариях)', c.apply),
    ctxValue('capex', 'CAPEX', c.cand.capex, '₽'),
    ctxValue('npv_mean', 'E[ЧДД]', c.npv_mean, '₽'),
    ctxValue('npv_lo', 'ЧДД: нижняя граница 95 %-ДИ', c.npv_ci95[0], '₽'),
    ctxValue('npv_hi', 'ЧДД: верхняя граница 95 %-ДИ', c.npv_ci95[1], '₽'),
    ctxValue('p_npv_neg', 'P(ЧДД < 0)', c.p_npv_neg, '%'),
    ctxValue('p_gap', 'P(кассового разрыва) с проектом', c.p_cash_gap, '%'),
    ctxValue('p_gap_base', 'P(кассового разрыва) без проекта', c.p_cash_gap_base, '%'),
    c.payback_months === null ? ctxValue('payback', 'Дисконтированный срок окупаемости', 'не окупается на горизонте') : ctxValue('payback', 'Дисконтированный срок окупаемости', c.payback_months, 'мес'),
    ctxValue('n', 'Сценариев в оценке', c.n),
  ]), c.reasons.length ? `Причины вердикта: ${c.reasons.join('; ')}` : undefined)).filter((f): f is FactNode => f !== null)
  return [...(base ? [base] : []), ...cands]
}

const MACRO_MODE: Readonly<Record<string, string>> = {
  base: 'базовый (прогноз)', regime: 'навязанный режим', quantile: 'квантильный стресс', episode: 'исторический эпизод', iid_v063: 'i.i.d.-цены v0.63',
}

function stressText(s: MacroStress | undefined): string {
  if (!s) return ''
  if ('regime' in s) return `режим ${s.regime} навязан на весь горизонт`
  if ('quantile_t' in s) return `квантильный стресс Student-t, квантиль ${s.quantile_t}`
  return `исторический эпизод ${s.episode}${s.months ? `, ${s.months} мес` : ''}`
}

function macroRun(opt: OptResultExt | null | undefined): FactNode | null {
  const m = opt?.macro
  if (!m) return null
  const stress = stressText(m.stress)
  return fact('ext.regimes.run', 'Режим макро-генератора в прогоне портфеля', 'external', 'ext.regimes', compactValues([
    ctxValue('on', 'Генератор включён', m.available && m.on),
    ctxValue('mode', 'Режим', MACRO_MODE[m.mode] ?? m.mode),
    stress ? ctxValue('stress', 'Стресс (как задан)', stress) : null,
    ...m.regime_share.map((s, i) => ctxValue(`share_${i}`, `Доля месяцев в режиме ${i}`, s, '%')),
  ]))
}

/**
 * Построитель факта под предохранителем: неполный ответ API (касса без duals, план без ходов) даёт
 * «нет факта» и одно предупреждение в консоли, а не падение панели MENTAT.
 */
function safe<T>(name: string, build: () => T, fallback: T): T {
  try {
    return build()
  } catch (e) {
    console.warn(`MENTAT: факт «${name}» пропущен —`, e)
    return fallback
  }
}

/** Все факты в детерминированном порядке. */
export function buildFacts(src: FactSources): FactNode[] {
  const names = src.productNames ?? {}
  const list = [
    safe('вклады в риск', () => riskContrib(src.opt, names), null),
    safe('двойственные мощности', () => capacityDuals(src.opt, src.cash), null),
    safe('двойственные кассы', () => cashDuals(src.cash), null),
    safe('гейт RL', () => rlGate(src.rl), null),
    ...safe('ходы агента', () => rlMoves(src.plan), []),
    ...safe('инвестпроект', () => invest(src.invest), []),
    safe('режим генератора', () => macroRun(src.opt), null),
  ]
  return list.filter((f): f is FactNode => f !== null)
}
