/**
 * Расширенные настройки генератора (§2.6б; редьюсер — regimeMenu.ts) — свёрнуты под карточкой пресета:
 *  - режим — карточками выбора с одной строкой эффекта: «Базовый (обучено на истории)» · «Свой период
 *    из истории» · «Кризисный режим» · «Крайний путь» (два последних — с предупреждением и предложением
 *    понятного пресета «Как 2014–15» / «Как 2022»);
 *  - «Свой период»: начало и длина в пределах истории, что было тогда, кризисные месяцы истории;
 *  - от чего отсчитывать инфляцию и ставку (последнее значение ЦБ РФ / узлы прогноза ЦБ / своя ставка);
 *  - пути генератора: полоса режимов (скрыта, если в выбранном режиме режимов нет) и проверка на
 *    отложенных данных.
 */
import { useId } from 'react'
import type { MacroRegimes, MacroSummary } from '../../lib/api'
import { NBSP, num, pct } from '../../explain/format'
import { RegimeStrip } from '../../ui/RegimeStrip'
import { ChoiceCards } from '../../ui/kit'
import { addMonths, monthShort, monthsBetween } from './monthText'
import { crisisMonthsText, historyThen } from './presetStats'
import {
  KIND_OPTIONS, quantileText, regimeLabel, regimeName, toMacroMode, type RegimeKind, type RegimeMenuAction, type RegimeMenuState,
} from './regimeMenu'
import { useMacroSample } from './useMacroSample'
import './scenarios-v2.css'

const KEY_FALLBACK = 14
/** Норма попадания факта в полосу «8 из 10 путей». */
const NOMINAL_80 = 0.8
/** Понятные пресеты вместо кризисного режима и крайнего пути. */
const CLEAR_PRESETS = [{ id: 'deval-2014', short: 'Как 2014–15' }, { id: 'sanctions-2022', short: 'Как 2022' }] as const

interface Props {
  state: RegimeMenuState
  horizon: number
  regimes: MacroRegimes | null
  macro: MacroSummary | null
  onAction: (a: RegimeMenuAction) => void
  /** Перейти на пресет (с отменой). */
  onPreset: (presetId: string) => void
}

export function GeneratorAdvanced({ state: s, horizon, regimes, macro, onAction, onPreset }: Props) {
  const capId = useId()
  return (
    <div className="sc2-adv">
      <h4 className="sc2-adv__cap" id={capId}>Режим генератора</h4>
      <ChoiceCards labelledBy={capId} label="Режим генератора" size="sm" value={s.kind} className="sc2-adv__kinds"
        onChange={(kind: RegimeKind) => onAction({ type: 'kind', kind })}
        options={KIND_OPTIONS.map((o) => ({ id: o.id, title: o.label, description: o.effect }))} />
      {s.kind === 'episode' && <EpisodeControls s={s} regimes={regimes} onAction={onAction} />}
      {(s.kind === 'regime' || s.kind === 'quantile') && (
        <div className="sc2-adv__row">
          {s.kind === 'quantile' && (
            <label className="sc2-inline">Сила шока
              <select className="form__select" value={s.quantile} onChange={(e) => onAction({ type: 'quantile', quantile: Number(e.target.value) })}>
                {[...new Set([...(regimes?.stress_quantiles ?? []), s.quantile])].sort((a, b) => a - b).map((q) => <option key={q} value={q}>{quantileText(q)}</option>)}
              </select>
            </label>
          )}
          <p className="sc2-adv__warn">
            <span aria-hidden="true">▲ </span>
            {s.kind === 'regime'
              ? <>Весь горизонт — {regimeName(regimes?.regimes[s.regime]?.label)} режим. В нём смешаны разные события{regimes ? ` (${crisisMonthsText(regimes)})` : ''}: ставка и курс уходят в обе стороны, это не похоже ни на один настоящий кризис.</>
              : <>Шок повторяется каждый месяц и накапливается — предельная проверка, а не правдоподобный путь.</>}
            {' '}Понятнее — пресет:
            {CLEAR_PRESETS.map((p) => <button key={p.id} type="button" className="pf-link" onClick={() => onPreset(p.id)}>«{p.short}»</button>)}
          </p>
        </div>
      )}
      <RefControls s={s} regimes={regimes} onAction={onAction} />
      <GeneratorPaths state={s} months={horizon} regimes={regimes} macro={macro} />
    </div>
  )
}

/** Свой период истории: начало и длина в пределах истории; что было тогда; кризисные месяцы. */
function EpisodeControls({ s, regimes, onAction }: { s: RegimeMenuState; regimes: MacroRegimes | null; onAction: (a: RegimeMenuAction) => void }) {
  const first = regimes?.episode_first ?? regimes?.episodes_available[0]
  const last = regimes?.episodes_available[1]
  const maxLen = last ? Math.max(1, monthsBetween(s.episode, last) + 1) : 36
  const then = historyThen(regimes?.history, { from: s.episode, months: s.episodeMonths })
  const setStart = (ym: string) => {
    if (!/^\d{4}-\d{2}$/.test(ym)) return
    const len = last ? Math.min(s.episodeMonths, Math.max(1, monthsBetween(ym, last) + 1)) : s.episodeMonths
    onAction({ type: 'episode', episode: ym, months: len })
  }
  return (
    <>
      <div className="sc2-adv__row">
        <label className="sc2-inline">Начало
          <input className="form__input" type="month" min={first} max={last} value={s.episode} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="sc2-inline">Длина, мес
          <input className="form__input num" type="number" min={1} max={Math.min(36, maxLen)} value={s.episodeMonths}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 1) onAction({ type: 'episode', episode: s.episode, months: Math.min(v, maxLen) }) }} />
        </label>
        <span className="sc2-muted">{regimeLabel(s).text}{last ? ` · история — до ${monthShort(last)}` : ''}</span>
      </div>
      {then && <p className="sc2-muted">{then[0].toUpperCase() + then.slice(1)}.</p>}
      {regimes && <p className="sc2-muted">Кризисные месяцы истории: {crisisMonthsText(regimes)}. Период выбирается внутри истории: с {monthShort(first)} по {monthShort(last)}.</p>}
    </>
  )
}

