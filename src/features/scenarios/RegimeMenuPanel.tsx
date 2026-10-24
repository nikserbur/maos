/**
 * Режимы и стрессы генератора (§2.6б; редьюсер — regimeMenu.ts). Управляемые части вкладки «Условия»:
 *  - `RegimeControls` — параметры выбранного стресса (режим · квантиль · эпизод) и опоры инфляции/ставки;
 *  - `RegimeSample` — пути генератора по `POST /api/macro/sample` (с задержкой): полоса режимов и
 *    итог к горизонту по ставке, курсу и инфляции. Слово «прогноз» — только у базового режима.
 */
import { useEffect, useRef, useState } from 'react'
import { api, type MacroRegimes, type MacroSampleResult, type MacroSummary } from '../../lib/api'
import { NBSP, num, pct, rangeText } from '../../explain/format'
import { RegimeStrip } from '../../ui/RegimeStrip'
import { regimeLabel, toMacroMode, type RegimeMenuAction, type RegimeMenuState } from './regimeMenu'
import './scenarios-v2.css'

const SAMPLE_DEBOUNCE_MS = 500
const SAMPLE_PATHS = 300
const SAMPLE_SEED = 42
const KEY_FALLBACK = 14

interface ControlsProps {
  state: RegimeMenuState
  horizon: number
  regimes: MacroRegimes | null
  onAction: (a: RegimeMenuAction) => void
  /** stress — параметры выбранного стресса; refs — опоры инфляции и ставки (в развёрнутой части). */
  part: 'stress' | 'refs'
}

/** Параметры выбранного стресса; у базового — ничего (кроме опор по запросу). */
export function RegimeControls({ state: s, horizon, regimes, onAction, part }: ControlsProps) {
  const lastKey = regimes?.last_obs.key_pp
  return (
    <div className="sc2-regime__ctl">
      {part === 'stress' && s.kind === 'regime' && (
        <label className="sc2-inline">Режим
          <select className="form__select" value={s.regime} onChange={(e) => onAction({ type: 'regime', regime: Number(e.target.value) })}>
            {(regimes?.regimes ?? []).map((r) => <option key={r.index} value={r.index}>{r.label}</option>)}
          </select>
          {regimes && (
            <span className="sc2-muted">
              в истории {pct(regimes.regimes[s.regime]?.share_of_history ?? 0, 0)} месяцев · обычно длится {num(regimes.regimes[s.regime]?.mean_duration_months ?? 0, 1)} мес
            </span>
          )}
        </label>
      )}
      {part === 'stress' && s.kind === 'quantile' && (
        <label className="sc2-inline">Квантиль q
          <input className="form__input num" type="number" min={0.01} max={0.99} step={0.01} value={s.quantile} onChange={(e) => onAction({ type: 'quantile', quantile: Number(e.target.value) })} />
          <input type="range" min={0.01} max={0.99} step={0.01} value={s.quantile} aria-label="Квантиль, ползунок" onChange={(e) => onAction({ type: 'quantile', quantile: Number(e.target.value) })} />
          <span className="sc2-muted">{s.quantile >= 0.5 ? 'высокая инфляция, слабый рубль, высокая ставка' : 'дезинфляция, крепкий рубль, низкая ставка'} — один путь, не ожидание</span>
        </label>
      )}
      {part === 'stress' && s.kind === 'episode' && (
        <label className="sc2-inline">Начало эпизода
          <input className="form__input" type="month" min={regimes?.episodes_available[0]} max={regimes?.episodes_available[1]} value={s.episode} onChange={(e) => onAction({ type: 'episode', episode: e.target.value })} />
          длина
          <input className="form__input num" type="number" min={1} max={36} value={s.episodeMonths} aria-label="Длина эпизода, мес" onChange={(e) => onAction({ type: 'episode', episode: s.episode, months: Number(e.target.value) || 1 })} />
          <span className="sc2-muted">{regimeLabel(s, [], horizon).text} · кризисные месяцы истории: 2014-12, 2022-02</span>
        </label>
      )}
      {part === 'refs' && (
        <div className="sc2-inline">
          Опора инфляции
          <select className="form__select" value={s.refCpi} onChange={(e) => onAction({ type: 'refCpi', refCpi: e.target.value as 'flat' | 'nodes' })}>
            <option value="flat">последнее наблюдение</option>
            <option value="nodes">узлы прогноза ЦБ РФ</option>
          </select>
          Опора ставки
          <select className="form__select" value={s.refKey} onChange={(e) => onAction({ type: 'refKey', refKey: e.target.value as 'flat' | 'custom', customKey: s.customKey ?? lastKey ?? KEY_FALLBACK })}>
            <option value="flat">последнее наблюдение{lastKey !== undefined ? ` · ${pct(lastKey / 100, 1)}` : ''}</option>
            <option value="custom">своя ставка</option>
          </select>
          {s.refKey === 'custom' && (
            <input className="form__input num" type="number" step={0.25} value={s.customKey ?? ''} aria-label="Своя ставка опоры, % годовых"
              onChange={(e) => onAction({ type: 'refKey', refKey: 'custom', customKey: Number(e.target.value) })} />
          )}
        </div>
      )}
    </div>
  )
}

