/** HUD заставки: фазы ГА, счётчики, кривая сходимости и прокручиваемые настройки. */

import { useEffect, useId, useState, type ChangeEvent } from 'react'
import { areaPath, linePath } from '../../ui/charts/scale'
import '../../ui/charts/charts.css'

export const PHASES = ['Оценка', 'Отбор', 'Скрещивание', 'Мутация'] as const

export interface HudState {
  /** 0..3 — текущая фаза; PHASES.length — найден максимум. */
  phase: number
  gen: number
  best: number
  mean: number
  sigma: number
  history: ReadonlyArray<{ best: number; mean: number }>
  converged: boolean
}

/** Живые параметры заставки (расширяют DEFAULT_GA). */
export interface GaLiveParams {
  popSize: number
  mutationRate: number
  sigma0: number
  elite: number
  tournament: number
  blxAlpha: number
  maxGens: number
  genSec: number
}

export const DEFAULT_LIVE: GaLiveParams = {
  popSize: 96,
  mutationRate: 0.44,
  sigma0: 0.75,
  elite: 0,
  tournament: 8,
  blxAlpha: 0.35,
  maxGens: 175,
  genSec: 0.35,
}

const fmt = (v: number, d = 3) => v.toFixed(d).replace('.', ',')

function sameParams(a: GaLiveParams, b: GaLiveParams) {
  return a.popSize === b.popSize
    && a.mutationRate === b.mutationRate
    && a.sigma0 === b.sigma0
    && a.elite === b.elite
    && a.tournament === b.tournament
    && a.blxAlpha === b.blxAlpha
    && a.maxGens === b.maxGens
    && a.genSec === b.genSec
}

/** Кривая сходимости на примитивах chart-системы: площадь 10 %, линии 2/1,2 px, порог — пунктир цели. */
function Convergence({ history }: { history: HudState['history'] }) {
  const W = 200
  const H = 44
  if (history.length < 2) return <svg className="ga-hud__chart" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" />
  const n = Math.max(history.length - 1, 1)
  const x = (i: number) => (i / n) * W
  const y = (v: number) => H - 4 - Math.max(0, Math.min(1, v)) * (H - 8)
  const pts = (k: 'best' | 'mean') => history.map((h, i) => ({ x: x(i), y: y(h[k]) }))
  const best = pts('best')
  const last = best[best.length - 1]
  return (
    <svg className="ga-hud__chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Сходимость: лучшее и среднее значение по поколениям">
      <line x1="0" x2={W} y1={y(1)} y2={y(1)} className="ga-hud__target" />
      <path d={areaPath(best, H)} className="ch-area" fill="var(--chart-2)" />
      <path d={linePath(pts('mean'))} className="ga-hud__mean" />
      <path d={linePath(best)} className="ch-line ga-hud__best" />
      <circle className="ch-marker ga-hud__dot" cx={last.x} cy={last.y} r={3.5} fill="var(--chart-2)" />
    </svg>
  )
}

interface SliderProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  onChange: (v: number) => void
}

function Slider({ id, label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <label className="ga-hud__slider" htmlFor={id}>
      <span className="ga-hud__slider-lab">
        <span>{label}</span>
        <b className="num">{format ? format(value) : String(value)}</b>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

interface HudProps {
  hud: HudState
  params: GaLiveParams
  onParams: (next: GaLiveParams) => void
}

export function LandscapeHud({ hud, params, onParams }: HudProps) {
  const uid = useId()
  const [draft, setDraft] = useState(params)
  const [open, setOpen] = useState(false)

  useEffect(() => { setDraft(params) }, [params])

  const synced = sameParams(draft, params)
  const patch = (partial: Partial<GaLiveParams>) => setDraft((d) => ({ ...d, ...partial }))

  return (
    <div className="ga-hud">
      <div className="ga-hud__scroll">
        <div className="ga-hud__head">
          <span className="text-caps ga-hud__title">Генетический алгоритм</span>
          <span className="ga-hud__gen num">поколение {hud.gen} · {PHASES[hud.phase] ?? 'максимум'}</span>
        </div>
        <ol className="ga-hud__phases" aria-label="Фаза поколения">
          {PHASES.map((p, i) => (
            <li key={p} className={i === hud.phase ? 'is-on' : i < hud.phase ? 'is-past' : ''}>
              <span className="ga-hud__sr">{p}</span>
            </li>
          ))}
        </ol>
        <div className="ga-hud__stats">
          <div><span className="text-caps">лучшее f</span><b className="num">{fmt(hud.best)}</b></div>
          <div><span className="text-caps">среднее f</span><b className="num">{fmt(hud.mean)}</b></div>
          <div><span className="text-caps">σ мутации</span><b className="num">{fmt(hud.sigma, 2)}</b></div>
        </div>
        <Convergence history={hud.history} />
        <p className={`ga-hud__status${hud.converged ? ' is-done' : ''}`}>
          {hud.converged ? '▲ Максимум найден' : 'Поиск максимума…'}
        </p>

        <button
          type="button"
          className="ga-hud__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span>Настройки</span>
          <span className="ga-hud__toggle-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>

        {open && (
          <fieldset className="ga-hud__settings">
            <legend className="ga-hud__sr">Параметры генетического алгоритма</legend>
            <Slider id={`${uid}-gens`} label="Итерации" value={draft.maxGens}
              min={10} max={200} step={5} onChange={(v) => patch({ maxGens: v })} />
            <Slider id={`${uid}-mut`} label="Мутация" value={Math.round(draft.mutationRate * 100)}
              min={5} max={90} step={1}
              format={(v) => `${v} %`}
              onChange={(v) => patch({ mutationRate: v / 100 })} />
            <Slider id={`${uid}-pop`} label="Популяция" value={draft.popSize}
              min={12} max={96} step={4} onChange={(v) => patch({ popSize: v })} />
            <Slider id={`${uid}-sig`} label="σ₀ мутации" value={draft.sigma0}
              min={0.1} max={1.2} step={0.05}
              format={(v) => fmt(v, 2)}
              onChange={(v) => patch({ sigma0: v })} />
            <Slider id={`${uid}-elite`} label="Элитизм" value={draft.elite}
              min={0} max={8} step={1} onChange={(v) => patch({ elite: v })} />
            <Slider id={`${uid}-tour`} label="Турнир k" value={draft.tournament}
              min={2} max={8} step={1} onChange={(v) => patch({ tournament: v })} />
            <Slider id={`${uid}-blx`} label="BLX-α" value={draft.blxAlpha}
              min={0} max={0.8} step={0.05}
              format={(v) => fmt(v, 2)}
              onChange={(v) => patch({ blxAlpha: v })} />
            <Slider id={`${uid}-spd`} label="Сек / поколение" value={draft.genSec}
              min={0.35} max={3} step={0.05}
              format={(v) => fmt(v, 2)}
              onChange={(v) => patch({ genSec: v })} />
            <div className="ga-hud__actions">
              <button type="button" className="btn btn--primary" onClick={() => onParams(draft)} disabled={synced}>
                Применить
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => onParams(DEFAULT_LIVE)}>
                Сброс
              </button>
            </div>
          </fieldset>
        )}

        <p className="ga-hud__caption">
          Иллюстрация: ГА ищет максимум многоэкстремальной функции; в MAOS так же улучшается расписание.
        </p>
      </div>
    </div>
  )
}
