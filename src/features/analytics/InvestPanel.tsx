/**
 * Инвестпроекты (X1 §6.3 п. 6): калькулятор докупки станков узкого места. Поля — ParamField
 * с единицами и «i»; результат — карточка «NPV · IRR · срок» рядом с формой (bento), вердикт —
 * чип с глифом, числа всегда `--text` и только через format.ts.
 */
import { useEffect, useState } from 'react'
import { api, type InvestmentResult, type WorkCenterType } from '../../lib/api'
import { InfoTip } from '../../ui/InfoTip'
import { ParamField } from '../../ui/ParamField'
import { Chip, EmptyState, ErrorBanner, errorText } from '../../ui/kit'
import { money, num, pct } from '../../explain/format'
import type { TypeLoad } from './analyticsModel'
import { publishInvest } from './investStore'

const SAMPLES = 500
const MONTHS_IN_YEAR = 12

interface InvestPanelProps {
  wcTypes: ReadonlyArray<WorkCenterType>
  loads: ReadonlyArray<TypeLoad>
  /** Тип РЦ, выбранный на других вкладках («Инвестпроект» у узкого места). */
  preselect: string
  nameOfType: (id: string) => string
}

export function InvestPanel({ wcTypes, loads, preselect, nameOfType }: InvestPanelProps) {
  const [wct, setWct] = useState(preselect || wcTypes[0]?.id || '')
  const [addN, setAddN] = useState(2)
  const [capex, setCapex] = useState(2_500_000)
  const [disc, setDisc] = useState(18)
  const [life, setLife] = useState(60)
  const [demand, setDemand] = useState(1)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<InvestmentResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (preselect) setWct(preselect) }, [preselect])

  const run = async () => {
    if (!wct) { setErr('Выберите тип оборудования'); return }
    setRunning(true); setErr(null); setResult(null)
    try {
      const r = await api.analytics.investment({
        wc_type_id: wct, add_machines: Math.max(1, Math.round(addN)),
        machine_capex: Math.max(0, capex), discount_rate: disc / 100,
        life_months: Math.max(1, Math.round(life)), demand: Math.max(0.1, demand), samples: SAMPLES,
      })
      setResult(r)
      publishInvest(r) // MENTAT объясняет уже посчитанный проект
    } catch (e) { setErr(errorText(e, 'Ошибка расчёта инвестпроекта')) } finally { setRunning(false) }
  }

  const load = loads.find((l) => l.typeId === wct)
  return (
    <div className="dk-bento an-invest">
      <section className="dk-card dk-span-7 dk-stack dk-rise" aria-label="Параметры инвестпроекта">
        <div className="dk-card__head">
          <h2 className="dk-card__title">Докупка оборудования</h2>
          <span className="dk-card__meta">узкое место → +N станков → прирост выпуска через рынок → окупаемость</span>
        </div>
        <div className="an-form">
          <ParamField label="Тип оборудования" value={null} size="md">
            <select className="dk-select" value={wct} onChange={(e) => setWct(e.target.value)} aria-label="Тип оборудования">
              {wcTypes.map((t) => {
                const l = loads.find((x) => x.typeId === t.id)
                return <option key={t.id} value={t.id}>{t.name}{l ? ` · загрузка ${pct(l.utilization, 0)}` : ''}</option>
              })}
            </select>
          </ParamField>
          <ParamField label="Докупить" unit="шт" value={addN} min={1} max={50} step={1} onChange={setAddN} size="md" />
          <ParamField label="Цена станка" unit="₽" value={capex} min={0} step={100_000} onChange={setCapex} size="md" info="invest.capex"
            infoValues={{ n: addN, price: capex, capex: addN * capex }} />
          <ParamField label="Ставка дисконта" unit="% в год" value={disc} min={0} max={60} step={1} range={[5, 40]} onChange={setDisc} size="md" />
          <ParamField label="Срок службы" unit="мес" value={life} min={1} step={12} range={[12, 240]} onChange={setLife} size="md" />
          <ParamField label="Множитель спроса" value={demand} min={0.1} step={0.5} range={[0.5, 3]} onChange={setDemand} size="md"
            note="сценарный множитель годового спроса (стресс рынка)" />
        </div>
        {load && (
          <p className="an-note">
            Сейчас «{load.name}»: {num(load.machines, 0)} станк., загрузка <b>{pct(load.utilization, 0)}</b>
            {load.laborBound && <> — операторов лишь {num(load.operators, 0)}, докупка станков без операторов не поможет</>}.
          </p>
        )}
        {err && <ErrorBanner message={err} onDismiss={() => setErr(null)} />}
        <div className="an-form__cta">
          <button type="button" className="btn btn--primary dk-cta" onClick={run} disabled={running}>
            {running ? 'Считаем (2 прогона оптимизатора)…' : 'Рассчитать инвестпроект'}
          </button>
        </div>
      </section>

      <div className="dk-span-5 dk-rise">
        {result
          ? <InvestResult r={result} name={nameOfType(result.wc_type_id)} />
          : <EmptyState title="Результат появится здесь" variant="chart" size="sm">NPV, IRR и срок окупаемости для выбранного типа и числа станков.</EmptyState>}
      </div>
    </div>
  )
}

