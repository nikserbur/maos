/**
 * Инвестпроекты (P-111, P-118): докупка оборудования, по умолчанию — для узкого места (первая строка
 * ранжира; `?wc=` в адресе — выбор пользователя). Ставка дисконта — ключевая + спред из финпараметров
 * проекта с бейджем происхождения паспорта; цена станка — в млн ₽. Результат — вердикт движка по
 * сценариям (InvestResult), детерминированная оценка свёрнута. Прогресс — по прогонам, с «Отменить».
 */
import { useRef, useState } from 'react'
import { api, type InvestmentResult, type WorkCenterType } from '../../lib/api'
import { ParamField } from '../../ui/ParamField'
import { RunProgress, type RunPhase } from '../../ui/RunProgress'
import { EmptyState, ErrorBanner } from '../../ui/kit'
import { num, pct } from '../../explain/format'
import { usePassport } from '../passport/passportStore'
import type { TypeLoad } from './analyticsModel'
import { chosenCandidate } from './investModel'
import { publishInvest } from './investStore'
import { DeterministicEstimate, InvestCandidates, InvestVerdictCard } from './InvestResult'

const SAMPLES = 500
const MLN = 1e6
const DEFAULT_RATE_PCT = 18
const ETA_SECONDS = 25

const phases = (n: number): RunPhase[] => [
  { id: 'base', title: 'Прогон 1 из 2: портфель без докупки', weight: 0.35, mapNode: 'dec.portfolio' },
  { id: 'plus', title: `Прогон 2 из 2: портфель с +${num(n, 0)} станк.`, weight: 0.35, mapNode: 'dec.portfolio' },
  { id: 'crn', title: 'Вердикт по сценариям: кандидаты на отбирающем и отложенном наборах', weight: 0.3, mapNode: 'dec.invest' },
]

interface InvestPanelProps {
  wcTypes: ReadonlyArray<WorkCenterType>
  /** Ранжир загрузки: первая строка — узкое место (тип по умолчанию). */
  loads: ReadonlyArray<TypeLoad>
  /** Тип из адреса (`?wc=`): «Инвестпроект» у узкого места или выбор в форме. */
  preselect: string
  nameOfType: (id: string) => string
  onType: (wcTypeId: string) => void
}

