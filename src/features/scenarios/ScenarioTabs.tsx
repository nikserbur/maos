/**
 * Сценарий (UX-V2 §5.1): шапка — `ScenarioHeader`; три вкладки без номеров блоков — «Условия» ·
 * «Распределения · 2 из 76 вручную» · «Прогноз и проверка». Вкладка — в адресе
 * `#/scenarios/<id>/<вкладка>`; переключатель липкий (top 0 внутри .scn__main, под ним — липкая
 * шапка таблиц), смена вкладки возвращает прокрутку к переключателю. Легенда происхождения — в «i».
 */
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { MacroRegimes, MacroSummary, PriceDistribution, PriceScenario, Product } from '../../lib/api'
import { num } from '../../explain/format'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
import { NoteTip } from '../../ui/NoteTip'
import { StateLegend } from '../../ui/StateLegend'
import { Segmented } from '../../ui/kit'
import { ConditionsTab } from './ConditionsTab'
import { DistributionsTab } from './DistributionsTab'
import { ForecastTab } from './ForecastTab'
import { ScenarioHeader } from './ScenarioHeader'
import { distRow, isCustomDist } from './distModel'
import type { ScenarioTab } from './scenarioRoute'
import type { SaveStatus } from './useScenarioData'
import './scenarios-v2.css'

interface Props {
  sc: PriceScenario
  tab: ScenarioTab
  products: Product[]
  productsFailed: boolean
  saveStatus?: SaveStatus
  regimes: MacroRegimes | null
  macro: MacroSummary | null
  isWorking: boolean
  onTab: (tab: ScenarioTab) => void
  onPatch: (sc: PriceScenario, p: Partial<PriceScenario>) => void
  onSetDist: (sc: PriceScenario, pid: string, patch: Partial<PriceDistribution>) => Promise<void>
  onSetDists: (sc: PriceScenario, rows: PriceDistribution[]) => Promise<void>
  onMakeWorking: () => void
  onFindPortfolio: () => void
  onBuildPlan: () => void
  onClone: () => void
  onRemove: () => void
}

export function ScenarioTabs(props: Props) {
  const { sc, tab, products, productsFailed, regimes, macro, onTab, onPatch, onSetDist, onSetDists } = props
  const anchorRef = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  const manual = useMemo(() => products.map((p) => distRow(sc, p)).filter(isCustomDist).length, [sc, products])

  // Смена вкладки: если прокрутили ниже переключателя — вернуть его к верху (виден заголовок вкладки).
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return }
    const anchor = anchorRef.current
    const main = anchor?.closest('.scn__main')
    if (!anchor || !(main instanceof HTMLElement)) return
    const top = anchor.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
    if (main.scrollTop > top) main.scrollTop = top
  }, [tab])

  const distLabel = products.length ? `Распределения · ${num(manual, 0)} из ${num(products.length, 0)} вручную` : 'Распределения'
  return (
    <div className="sc2">
      <ScenarioHeader sc={sc} tab={tab} saveStatus={props.saveStatus} regimes={regimes} isWorking={props.isWorking} onPatch={onPatch}
        onMakeWorking={props.onMakeWorking} onFindPortfolio={props.onFindPortfolio} onBuildPlan={props.onBuildPlan}
        onClone={props.onClone} onRemove={props.onRemove} />

      <div ref={anchorRef} className="sc2-tabs-anchor" aria-hidden="true" />
      <div className="sc2-tabs">
        <Segmented label="Вкладки сценария" kind="nav" size="md" value={tab} onChange={onTab}
          options={[
            { id: 'conditions', label: 'Условия' },
            { id: 'distributions', label: distLabel },
            { id: 'forecast', label: 'Прогноз и проверка' },
          ]} />
        <NoteTip title="Обозначения происхождения">
          <StateLegend compact states={['estimated', 'manual', 'normative', 'default', 'stale']} />
        </NoteTip>
      </div>

      <TabBoundary tab={tab}>
        {tab === 'conditions' && <ConditionsTab sc={sc} regimes={regimes} macro={macro} onPatch={onPatch} />}
        {tab === 'distributions' && <DistributionsTab sc={sc} products={products} productsFailed={productsFailed} onSetDist={onSetDist} onSetDists={onSetDists} />}
        {tab === 'forecast' && <ForecastTab sc={sc} />}
      </TabBoundary>
    </div>
  )
}

function TabBoundary({ tab, children }: { tab: ScenarioTab; children: ReactNode }) {
  return <ErrorBoundary key={tab} variant="inline" label={`вкладка ${tab}`} message="Эта вкладка не открылась — остальное работает. Переключитесь на другую вкладку или повторите.">{children}</ErrorBoundary>
}
