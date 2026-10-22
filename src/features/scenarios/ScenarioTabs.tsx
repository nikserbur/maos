/**
 * Сценарий V2 (UX-V2 §5.1): шапка и критерий — `ScenarioHeader`; три вкладки —
 * Условия [1] · Распределения [2] · Прогноз и проверка [7]. Вкладка — в маршруте
 * `#/scenarios/<tab>` (узлы карты ведут прямо на вкладку).
 */
import { useState } from 'react'
import type { MacroRegimes, MacroSummary, PriceDistribution, PriceScenario, Product } from '../../lib/api'
import { useHashRoute } from '../../shell/router'
import { InfoTip } from '../../ui/InfoTip'
import { StateLegend } from '../../ui/StateLegend'
import { Segmented } from '../../ui/kit'
import { ConditionsTab } from './ConditionsTab'
import { DistributionsTab } from './DistributionsTab'
import { ForecastTab } from './ForecastTab'
import { ScenarioHeader, type SaveStatus } from './ScenarioHeader'
import './scenarios-v2.css'

export type { SaveStatus } from './ScenarioHeader'

export type ScenarioTab = 'conditions' | 'distributions' | 'forecast'
const TABS: readonly ScenarioTab[] = ['conditions', 'distributions', 'forecast']

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
  const tab: ScenarioTab = (TABS as readonly string[]).includes(anchor ?? '') ? (anchor as ScenarioTab) : 'conditions'
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="sc2">
      <ScenarioHeader sc={sc} saveStatus={saveStatus} regimes={regimes} onPatch={onPatch} onClone={onClone} onRemove={onRemove}
        onRefresh={tab === 'forecast' ? () => setRefreshKey((k) => k + 1) : undefined} />

      <Segmented label="Вкладки сценария" kind="nav" fit size="lg" value={tab} onChange={(id) => navigate('scenarios', id)}
        options={[
          { id: 'conditions', label: <><span className="sc2-tabn mono">[1]</span> Условия</> },
          { id: 'distributions', label: <><span className="sc2-tabn mono">[2]</span> Распределения</>, count: sc.distributions?.length },
          { id: 'forecast', label: <><span className="sc2-tabn mono">[7]</span> Прогноз и проверка</> },
        ]} />
      <div className="sc2-tabwrap">
        <p className="sc2-muted sc2-tabhint">
          {tab === 'conditions' && <>Поля сгруппированы по тому, на что влияют; ползунок — по наведению или фокусу, пояснения — в «i». Происхождение: <StateLegend compact states={['estimated', 'manual', 'normative', 'default', 'stale']} /></>}
          {tab === 'distributions' && <>Семейство, центр, σ, хвосты и β по изделию; корреляции — из β. Плотность рисуется только там, где распределение задано вручную. <InfoTip id="forecast.aic" /></>}
          {tab === 'forecast' && <>Сначала качество — худшие изделия первыми, затем веера с бэктестом; веер ставки — из обученного генератора.</>}
        </p>
        {tab === 'conditions' && <ConditionsTab sc={sc} regimes={regimes} macro={macro} onPatch={onPatch} />}
        {tab === 'distributions' && <DistributionsTab sc={sc} products={products} onSetDist={onSetDist} onSetDists={onSetDists} />}
        {tab === 'forecast' && <ForecastTab sc={sc} refreshKey={refreshKey} />}
      </div>
    </div>
  )
}
