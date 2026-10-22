/**
 * Панель меню режимов и стрессов (§2.6б; редьюсер — regimeMenu.ts) — вместо ползунков: Базовый (прогноз) · Режим навязан ·
 * Квантильный стресс · Исторический эпизод · опора. Полоса режимов — по `POST /api/macro/sample`
 * (режимы путей по месяцам) с дебаунсом; подпись «прогноз» — только у базового.
 */
import { useEffect, useReducer, useRef, useState } from 'react'
import { api, type MacroRegimes, type MacroSampleResult, type MacroSummary } from '../../lib/api'
import { num, pct } from '../../explain/format'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { RegimeStrip } from '../../ui/RegimeStrip'
import { Chip } from '../plan/ui'
import { DEFAULT_MENU, fromMacroMode, regimeLabel, regimeMenuReducer, toMacroMode, type RegimeKind } from './regimeMenu'
import './scenarios-v2.css'

interface Props {
  /** Поле сценария `macro_mode` (JSON | имя | ''). */
  value: string | undefined
  months: number
  regimes: MacroRegimes | null
  macro: MacroSummary | null
  onChange: (macroModeJson: string) => void
}

const SAMPLE_DEBOUNCE_MS = 500
const KINDS: ReadonlyArray<{ id: RegimeKind; title: string; sub: string; status: string }> = [
  { id: 'base', title: 'Базовый', sub: 'режимы по p_last и P_HMM, эмпирические блоки — прогноз', status: 'О' },
  { id: 'regime', title: 'Режим навязан', sub: 'h_t ≡ h на весь горизонт — стресс', status: 'Н' },
  { id: 'quantile', title: 'Квантильный стресс', sub: 'инновации из Student-t, путь — q-квантиль', status: 'НОРМ' },
  { id: 'episode', title: 'Исторический эпизод', sub: 'блоки из окна истории', status: 'Н' },
]

