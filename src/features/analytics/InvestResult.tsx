/**
 * Результат инвестпроекта (P-111): вердикт движка по блоку `crn` — «применять / не применять» и
 * первая причина; герой «ЧДД · E» с 95 %-ДИ и N на полосе, где виден ноль; частота убытка и сдвиг
 * частоты разрыва кассы к базе; строка «проиграет, если…». Ниже — таблица всех кандидатов и
 * «ничего не делать» с теми же метриками (оцениваемый — ▲). Детерминированные ЧДД/ВНД/срок —
 * свёрнуты. Нет вероятностной оценки — причина простыми словами. Ничего не применяется само.
 */
import type { InvestCrn, InvestCrnCandidate, InvestmentResult } from '../../lib/api'
import { InfoTip } from '../../ui/InfoTip'
import { RangeStrip, type RangeMark } from '../../ui/charts'
import { Chip, DataTable, ErrorBanner, KpiTile, Section, type DataColumn } from '../../ui/kit'
import { DASH, money, num, pct, rangeText } from '../../explain/format'
import { ruleLabel } from '../../explain/labels'
import {
  candidateLabel, ciText, crnNotice, freqScenarios, freqShort, gapShiftText, investRows, loseIfText, verdictLine, type InvestRow,
} from './investModel'

const MONTHS_IN_YEAR = 12

/* ── Карточка вердикта ─────────────────────────────────────────────────────── */

interface VerdictCardProps {
  r: InvestmentResult
  chosen: InvestCrnCandidate | null
  nameOfType: (id: string) => string
}

export function InvestVerdictCard({ r, chosen, nameOfType }: VerdictCardProps) {
  const notice = crnNotice(r.crn)
  const title = chosen ? candidateLabel(chosen, nameOfType) : `${nameOfType(r.wc_type_id)} +${num(r.add_machines, 0)} станк.`
  return (
    <section className="dk-card an-result" aria-label="Вердикт инвестпроекта">
      <div className="dk-card__head">
        <h2 className="dk-card__title">{title}</h2>
        {chosen && <Chip title="вердикт движка по отложенным сценариям; применяет человек">{verdictLine(chosen).word}</Chip>}
      </div>
      {chosen && r.crn ? <CrnHero c={chosen} crn={r.crn} /> : notice && (
        <ErrorBanner tone="setup" title={notice.title} message={notice.text} detail={notice.detail} />
      )}
      <p className="an-muted an-result__foot">Ничего не применяется автоматически: решение о закупке принимает человек.</p>
    </section>
  )
}

function CrnHero({ c, crn }: { c: InvestCrnCandidate; crn: InvestCrn }) {
  const v = verdictLine(c)
  const [lo, hi] = c.npv_ci95
  const span = Math.max(Math.abs(hi - lo), Math.abs(c.npv_mean), 1)
  const domain: [number, number] = [Math.min(lo, 0) - span * 0.08, Math.max(hi, 0) + span * 0.08]
  const marks: RangeMark[] = [
    { key: 'zero', value: 0, label: '0 — безубыточность', glyph: 'ring', tone: 'idle' },
    { key: 'mean', value: c.npv_mean, label: 'E[ЧДД]', glyph: 'dot', tone: 'accent' },
  ]
  const values = { npv: c.npv_mean, r: c.rate_owner, capex: c.cand.capex }
  return (
    <>
      <p className="an-result__verdict"><b>{v.word}</b> — {v.reason}</p>
      <KpiTile metric="invest.npv" values={values} label="ЧДД · E" value={money(c.npv_mean)} size="hero" interval={ciText(c)}>
        <RangeStrip marks={marks} fmt={(x) => money(x)} zone={[lo, hi]} zoneKind="ci" zoneLabel="95 %-ДИ E[ЧДД]" domain={domain}
          ariaLabel={`E[ЧДД] ${money(c.npv_mean)}, 95 %-ДИ ${rangeText(lo, hi, '₽')}, ноль отмечен`} />
      </KpiTile>
      <dl className="an-result__list">
        <dt>ЧДД &lt; 0</dt><dd>{freqScenarios(c.p_npv_neg)}</dd>
        <dt>Разрыв кассы <InfoTip id="cash.p_breach" values={{ p: c.p_cash_gap, ci_lo: c.p_cash_gap_ci95[0], ci_hi: c.p_cash_gap_ci95[1] }} /></dt>
        <dd>{gapShiftText(c)}</dd>
        <dt>Окупаемость</dt>
        <dd>{c.payback_months !== null && Number.isFinite(c.payback_months) ? `${num(c.payback_months, 1)} мес` : 'за горизонт оценки не окупается'}</dd>
        <dt>Ставка собственника</dt><dd>{pct(c.rate_owner, 0)} в год · горизонт {num(c.horizon_weeks, 0)} нед</dd>
      </dl>
      <p className="an-result__lose">{loseIfText(c, crn.params?.alpha)}</p>
    </>
  )
}

/* ── Все кандидаты + «ничего не делать» ─────────────────────────────────────── */

const verdictWord = (r: InvestRow) => (r.apply === null ? 'база' : r.apply ? 'применять' : 'не применять')