export function InvestPanel({ wcTypes, loads, preselect, nameOfType, onType }: InvestPanelProps) {
  const passport = usePassport()
  const wct = preselect || loads[0]?.typeId || wcTypes[0]?.id || ''
  const [addN, setAddN] = useState(2)
  const [capexM, setCapexM] = useState(2.5)
  const [discEdit, setDiscEdit] = useState<number | null>(null)
  const [life, setLife] = useState(60)
  const [demand, setDemand] = useState(1)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<InvestmentResult | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [cancelled, setCancelled] = useState(false)
  const runId = useRef(0)

  const fin = passport.fin
  const discDefault = fin ? (fin.key_rate + fin.spread) * 100 : DEFAULT_RATE_PCT
  const disc = discEdit ?? discDefault
  const rateStatus = fin ? passport.byCode['fin.key_rate']?.status ?? 'НОРМ' : undefined
  const rateOwner = fin ? `ключевая ${pct(fin.key_rate, 0)} + спред ${pct(fin.spread, 0)} · финпараметры проекта` : 'финпараметры не прочитаны — значение по умолчанию'

  const run = async () => {
    if (!wct) { setErr(new Error('Выберите тип оборудования')); return }
    const id = ++runId.current
    setRunning(true); setErr(null); setCancelled(false)
    try {
      const r = await api.analytics.investment({
        wc_type_id: wct, add_machines: Math.max(1, Math.round(addN)),
        machine_capex: Math.max(0, capexM * MLN), discount_rate: disc / 100,
        life_months: Math.max(1, Math.round(life)), demand: Math.max(0.1, demand), samples: SAMPLES,
      })
      if (id !== runId.current) return
      setResult(r)
      publishInvest(r) // MENTAT объясняет уже посчитанный проект
    } catch (e) {
      if (id === runId.current) setErr(e)
    } finally {
      if (id === runId.current) setRunning(false)
    }
  }
  const cancel = () => { runId.current += 1; setRunning(false); setCancelled(true) }

  const load = loads.find((l) => l.typeId === wct)
  const chosen = result ? chosenCandidate(result.crn, result.wc_type_id) : null
  return (
    <>
      <div className="dk-bento an-invest">
        <section className="dk-card dk-span-5 dk-stack" aria-label="Параметры инвестпроекта">
          <div className="dk-card__head">
            <h2 className="dk-card__title">Докупка оборудования</h2>
          </div>
          <div className="an-form">
            <ParamField label="Тип оборудования" value={null} size="md">
              <select className="dk-select" value={wct} onChange={(e) => onType(e.target.value)} aria-label="Тип оборудования">
                {wcTypes.map((t) => {
                  const l = loads.find((x) => x.typeId === t.id)
                  const tail = l ? ` · загрузка ${pct(l.utilization, 0)}${l === loads[0] ? ' · узкое место' : ''}` : ''
                  return <option key={t.id} value={t.id}>{t.name}{tail}</option>
                })}
              </select>
            </ParamField>
            <ParamField label="Докупить" unit="шт" value={addN} min={1} max={50} step={1} onChange={setAddN} size="md" />
            <ParamField label="Цена станка" unit="млн ₽" value={capexM} min={0} step={0.1} onChange={setCapexM} size="md" info="invest.capex"
              infoValues={{ n: addN, price: capexM * MLN, capex: addN * capexM * MLN }} />
            <ParamField label="Ставка дисконта" unit="% в год" value={disc} min={0} max={60} step={0.5} range={[5, 40]} size="md"
              status={rateStatus} owner={rateOwner} changed={discEdit !== null && discEdit !== discDefault}
              onRevert={() => setDiscEdit(null)} onChange={setDiscEdit} />
            <ParamField label="Срок службы" unit="мес" value={life} min={1} step={12} range={[12, 240]} onChange={setLife} size="md" />
            <ParamField label="Множитель спроса" unit="×" value={demand} min={0.1} step={0.5} range={[0.5, 3]} onChange={setDemand} size="md"
              hint="Сценарный множитель годового спроса (стресс рынка): 1 — как в сценарии." />
          </div>
          <p className="an-form__defaults"><span className="mm-glyph mm-glyph--default" aria-hidden="true" /> Остальные значения — по умолчанию; ставка — из финпараметров проекта.</p>
          {load && (
            <p className="an-note">
              Сейчас «{load.name}»: {num(load.machines, 0)} станк., загрузка {pct(load.utilization, 0)}
              {load.laborBound && <> — операторов лишь {num(load.operators, 0)}, докупка станков без операторов не поможет</>}.
            </p>
          )}
          {err ? <ErrorBanner error={err} onDismiss={() => setErr(null)} onRetry={run} /> : null}
          {cancelled && !running && <p className="an-muted">Расчёт отменён — сервер может досчитать в фоне, но результат не будет показан.</p>}
          <div className="an-form__cta">
            {running ? (
              <div className="an-run">
                <RunProgress phases={phases(addN)} running etaSeconds={ETA_SECONDS} title="Инвестпроект" />
                <button type="button" className="btn btn--sm" onClick={cancel}>Отменить</button>
              </div>
            ) : (
              <button type="button" className="btn btn--primary" onClick={run}>Рассчитать инвестпроект</button>
            )}
          </div>
        </section>

        <div className="dk-span-7">
          {result
            ? <InvestVerdictCard r={result} chosen={chosen} nameOfType={nameOfType} />
            : (
              <EmptyState title="Здесь появится вердикт: применять или нет" quiet size="sm" variant="chart">
                ЧДД с 95 %-ДИ по сценариям, частота убытка и сдвиг частоты разрыва кассы к базе — для выбранного типа.
              </EmptyState>
            )}
        </div>
      </div>
      {result?.crn?.status === 'ok' && <InvestCandidates crn={result.crn} chosen={chosen} nameOfType={nameOfType} />}
      {result && <DeterministicEstimate r={result} name={nameOfType(result.wc_type_id)} />}
    </>
  )
}