/** От чего отсчитывать инфляцию (последнее значение ЦБ / узлы прогноза ЦБ) и ставку (последнее значение ЦБ / своя). */
function RefControls({ s, regimes, onAction }: { s: RegimeMenuState; regimes: MacroRegimes | null; onAction: (a: RegimeMenuAction) => void }) {
  const o = regimes?.last_obs
  return (
    <div className="sc2-adv__row">
      <label className="sc2-inline">От чего отсчитывать инфляцию
        <select className="form__select" value={s.refCpi} onChange={(e) => onAction({ type: 'refCpi', refCpi: e.target.value as 'flat' | 'nodes' })}>
          <option value="flat">последнее значение ЦБ РФ{o ? ` — ${pct(o.cpi_yoy_pp / 100, 1)}` : ''}</option>
          <option value="nodes">прогноз ЦБ РФ по кварталам</option>
        </select>
      </label>
      <label className="sc2-inline">От чего отсчитывать ставку
        <select className="form__select" value={s.refKey} onChange={(e) => onAction({ type: 'refKey', refKey: e.target.value as 'flat' | 'custom', customKey: s.customKey ?? o?.key_pp ?? KEY_FALLBACK })}>
          <option value="flat">последнее значение ЦБ РФ{o ? ` — ${pct(o.key_pp / 100, 1)}` : ''}</option>
          <option value="custom">своя ставка</option>
        </select>
      </label>
      {s.refKey === 'custom' && (
        <label className="sc2-inline">Своя ставка, % годовых
          <input className="form__input num" type="number" step={0.25} value={s.customKey ?? ''}
            onChange={(e) => onAction({ type: 'refKey', refKey: 'custom', customKey: Number(e.target.value) })} />
        </label>
      )}
    </div>
  )
}

interface PathsProps { state: RegimeMenuState; months: number; regimes: MacroRegimes | null; macro: MacroSummary | null }

/** Пути генератора: полоса режимов по месяцам (если режимы есть) и проверка на отложенных данных. */
function GeneratorPaths({ state, months, regimes, macro }: PathsProps) {
  const { sample, status, error, retry } = useMacroSample(toMacroMode(state, months), months, true)
  const label = regimeLabel(state, regimes?.regimes.map((r) => r.label) ?? [], months)
  if (status === 'error' && !sample) {
    return <p className="sc2-adv__warn" role="status" title={error}><span aria-hidden="true">▲ </span>Пути генератора не построены. <button type="button" className="pf-link" onClick={retry}>Повторить</button></p>
  }
  const hasRegimes = (sample?.regime_share ?? []).some((v) => v > 0)
  const anchor = regimes?.last_obs.month
  const monthLabel = (i: number) => (anchor ? monthShort(addMonths(anchor, i + 1)) : `+${num(i + 1, 0)}${NBSP}мес`)
  return (
    <div className={`sc2-regime__strip${status === 'loading' && sample ? ' is-refetching' : ''}`}>
      <p className="sc2-muted">Пути генератора — {label.text}{sample ? ` · ${num(sample.n, 0)} путей на ${num(sample.months, 0)}${NBSP}мес` : ' · строим пути…'}</p>
      {regimes && sample && hasRegimes && (
        <RegimeStrip regimes={regimes.regimes.map((r) => ({ ...r, label: regimeName(r.label) }))} paths={sample.paths.map((p) => p.regime)}
          share={sample.regime_share} isForecast={label.isForecast} forced={state.kind === 'regime' ? state.regime : null} monthLabel={monthLabel} />
      )}
      {sample && !hasRegimes && (
        <p className="sc2-muted">{state.kind === 'quantile' ? 'У крайнего пути режимов нет — один путь с шоком одной силы.' : 'В этом режиме генератора режимы не используются.'}</p>
      )}
      {macro?.holdout && <HoldoutLine h={macro.holdout} />}
    </div>
  )
}

/** Проверка генератора на отложенных данных: попадание в полосу «8 из 10» против нормы 80 %. */
function HoldoutLine({ h }: { h: NonNullable<MacroSummary['holdout']> }) {
  const v = h.variables
  const narrow = Math.min(v.key_pp.coverage80, v.usd_rub.coverage80, v.cpi_yoy_pp.coverage80) < NOMINAL_80
  return (
    <p className="sc2-muted">
      Проверка на отложенных данных: в полосу «8 из 10 путей» попало — ставка {pct(v.key_pp.coverage80, 0)}, курс {pct(v.usd_rub.coverage80, 0)},
      инфляция {pct(v.cpi_yoy_pp.coverage80, 0)} (норма {pct(NOMINAL_80, 0)}){narrow ? ' — реальность выходила за полосу чаще нормы: разброс путей — нижняя оценка.' : '.'}
    </p>
  )
}