const COLUMNS: DataColumn<InvestRow>[] = [
  { key: 'label', title: 'Вариант', rowHeader: true, get: (r) => r.label,
    render: (r) => (
      <span className="an-cand">
        {r.chosen && <span className="an-chosen" role="img" aria-label="оцениваемый вариант" title="оцениваемый вариант" />}
        <span>{r.label}<span className="an-cand__src">{r.source}</span></span>
      </span>
    ) },
  { key: 'capex', title: 'CAPEX', num: true, get: (r) => r.capex, render: (r) => money(r.capex) },
  { key: 'npv', title: 'E[ЧДД]', num: true, get: (r) => r.npvMean, render: (r) => (r.baseline ? money(0) : money(r.npvMean)) },
  { key: 'ci', title: '95 %-ДИ', num: true, sortable: false, render: (r) => (r.baseline ? DASH : rangeText(r.npvLo, r.npvHi, '₽')) },
  { key: 'neg', title: 'ЧДД < 0', num: true, get: (r) => r.pNpvNeg, render: (r) => freqShort(r.pNpvNeg) },
  { key: 'gap', title: 'Разрыв кассы', num: true, get: (r) => r.pGap, render: (r) => freqShort(r.pGap) },
  { key: 'cash', title: 'CVaR мин. кассы', num: true, get: (r) => r.cashMinCvar, render: (r) => money(r.cashMinCvar) },
  { key: 'verdict', title: 'Вердикт', get: (r) => verdictWord(r), render: (r) => <span title={r.reason ?? undefined}>{verdictWord(r)}</span> },
]

export function InvestCandidates({ crn, chosen, nameOfType }: { crn: InvestCrn; chosen: InvestCrnCandidate | null; nameOfType: (id: string) => string }) {
  const rows = investRows(crn, chosen, nameOfType)
  if (rows.length === 0) return null
  const n = chosen?.n ?? crn.n_scenarios
  return (
    <Section id="an-invest-cands" title={<>Все кандидаты и «ничего не делать» <InfoTip id="invest.npv" /></>}
      meta={`отложенный набор сценариев · N = ${num(n ?? 0, 0)} · диспетчеризация: ${crn.rule ? ruleLabel(crn.rule) : DASH}`}>
      <div className="dk-card dk-card--flush">
        <DataTable<InvestRow> columns={COLUMNS} rows={rows} rowKey={(r) => r.key} tight
          defaultSort={null} caption="Кандидаты инвестпроекта на одних и тех же сценариях (CRN)" />
      </div>
      {crn.rule_of_apply && <p className="an-muted">Правило применения: {crn.rule_of_apply}.</p>}
    </Section>
  )
}

/* ── Детерминированная оценка (свёрнута) ───────────────────────────────────── */

export function DeterministicEstimate({ r, name }: { r: InvestmentResult; name: string }) {
  const paysBack = r.payback_months > 0
  const rm = (1 + r.discount_annual) ** (1 / MONTHS_IN_YEAR) - 1
  const vals = { capex: r.capex, dcf: r.delta_cf_month, life: r.life_months, r: r.discount_annual, rm, npv: r.npv, irr: r.irr_annual, roi: r.roi }
  return (
    <details className="dk-card an-det">
      <summary>Детерминированная оценка «{name}» +{num(r.add_machines, 0)} станк. · один прогон «до/после» без сценариев</summary>
      <dl className="an-result__list">
        <dt>ЧДД <InfoTip id="invest.npv" values={vals} /></dt><dd>{money(r.npv)} при ставке {pct(r.discount_annual, 0)}</dd>
        <dt>ВНД <InfoTip id="invest.irr" values={vals} /></dt><dd>{paysBack && Number.isFinite(r.irr_annual) ? pct(r.irr_annual, 0) : DASH}</dd>
        <dt>Срок окупаемости <InfoTip id="invest.dpp" values={{ dpp: paysBack ? r.payback_months : null, spp: r.delta_cf_month > 0 ? r.capex / r.delta_cf_month : null }} /></dt>
        <dd>{paysBack ? `${num(r.payback_months, 1)} мес` : 'прирост прибыли ≈ 0 — тип не ограничивает выпуск при этом спросе'}</dd>
        <dt>CAPEX <InfoTip id="invest.capex" values={{ n: r.add_machines, price: r.add_machines > 0 ? r.capex / r.add_machines : null, capex: r.capex }} /></dt>
        <dd>{money(r.capex)}</dd>
        <dt>Прирост прибыли <InfoTip id="invest.delta_cf" values={{ dcf: r.delta_cf_month, p0: r.profit_before, p1: r.profit_after, months: r.plan_months }} /></dt>
        <dd>{money(r.delta_cf_month)}/мес</dd>
        <dt>ROI за срок <InfoTip id="invest.roi" values={vals} /></dt><dd>{pct(r.roi, 0)}</dd>
        <dt>Загрузка типа</dt><dd>{pct(r.util_before, 0)} → {pct(r.util_after, 0)}</dd>
        {r.next_bottleneck.wc_name && (
          <>
            <dt>Ограничение перейдёт к <InfoTip id="invest.next_bottleneck" values={{ name: r.next_bottleneck.wc_name, util: r.next_bottleneck.utilization, before: r.util_before, after: r.util_after }} /></dt>
            <dd>«{r.next_bottleneck.wc_name}» · {pct(r.next_bottleneck.utilization, 0)}</dd>
          </>
        )}
      </dl>
    </details>
  )
}