/* ── Карточка результата: NPV · IRR · срок — герои 24 px, остальное — список ── */
function InvestResult({ r, name }: { r: InvestmentResult; name: string }) {
  const paysBack = r.payback_months > 0
  const rm = (1 + r.discount_annual) ** (1 / MONTHS_IN_YEAR) - 1
  const vals = { capex: r.capex, dcf: r.delta_cf_month, life: r.life_months, r: r.discount_annual, rm, npv: r.npv, irr: r.irr_annual, roi: r.roi }
  return (
    <section className={`dk-card an-result${paysBack ? ' an-result--ok' : ' an-result--bad'}`} aria-label="Результат инвестпроекта">
      <div className="dk-card__head">
        <h2 className="dk-card__title">{name} +{num(r.add_machines, 0)} станк.</h2>
        <Chip tone={paysBack ? 'good' : 'bad'}>{paysBack ? 'окупается' : 'не окупается'}</Chip>
      </div>
      {!paysBack && <p className="an-note">Прирост прибыли ≈ 0 — при этом спросе тип не является ограничением.</p>}
      <div className="an-result__heroes">
        <HeroValue label="NPV" info="invest.npv" values={vals} text={money(r.npv)} />
        <HeroValue label="IRR" info="invest.irr" values={vals} text={paysBack ? pct(r.irr_annual, 0) : '—'} />
        <HeroValue label="Срок" info="invest.dpp" values={{ dpp: paysBack ? r.payback_months : null, spp: r.delta_cf_month > 0 ? r.capex / r.delta_cf_month : null }}
          text={paysBack ? `${num(r.payback_months, 1)} мес` : '—'} />
      </div>
      <dl className="an-result__list">
        <dt>CAPEX <InfoTip id="invest.capex" values={{ n: r.add_machines, price: r.add_machines > 0 ? r.capex / r.add_machines : null, capex: r.capex }} /></dt>
        <dd>{money(r.capex)}</dd>
        <dt>Прирост прибыли <InfoTip id="invest.delta_cf" values={{ dcf: r.delta_cf_month, p0: r.profit_before, p1: r.profit_after, months: r.plan_months }} /></dt>
        <dd>{money(r.delta_cf_month)}/мес</dd>
        <dt>ROI за срок <InfoTip id="invest.roi" values={vals} /></dt>
        <dd>{pct(r.roi, 0)}</dd>
        <dt>Загрузка типа</dt>
        <dd>{pct(r.util_before, 0)} → {pct(r.util_after, 0)}</dd>
        {r.next_bottleneck.wc_name && (
          <>
            <dt>Ограничение перейдёт к <InfoTip id="invest.next_bottleneck" values={{ name: r.next_bottleneck.wc_name, util: r.next_bottleneck.utilization, before: r.util_before, after: r.util_after }} /></dt>
            <dd>{r.next_bottleneck.wc_name} · {pct(r.next_bottleneck.utilization, 0)}{r.next_bottleneck.utilization > 0.9 && <Chip size="sm" tone="setup">следующий кандидат</Chip>}</dd>
          </>
        )}
      </dl>
    </section>
  )
}

function HeroValue({ label, info, values, text }: { label: string; info: string; values: Readonly<Record<string, number | null>>; text: string }) {
  return (
    <div className="an-hero">
      <span className="an-hero__k text-caps">{label}<InfoTip id={info} values={values} /></span>
      <span className="an-hero__v">{text}</span>
    </div>
  )
}
