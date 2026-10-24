/**
 * Карточка пресета — первая на вкладке «Условия» (владелец: «непонятно, как использовать исторический
 * прогноз и базовый ли это сценарий»): какой это сценарий («Базовый — обучено на истории ● прогноз» или
 * «Как 2022 ◆ что если», «Базовый + 2 правки ◆ что если»), одна фраза, какой период истории повторяется
 * и что тогда было, типичный исход генератора через N мес (старт → исход, пик/дно, «9 из 10 путей» с ▲,
 * если на проверке реальность выходила за полосу чаще нормы) и точка старта — сегодняшние значения ЦБ РФ.
 * «Сменить пресет» — та же галерея, что при создании (PresetDialog.tsx); применение с «Отменить».
 */
import { useState } from 'react'
import type { MacroModeName, MacroRegimes, MacroSummary, PriceScenario } from '../../lib/api'
import { NBSP, num, pct, rangeText, signed } from '../../explain/format'
import { NoteTip } from '../../ui/NoteTip'
import { showUndo } from '../../ui/kit'
import { usePassport } from '../passport/passportStore'
import { monthShort } from './monthText'
import { historySpan } from './PresetGallery'
import { PresetDialog } from './PresetDialog'
import { KEY_FLOOR_PP, historyThen, pathExtreme, sampleStats, type PathStat, type SampleStats } from './presetStats'
import type { RegimeMenuState, ScenarioMacroMode } from './regimeMenu'
import { CONDITION_KEYS } from './scenarioDefaults'
import { presetEdits, presetPatch, scenarioMacroMode, scenarioViewOf, viewTitle, type ScenarioPreset } from './scenarioPresets'
import { SAMPLE_PATHS, sampleFailText, useMacroSample } from './useMacroSample'
import './scenario-presets.css'

/** Норма попадания факта в полосу «8 из 10 путей» на проверке генератора. */
const NOMINAL_80 = 0.8

interface Props {
  sc: PriceScenario
  state: RegimeMenuState
  months: number
  regimes: MacroRegimes | null
  macro: MacroSummary | null
  onPatch: (sc: PriceScenario, p: Partial<PriceScenario>) => void
}

export function PresetCard({ sc, state, months, regimes, macro, onPatch }: Props) {
  const [picking, setPicking] = useState(false)
  const names = regimes?.regimes.map((r) => r.label) ?? []
  const ctx = { lastObs: regimes?.last_obs }
  const view = scenarioViewOf(sc, names, ctx)
  const edits = presetEdits(sc, ctx)
  const p = view.preset
  const span = historySpan(regimes)
  const then = historyThen(regimes?.history, p?.window ?? (state.kind === 'episode' ? { from: state.episode, months: state.episodeMonths } : undefined))
  const manualMacro = edits.filter((k) => k === 'inflation' || k === 'fx').length
  const apply = (next: ScenarioPreset, keepEdits: boolean) => {
    const prev: Partial<PriceScenario> = Object.fromEntries([['macro_mode', sc.macro_mode || 'base'], ...CONDITION_KEYS.map((k) => [k, sc[k] ?? ''])])
    onPatch(sc, presetPatch(next, months, keepEdits))
    setPicking(false)
    showUndo({ message: `Пресет «${next.short}» применён`, onUndo: () => onPatch(sc, prev) })
  }
  return (
    <section className="scp-card" aria-labelledby="scp-card-t">
      <div className="scp-card__head">
        <div className="scp-card__titles">
          <span className="scp-card__over">Сценарий</span>
          <h3 className="scp-card__title" id="scp-card-t">
            {p ? viewTitle({ short: p.name, edits: view.edits }) : view.name}
            <span className="scp-kind"><span aria-hidden="true">{view.glyph}</span> {view.kind}</span>
          </h3>
        </div>
        <span className="scp-card__acts">
          {p && view.edits > 0 && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => apply(p, false)} title="Вернуть значения пресета для всех условий">Вернуть условия пресета</button>
          )}
          <button type="button" className="btn btn--sm" onClick={() => setPicking(true)}>Сменить пресет…</button>
        </span>
      </div>
      {p && <p className="scp-card__line">{p.oneLine}</p>}
      <p className="scp-card__how">
        {view.isForecast
          ? <>Это прогноз: генератор обучен на истории ЦБ РФ{span ? ` (${span})` : ''} и продолжает сегодняшние значения; кризисы входят в пути с исторической частотой. Эти пути идут в цены изделий, Портфель и кассу.</>
          : p?.isForecast && view.edits > 0
            ? <>Правки условий превращают Базовый в «что если» — прогноз остаётся только без правок. Для правок удобнее копия: «Клонировать» в меню «⋯».</>
            : state.kind === 'episode'
              ? <>Изменения тех месяцев повторяются по порядку <b>от сегодняшних значений</b>, а не уровни того времени; после периода — обычная динамика.{then ? ` ${then[0].toUpperCase()}${then.slice(1)}.` : ''}</>
              : <>Это проверка «что если», а не прогноз: остальные условия — как в Базовом.</>}
      </p>
      <GeneratorEffect state={state} mode={scenarioMacroMode(sc, months)} months={months} holdout={macro?.holdout?.variables ?? null} />
      <StartPoint regimes={regimes} state={state} />
      {picking && (
        <PresetDialog current={p?.id ?? null} currentText={p ? '' : view.name} manualMacro={manualMacro} regimes={regimes} months={months}
          onApply={apply} onCancel={() => setPicking(false)} />
      )}
    </section>
  )
}

type HoldoutVars = NonNullable<MacroSummary['holdout']>['variables']

