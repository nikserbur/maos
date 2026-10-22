/**
 * Сценарий V2 (UX-V2 §5.1): шапка — имя (inline), описание, даты start/end, горизонт, критерий по
 * умолчанию (`objective/alpha/max_share` — ЕДИНСТВЕННОЕ место; «Портфель» наследует и показывает
 * «из сценария»), статус сохранения; три вкладки — Условия [1] · Распределения [2] · Прогноз и проверка [7].
 * Вкладка — в маршруте `#/scenarios/<tab>` (узлы карты ведут прямо на вкладку).
 */
import { useState } from 'react'
import type { MacroRegimes, MacroSummary, PriceDistribution, PriceScenario, Product } from '../../lib/api'
import { num, pct } from '../../explain/format'
import { useHashRoute } from '../../shell/router'
import { InfoTip } from '../../ui/InfoTip'
import { ParamField } from '../../ui/ParamField'
import { StateLegend } from '../../ui/StateLegend'
import { OBJECTIVES } from '../optimization/optTypes'
import { usePassport } from '../passport/passportStore'
import { Segmented } from '../plan/ui'
import { ConditionsTab } from './ConditionsTab'
import { DistributionsTab } from './DistributionsTab'
import { ForecastTab } from './ForecastTab'
import { fromMacroMode, regimeLabel } from './regimeMenu'
import './scenarios-v2.css'

export type ScenarioTab = 'conditions' | 'distributions' | 'forecast'
const TABS: readonly ScenarioTab[] = ['conditions', 'distributions', 'forecast']

export type SaveStatus = 'pending' | 'saved' | 'error'
const SAVE_LABEL: Record<SaveStatus, string> = { pending: 'сохраняем…', saved: 'Сохранено ✓', error: 'не сохранено — нет связи' }

interface Props {
  sc: PriceScenario
  products: Product[]
  saveStatus?: SaveStatus
  regimes: MacroRegimes | null
  macro: MacroSummary | null
  onPatch: (sc: PriceScenario, p: Partial<PriceScenario>) => void
  onSetDist: (sc: PriceScenario, pid: string, patch: Partial<PriceDistribution>) => void
  onSetDists: (sc: PriceScenario, rows: PriceDistribution[]) => void
  onClone: () => void
  onRemove: () => void
}