interface SampleProps {
  state: RegimeMenuState
  months: number
  regimes: MacroRegimes | null
  macro: MacroSummary | null
}

const JOINT = [
  { k: 'key', title: 'ключевая ставка', fmt: (v: number) => pct(v / 100, 1), range: (a: number, b: number) => rangeText(a / 100, b / 100, '%') },
  { k: 'fx', title: 'курс доллара', fmt: (v: number) => `${num(v, 1)}${NBSP}₽`, range: (a: number, b: number) => `${num(a, 1)}–${num(b, 1)}${NBSP}₽` },
  { k: 'cpi', title: 'инфляция год к году', fmt: (v: number) => pct(v / 100, 1), range: (a: number, b: number) => rangeText(a / 100, b / 100, '%') },
] as const

/** Пути генератора: полоса режимов и итог к горизонту (медиана и P5–P95 «9 из 10 путей»). */
export function RegimeSample({ state, months, regimes, macro }: SampleProps) {
  const [sample, setSample] = useState<MacroSampleResult | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const timer = useRef<number>()
  const horizon = Math.max(1, Math.min(36, months))
  const modeKey = JSON.stringify(toMacroMode(state, horizon))

  useEffect(() => {
    let alive = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setStatus('loading')
      const mode = toMacroMode(state, horizon)
      const m = typeof mode === 'string' ? null : mode
      api.macro.sample({ n: SAMPLE_PATHS, seed: SAMPLE_SEED, horizon_months: horizon, paths: SAMPLE_PATHS, stress: m?.stress ?? null, ref: m?.ref })
        .then((r) => { if (alive) { setSample(r); setStatus('ready') } })
        .catch(() => { if (alive) setStatus('error') })
    }, SAMPLE_DEBOUNCE_MS)
    return () => { alive = false; window.clearTimeout(timer.current) }
  }, [modeKey, horizon]) // eslint-disable-line react-hooks/exhaustive-deps

  const label = regimeLabel(state, regimes?.regimes.map((r) => r.label) ?? [], horizon)
  if (status === 'error' && !sample) return <p className="sc2-muted">Генератор недоступен — пути не построены. Остальные условия сохраняются как обычно.</p>
  return (
    <div className={`sc2-regime__strip${status === 'loading' && sample ? ' is-refetching' : ''}`}>
      <p className="sc2-muted">
        {label.text}{sample ? ` · ${num(sample.n, 0)} путей на ${num(sample.months, 0)} мес` : ' · строим пути…'}
      </p>
      {regimes && (
        <RegimeStrip regimes={regimes.regimes} paths={sample?.paths.map((p) => p.regime) ?? []} share={sample?.regime_share} isForecast={label.isForecast}
          forced={state.kind === 'regime' ? state.regime : null} />
      )}
      {sample && (
        <div className="sc2-joint" role="group" aria-label="Итог к горизонту: ставка, курс, инфляция">
          {JOINT.map(({ k, title, fmt, range }) => {
            const q = sample.monthly[k]
            const last = q.p50.length - 1
            return (
              <div key={k} className="sc2-joint__cell">
                <span className="text-caps">{title}</span>
                <b className="num">{fmt(q.p50[last])}</b>
                <span className="sc2-muted num">9 из 10 путей: {range(q.p05[last], q.p95[last])}</span>
              </div>
            )
          })}
          {macro?.holdout && (
            <div className="sc2-joint__cell">
              <span className="text-caps">проверка на отложенных данных</span>
              <span className="sc2-muted">в полосу «8 из 10» попало: ставка {pct(macro.holdout.variables.key_pp.coverage80, 0)}, курс {pct(macro.holdout.variables.usd_rub.coverage80, 0)}, инфляция {pct(macro.holdout.variables.cpi_yoy_pp.coverage80, 0)} (норма {pct(0.8, 0)})</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