const STATS: ReadonlyArray<{ k: keyof SampleStats; title: string; holdout: keyof HoldoutVars; fmt: (v: number) => string; range: (s: PathStat) => string }> = [
  { k: 'key', title: 'Ключевая ставка', holdout: 'key_pp', fmt: (v) => pct(v / 100, 1), range: (s) => rangeText(s.lo / 100, s.hi / 100, '%') },
  { k: 'fx', title: 'Доллар', holdout: 'usd_rub', fmt: (v) => `${num(v, 1)}${NBSP}₽`, range: (s) => `${num(s.lo, 0)}–${num(s.hi, 0)}${NBSP}₽` },
  { k: 'cpi', title: 'Инфляция, год к году', holdout: 'cpi_yoy_pp', fmt: (v) => pct(v / 100, 1), range: (s) => rangeText(s.lo / 100, s.hi / 100, '%') },
]

/** Типичный исход генератора через N мес: старт → исход, пик/дно и «9 из 10 путей» (▲ — полоса узка по проверке). */
function GeneratorEffect({ state, mode, months, holdout }: { state: RegimeMenuState; mode: ScenarioMacroMode | MacroModeName; months: number; holdout: HoldoutVars | null }) {
  const { sample, status, error, retry } = useMacroSample(mode, months)
  if (status === 'error' && !sample) {
    return (
      <p className="scp-card__err" role="status" title={error}>
        <span aria-hidden="true">▲ </span>{sampleFailText(months)}
        <button type="button" className="pf-link" onClick={retry}>Повторить</button>
      </p>
    )
  }
  const st = sample ? sampleStats(sample) : null
  const single = st !== null && st.key.lo === st.key.hi && st.fx.lo === st.fx.hi
  return (
    <div className={`scp-effect${status === 'loading' && sample ? ' is-refetching' : ''}`} aria-busy={status === 'loading' || undefined}>
      <p className="scp-effect__cap">
        Типичный исход через {num(months, 0)}{NBSP}мес — середина {num(sample?.n ?? SAMPLE_PATHS, 0)} путей генератора
        {single ? (state.kind === 'quantile' ? '; крайний путь — один' : '; все пути совпадают: период истории не короче горизонта') : ''}
      </p>
      <div className="scp-effect__grid" role="group" aria-label={`Ставка, курс и инфляция через ${num(months, 0)} мес`}>
        {STATS.map(({ k, title, holdout: hk, fmt, range }) => {
          const s = st?.[k]
          const ext = s ? pathExtreme(k, s) : null
          const cov = holdout?.[hk]?.coverage80
          const narrow = typeof cov === 'number' && cov < NOMINAL_80 - 0.05
          return (
            <div key={k} className="scp-stat">
              <span className="scp-stat__k">{title}</span>
              <span className="scp-stat__v num">{s ? <><span className="scp-stat__from">{fmt(s.start)} →</span> {fmt(s.end)}</> : '…'}</span>
              <span className="scp-stat__sub num">
                {ext ? `${ext.word} ${fmt(ext.value)} · ` : ''}{s && !single ? `9 из 10 путей: ${range(s)}` : s ? 'один путь' : 'считаем пути…'}
              </span>
              {s && !single && narrow && (
                <span className="scp-stat__warn">
                  <span aria-hidden="true">▲ </span>на проверке факт выходил за полосу чаще нормы ({pct(cov, 0)} внутри вместо {pct(NOMINAL_80, 0)})
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Точка старта всех пресетов: сегодняшние значения ЦБ РФ; линия = ставка + спред; чувствительность — в «i». */
function StartPoint({ regimes, state }: { regimes: MacroRegimes | null; state: RegimeMenuState }) {
  const passport = usePassport()
  const o = regimes?.last_obs
  if (!o) return null
  const spread = passport.fin ? passport.fin.spread * 100 : null
  const ptRaw = Number(passport.byCode['macro.pt_fx_raw']?.value)
  const ptProd = Number(passport.byCode['macro.pt_fx_product']?.value)
  const passThrough = Number.isFinite(ptRaw) && Number.isFinite(ptProd)
    ? ` Курс +10 % → закупочные цены сырья ${signed(0.1 * ptRaw, '%')}, цены изделий ${signed(0.1 * ptProd, '%')}.` : ''
  const ownKey = state.refKey === 'custom' && state.customKey !== null ? state.customKey : null
  return (
    <p className="scp-start">
      <span className="scp-start__k">Точка старта — {monthShort(o.month)}, ЦБ РФ:</span>
      <span>ставка <b className="num">{num(o.key_pp, 2)}{NBSP}% годовых</b></span>
      <span>инфляция <b className="num">{num(o.cpi_yoy_pp, 2)}{NBSP}% за год</b></span>
      <span>доллар <b className="num">{num(o.usd_rub, 2)}{NBSP}₽</b></span>
      {spread !== null && <span>кредитная линия ≈ <b className="num">{num((ownKey ?? o.key_pp) + spread, 1)}{NBSP}% годовых</b> (ставка + {num(spread, 1)}{NBSP}п.{NBSP}п.)</span>}
      {ownKey !== null && <span>своя ставка: <b className="num">{num(ownKey, 2)}{NBSP}%</b></span>}
      <NoteTip title="Точка старта">
        Все пресеты начинаются с последнего месяца истории Банка России и продолжают его: генератор не «перескакивает» к уровням прошлых лет.
        Ставка по сценариям идёт путями генератора по месяцам, не константой, и не опускается ниже исторического минимума {pct((regimes.key_floor_pp ?? KEY_FLOOR_PP) / 100, 2)}.{passThrough}
      </NoteTip>
    </p>
  )
}
