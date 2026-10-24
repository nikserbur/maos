/**
 * Сценарий (UX-V2 §5.1): шапка — `ScenarioHeader`; три вкладки-ссылки (`Tabs`, не «пилюли») —
 * «Условия» · «Распределения [2]» (счётчик: 2 из 76 рядов заданы вручную) · «Прогноз цен» — одно имя у
 * любого сценария и в крошках (SCENARIO_TAB_TITLES); прогноз это или «что если» — чипом внутри вкладки. Вкладка — в адресе
 * `#/scenarios/<id>/<вкладка>`; полоса вкладок липкая (top 0 внутри .scn__main, под ней — липкая
 * шапка таблиц), смена вкладки возвращает прокрутку к ней. Легенда происхождения — в «i».
 */
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { MacroRegimes, MacroSummary, PriceDistribution, PriceScenario, Product } from '../../lib/api'
import { num } from '../../explain/format'
import { buildHash } from '../../shell/router'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
import { NoteTip } from '../../ui/NoteTip'
import { StateLegend } from '../../ui/StateLegend'
import { Tabs } from '../../ui/kit'
import { ConditionsTab } from './ConditionsTab'
import { DistributionsTab } from './DistributionsTab'
import { ForecastTab } from './ForecastTab'
import { ScenarioHeader } from './ScenarioHeader'
import { distRow, isCustomDist } from './distModel'
import { SCENARIO_TAB_TITLES, scenarioAnchor, type ScenarioTab } from './scenarioRoute'
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

  const href = (t: ScenarioTab) => buildHash('scenarios', scenarioAnchor(sc.id, t))
  return (
    <div className="sc2">
      <ScenarioHeader sc={sc} tab={tab} saveStatus={props.saveStatus} regimes={regimes} isWorking={props.isWorking} onPatch={onPatch}
        onMakeWorking={props.onMakeWorking} onFindPortfolio={props.onFindPortfolio} onBuildPlan={props.onBuildPlan}
        onClone={props.onClone} onRemove={props.onRemove} />

      <div ref={anchorRef} className="sc2-tabs-anchor" aria-hidden="true" />
      <div className="sc2-tabs">
        <Tabs label="Разделы сценария" size="page" value={tab} onChange={onTab}
          items={[
            { id: 'conditions', label: SCENARIO_TAB_TITLES.conditions, href: href('conditions') },
            {
              id: 'distributions', label: SCENARIO_TAB_TITLES.distributions, href: href('distributions'), count: products.length ? manual : undefined,
              countLabel: products.length ? `${num(manual, 0)} из ${num(products.length, 0)} рядов заданы вручную` : undefined,
            },
            { id: 'forecast', label: SCENARIO_TAB_TITLES.forecast, href: href('forecast') },
          ]}
          end={(
            <NoteTip title="Обозначения происхождения">
              <StateLegend compact states={['estimated', 'manual', 'normative', 'default', 'stale']} />
            </NoteTip>
          )} />
      </div>

      <TabBoundary tab={tab}>
        {tab === 'conditions' && <ConditionsTab sc={sc} regimes={regimes} macro={macro} onPatch={onPatch} />}
        {tab === 'distributions' && <DistributionsTab sc={sc} products={products} productsFailed={productsFailed} onSetDist={onSetDist} onSetDists={onSetDists} />}
        {tab === 'forecast' && <ForecastTab sc={sc} anchor={regimes?.last_obs.month} />}
      </TabBoundary>
    </div>
  )
}

function TabBoundary({ tab, children }: { tab: ScenarioTab; children: ReactNode }) {
  return <ErrorBoundary key={tab} variant="inline" label={`вкладка ${tab}`} message="Эта вкладка не открылась — остальное работает. Переключитесь на другую вкладку или повторите.">{children}</ErrorBoundary>
}