export function ScenarioTabs({ sc, products, saveStatus, regimes, macro, onPatch, onSetDist, onSetDists, onClone, onRemove }: Props) {
  const { anchor, navigate } = useHashRoute()
  const passport = usePassport()
  const tab: ScenarioTab = (TABS as readonly string[]).includes(anchor ?? '') ? (anchor as ScenarioTab) : 'conditions'
  const [refreshKey, setRefreshKey] = useState(0)
  const alpha = Number(sc.alpha) || 0.1
  const maxShare = Number(sc.max_share) || 0.35
  const months = Number(sc.months) || 6
  const regime = regimeLabel(fromMacroMode(sc.macro_mode), regimes?.regimes.map((r) => r.label))

  return (
    <div className="sc2">
      <header className="sc2-head">
        <div className="sc2-head__main">
          <input className="scn__name-input" value={sc.name} aria-label="Название сценария" onChange={(e) => onPatch(sc, { name: e.target.value })} />
          <input className="sc2-head__desc" placeholder="Описание (чем этот сценарий отличается)" value={sc.description || ''} onChange={(e) => onPatch(sc, { description: e.target.value })} />
          <div className="sc2-head__meta">
            <label className="sc2-inline">Начало горизонта <input className="plan__input" type="date" value={sc.start_date || ''} onChange={(e) => onPatch(sc, { start_date: e.target.value })} aria-label="Дата начала горизонта" /></label>
            <label className="sc2-inline">Конец <input className="plan__input" type="date" value={sc.end_date || ''} onChange={(e) => onPatch(sc, { end_date: e.target.value })} aria-label="Дата конца горизонта" /></label>
            <span className="sc2-muted">горизонт {months} мес · {num(months * 720, 0)} ч</span>
            <span className={`sc2-chip${regime.isForecast ? '' : ' is-stress'}`}>{regime.text}</span>
            {!sc.start_date && <span className="sc2-muted">▲ без даты начала сроки заказов считаются от сегодняшнего дня</span>}
          </div>
        </div>
        <div className="sc2-head__side">
          {saveStatus && <span className={`scn__save scn__save--${saveStatus}`} role="status">{SAVE_LABEL[saveStatus]}</span>}
          <div className="scn__detail-actions">
            {tab === 'forecast' && <button className="btn" title="Пересчитать прогноз" onClick={() => setRefreshKey((k) => k + 1)}>↻ Обновить</button>}
            <button className="btn" onClick={onClone}>Клонировать</button>
            <button className="btn" onClick={onRemove}>Удалить</button>
          </div>
        </div>
      </header>

      <section className="sc2-criterion" aria-label="Критерий по умолчанию">
        <p className="sc2-group__t text-caps">Критерий по умолчанию <span className="sc2-muted">— единственное место: «Портфель» и «План» наследуют его и могут переопределить только на прогон с пометкой</span></p>
        <div className="sc2-criterion__row">
          <ParamField label="Критерий" value={OBJECTIVES.find((o) => o.id === (sc.objective || 'cvar'))?.label ?? sc.objective ?? 'cvar'} provenance={sc.objective && sc.objective !== 'cvar' ? 'manual' : 'default'} owner="этот сценарий">
            <Segmented label="Критерий робастности" value={(sc.objective || 'cvar') as (typeof OBJECTIVES)[number]['id']} onChange={(id) => onPatch(sc, { objective: id })}
              options={OBJECTIVES.map((o) => ({ id: o.id, label: o.label, title: o.hint }))} />
          </ParamField>
          <ParamField label="α хвоста" value={alpha * 100} unit="%" status={passport.byCode['r1.19']?.status ?? 'К'} provenance={alpha !== 0.1 ? 'manual' : 'calibrated'} owner="этот сценарий"
            range={[1, 50]} step={1} min={1} max={50} onChange={(v) => onPatch(sc, { alpha: String(v / 100) })} info="opt.cvar"
            note="Один α на портфель, план, кассу и агента: «худшие α·100 % сценариев»." />
          <ParamField label="Макс. доля изделия" value={maxShare * 100} unit="%" status={passport.byCode['r1.40']?.status ?? 'НОРМ'} provenance={maxShare !== 0.35 ? 'manual' : 'normative'} owner="этот сценарий"
            range={[10, 100]} step={5} min={10} max={100} onChange={(v) => onPatch(sc, { max_share: String(v / 100) })} info="opt.max_share" effect={<>не более <b className="num">{pct(maxShare, 0)}</b> выручки на одно изделие</>} />
        </div>
      </section>

      <Segmented label="Вкладки сценария" mode="nav" size="lg" value={tab} onChange={(id) => navigate('scenarios', id)}
        options={[
          { id: 'conditions', label: <><span className="sc2-tabn mono">[1]</span> Условия</> },
          { id: 'distributions', label: <><span className="sc2-tabn mono">[2]</span> Распределения</>, count: sc.distributions?.length },
          { id: 'forecast', label: <><span className="sc2-tabn mono">[7]</span> Прогноз и проверка</> },
        ]} />
      <div className="sc2-tabwrap">
        <p className="sc2-muted sc2-tabhint">
          {tab === 'conditions' && <>Поля сгруппированы по тому, на что влияют; каждое — с паспортом происхождения: <StateLegend compact states={['estimated', 'manual', 'normative', 'default', 'stale']} />. Ползунки сохраняются через 400 мс.</>}
          {tab === 'distributions' && <>Семейство, центр, σ, хвосты и β по изделию; корреляции — из β. <InfoTip id="forecast.aic" /></>}
          {tab === 'forecast' && <>Сначала качество (skill, покрытие, прокси CRPS), затем веера с бэктестом; веер ставки — из обученного генератора.</>}
        </p>
        {tab === 'conditions' && <ConditionsTab sc={sc} regimes={regimes} macro={macro} onPatch={onPatch} />}
        {tab === 'distributions' && <DistributionsTab sc={sc} products={products} onSetDist={onSetDist} onSetDists={onSetDists} />}
        {tab === 'forecast' && <ForecastTab sc={sc} refreshKey={refreshKey} />}
      </div>
    </div>
  )
}