export function RegimeMenu({ value, months, regimes, macro, onChange }: Props) {
  const [s, dispatch] = useReducer(regimeMenuReducer, value, (v) => fromMacroMode(v))
  const [sample, setSample] = useState<MacroSampleResult | null>(null)
  const [sampling, setSampling] = useState(false)
  const timer = useRef<number>()
  const first = useRef(true)
  const names = regimes?.regimes.map((r) => r.label) ?? []

  // Состояние меню → сценарий (не на первом рендере) и образец путей для полосы режимов.
  useEffect(() => {
    const mode = toMacroMode(s, months)
    if (!first.current) onChange(typeof mode === 'string' ? mode : JSON.stringify(mode))
    first.current = false
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setSampling(true)
      const m = typeof mode === 'string' ? null : mode
      api.macro.sample({ n: 300, seed: 42, horizon_months: Math.max(1, Math.min(36, months)), paths: 300, stress: m?.stress ?? null, ref: m?.ref })
        .then(setSample).catch(() => setSample(null)).finally(() => setSampling(false))
    }, SAMPLE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, months])

  const label = regimeLabel(s, names)
  return (
    <section className="sc2-regime" aria-label="Режимы и стрессы генератора">
      <div className="sc2-regime__kinds" role="radiogroup" aria-label="Режим генератора">
        {KINDS.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={s.kind === k.id} className={`sc2-kind${s.kind === k.id ? ' is-on' : ''}${k.id === 'base' ? '' : ' is-stress'}`}
                  onClick={() => dispatch({ type: 'kind', kind: k.id })}>
            <span className="sc2-kind__t">{k.title} <ProvenanceBadge status={k.status} /></span>
            <span className="sc2-kind__s">{k.sub}</span>
          </button>
        ))}
      </div>
      <div className="sc2-regime__ctl">
        {s.kind === 'regime' && (
          <label className="sc2-inline">Режим:
            <select className="plan__select" value={s.regime} onChange={(e) => dispatch({ type: 'regime', regime: Number(e.target.value) })}>
              {(regimes?.regimes ?? [{ index: 0, label: '0' }, { index: 1, label: '1' }]).map((r) => <option key={r.index} value={r.index}>{r.index} · {r.label}</option>)}
            </select>
            {regimes && <span className="sc2-muted">в истории {pct(regimes.regimes[s.regime]?.share_of_history ?? 0, 0)} месяцев · средняя длительность {num(regimes.regimes[s.regime]?.mean_duration_months ?? 0, 1)} мес</span>}
          </label>
        )}
        {s.kind === 'quantile' && (
          <label className="sc2-inline">q =
            <input className="plan__input" type="number" min={0.01} max={0.99} step={0.01} value={s.quantile} onChange={(e) => dispatch({ type: 'quantile', quantile: Number(e.target.value) })} />
            <input type="range" min={0.01} max={0.99} step={0.01} value={s.quantile} aria-label="квантиль" onChange={(e) => dispatch({ type: 'quantile', quantile: Number(e.target.value) })} />
            <span className="sc2-muted">{s.quantile >= 0.5 ? 'высокая инфляция / слабый рубль / высокая ставка' : 'дезинфляция / крепкий рубль / низкая ставка'} — только квантили, не ожидание</span>
          </label>
        )}
        {s.kind === 'episode' && (
          <label className="sc2-inline">Начало (YYYY-MM):
            <input className="plan__input" type="month" min={regimes?.episodes_available[0]} max={regimes?.episodes_available[1]} value={s.episode} onChange={(e) => dispatch({ type: 'episode', episode: e.target.value })} />
            длина, мес: <input className="plan__input" type="number" min={1} max={36} value={s.episodeMonths} onChange={(e) => dispatch({ type: 'episode', episode: s.episode, months: Number(e.target.value) || 1 })} />
            <span className="sc2-muted">например 2014-12, 2022-02 (кризисные месяцы истории)</span>
          </label>
        )}
        <div className="sc2-inline">
          Опора инфляции:
          <select className="plan__select" value={s.refCpi} onChange={(e) => dispatch({ type: 'refCpi', refCpi: e.target.value as 'flat' | 'nodes' })}>
            <option value="flat">плоская (последнее наблюдение)</option>
            <option value="nodes">узлы прогноза ЦБ РФ 24.07.2026</option>
          </select>
          <ProvenanceBadge status="НОРМ" />
          Опора ставки:
          <select className="plan__select" value={s.refKey} onChange={(e) => dispatch({ type: 'refKey', refKey: e.target.value as 'flat' | 'custom', customKey: s.customKey ?? regimes?.last_obs.key_pp ?? 14 })}>
            <option value="flat">плоская {regimes ? `(${num(regimes.last_obs.key_pp, 1)} %)` : ''}</option>
            <option value="custom">пользовательская</option>
          </select>
          {s.refKey === 'custom' && <input className="plan__input" type="number" step={0.25} value={s.customKey ?? ''} aria-label="ставка опоры, % годовых" onChange={(e) => dispatch({ type: 'refKey', refKey: 'custom', customKey: Number(e.target.value) })} />}
        </div>
      </div>
      <div className="sc2-regime__strip">
        <div className="sc2-row">
          <Chip tone={label.isForecast ? 'good' : 'warn'}>{label.text}</Chip>
          {sample && <span className="sc2-muted">{sample.label} · {sample.n} путей · {sample.months} мес · F(σ) по режимам: {sample.regime_share.map((v) => pct(v, 0)).join(' / ')}{sampling ? ' · обновляем…' : ''}</span>}
          {!sample && !sampling && <span className="sc2-muted">генератор недоступен (POST /api/macro/sample)</span>}
        </div>
        {regimes && (
          <RegimeStrip regimes={regimes.regimes} paths={sample?.paths.map((p) => p.regime) ?? []} share={sample?.regime_share} isForecast={label.isForecast}
            forced={s.kind === 'regime' ? s.regime : null} />
        )}
        {sample && (
          <div className="sc2-joint" role="img" aria-label="Совместный веер: ставка, курс, инфляция по месяцам">
            {(['key', 'fx', 'cpi'] as const).map((k) => {
              const q = sample.monthly[k]
              const unit = k === 'key' ? '%' : k === 'fx' ? '₽/$' : '% г/г'
              const title = k === 'key' ? 'ключевая ставка' : k === 'fx' ? 'курс USD/RUB' : 'инфляция'
              const last = q.p50.length - 1
              return (
                <div key={k} className="sc2-joint__cell">
                  <span className="text-caps">{title}</span>
                  <b className="num">{num(q.p50[last], 1)} {unit}</b>
                  <span className="sc2-muted num">p05–p95 {num(q.p05[last], 1)}–{num(q.p95[last], 1)} через {sample.months} мес</span>
                </div>
              )
            })}
            {macro?.holdout && <div className="sc2-joint__cell"><span className="text-caps">покрытие 80 % (holdout)</span><b className="num">π {num(macro.holdout.variables.cpi_yoy_pp.coverage80, 2)} · i {num(macro.holdout.variables.key_pp.coverage80, 2)} · S {num(macro.holdout.variables.usd_rub.coverage80, 2)}</b><span className="sc2-muted">ставка недопокрыта — стресс квантилем</span></div>}
          </div>
        )}
      </div>
      {s !== DEFAULT_MENU && <button type="button" className="pf-link" onClick={() => dispatch({ type: 'reset' })}>сбросить к базовому</button>}
    </section>
  )
}
