/**
 * «Что если…» — боковая панель «Мониторинга» вместо раскрытия «Ручные параметры (6)» (владелец:
 * «курс 1 ×, спрос 1 × — бессмысленные множители»). Открытие панели ничего не пересчитывает:
 * источник меняется только по «Пересчитать по этим условиям». Пресеты — та же галерея, что в
 * «Сценариях» (базовый, «как в истории», стресс-тесты); поля — горизонт и поправки в настоящих
 * единицах (инфляция % в год, курс ₽ за $, спрос — отклонение «% к справочнику», как на карточках
 * «Сценариев») с происхождением: пусто — «из генератора»,
 * «ЦБ РФ, <месяц>» или экспертная оценка пресета.
 */
import { useState } from 'react'
import type { MacroLastObs } from '../../lib/api'
import { NBSP, pct, signed } from '../../explain/format'
import { ParamField } from '../../ui/ParamField'
import { ChoiceCards, SidePanel } from '../../ui/kit'
import { conditionSpec } from '../scenarios/conditionFields'
import { PRESETS, presetMacroMode, presetPeriod } from '../scenarios/scenarioPresets'
import { useMacroSample } from '../scenarios/useMacroSample'
import { anchorOf, fanFromPaths, generatorInflation, yoyToMonthly } from './macroModel'
import { monthName } from './monitorModel'
import { HORIZON_MAX, HORIZON_MIN, resolvedDemand, whatIfPreset, type WhatIf } from './whatIfModel'
import './forecast.css'
import './monitor.css'

interface WhatIfPanelProps {
  initial: WhatIf
  /** Сейчас считается по «что если» (тогда есть «Вернуться к прогнозу»). */
  active: boolean
  /** Последнее наблюдение ЦБ (запас, пока генератор не ответил). */
  lastObs: MacroLastObs | null
  onRun: (w: WhatIf) => void
  onReset: () => void
  onClose: () => void
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9
/** Спрос — тот же словарь, что на карточке «Сценариев»: отклонение «% к справочнику». */
const DEMAND = conditionSpec('demand')

export function WhatIfPanel({ initial, active, lastObs, onRun, onReset, onClose }: WhatIfPanelProps) {
  const [w, setW] = useState<WhatIf>(initial)
  const preset = whatIfPreset(w)
  const macro = useMacroSample(presetMacroMode(preset, w.months), w.months, true)
  const s = macro.sample
  const cpi = generatorInflation(s ? fanFromPaths(s.paths, 'cpi', anchorOf(s, 'cpi')) : null, lastObs?.cpi_yoy_pp ?? null)
  const usdNow = s?.last_obs.usd_rub ?? lastObs?.usd_rub ?? null
  const obsMonth = monthName(s?.last_obs.month ?? lastObs?.month)
  const infl = w.inflation ?? cpi
  const demand = resolvedDemand(w)
  const presetDemand = preset.values.demand
  const set = (patch: Partial<WhatIf>) => setW((x) => ({ ...x, ...patch }))
  const fxMult = w.usd !== null && usdNow ? w.usd / usdNow : 1

  return (
    <div className="fz" role="presentation">
      <SidePanel title="Что если…" onClose={onClose} onSave={() => onRun(w)} saveLabel="Пересчитать по этим условиям" cancelLabel="Закрыть"
        danger={active ? <button type="button" className="btn btn--ghost" onClick={onReset}>Вернуться к прогнозу</button> : undefined}>
        <div className="mon-whatif">
          <p className="mon-whatif__lead">Песочница: сценарий не меняется. Расчёт пойдёт только по кнопке внизу.</p>
          <ChoiceCards label="Внешние условия" size="sm" value={preset.id} onChange={(id) => set({ preset: id, demand: null })}
            options={PRESETS.map((p) => ({ id: p.id, title: p.name, description: p.oneLine, meta: `${p.isForecast ? '● прогноз' : '◆ что если'} · ${presetPeriod(p)}` }))} />
          <div className="mon-whatif__fields">
            <ParamField label="Горизонт" value={w.months} unit="мес" min={HORIZON_MIN} max={HORIZON_MAX} step={1} hideProvenance
              onChange={(v) => set({ months: clamp(Math.round(v), HORIZON_MIN, HORIZON_MAX) })} />
            <ParamField label="Инфляция" value={infl === null ? null : Math.round(infl * 1000) / 10} unit={`%${NBSP}в${NBSP}год`} min={-5} max={60} step={0.1}
              provenance={w.inflation === null ? 'estimated' : 'manual'}
              source={w.inflation === null ? (macro.status === 'loading' ? 'генератор: считаем…' : `генератор «${preset.short}», медиана за горизонт`) : undefined}
              changed={w.inflation !== null} onRevert={() => set({ inflation: null })}
              effect={infl === null ? 'генератор не ответил — движок возьмёт своё значение' : `в расчёте цен ≈ ${pct(yoyToMonthly(infl), 2)} в месяц`}
              onChange={(v) => set({ inflation: v / 100 })} />
            <ParamField label="Курс доллара" value={w.usd ?? (usdNow === null ? null : Math.round(usdNow * 10) / 10)} unit={`₽${NBSP}за${NBSP}$`} min={1} max={500} step={0.5}
              provenance={w.usd === null ? 'observed' : 'manual'} source={w.usd === null && obsMonth ? `ЦБ РФ, ${obsMonth}` : undefined}
              changed={w.usd !== null} onRevert={() => set({ usd: null })}
              effect={same(fxMult, 1) ? 'цены в расчёте — по текущему курсу' : `цены в расчёте ${signed(fxMult - 1, '%')} от курса`}
              onChange={(v) => set({ usd: v > 0 ? v : null })} />
            <ParamField label="Спрос" value={DEMAND.toShown(demand)} unit={`%${NBSP}к${NBSP}справочнику`} min={DEMAND.min} max={DEMAND.max} step={5}
              provenance={w.demand !== null ? 'manual' : presetDemand !== undefined ? 'normative' : 'default'}
              source={w.demand === null && presetDemand !== undefined ? `экспертная оценка пресета «${preset.short}»` : undefined}
              changed={w.demand !== null} onRevert={() => set({ demand: null })}
              effect={DEMAND.effect(demand, { months: w.months })}
              onChange={(v) => set({ demand: DEMAND.toStored(clamp(v, DEMAND.min, DEMAND.max)) })} />
          </div>
        </div>
      </SidePanel>
    </div>
  )
}
