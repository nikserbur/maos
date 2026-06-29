import { useState, type ComponentType } from 'react'
import { ScenarioCompareScreen } from './ScenarioCompareScreen'
import { ForecastScreen } from '../forecast/ForecastScreen'
import './scenarios-hub.css'

interface Tab { id: string; label: string; C: ComponentType }

// «Распределения цен (НСИ)» убраны: распределение теперь подбирается из истории
// в «Прогнозе» (data-driven) — отдельный single-period редактор дублировал его.
const TABS: Tab[] = [
  { id: 'compare',  label: 'Сценарии и сравнение', C: ScenarioCompareScreen },
  { id: 'forecast', label: 'Прогноз цен во времени', C: ForecastScreen },
]

/**
 * Единый раздел «Сценарии»: сравнение/оверрайды, прогноз во времени и редактор
 * распределений — в одном месте (вкладки), чтобы не дублировать навигацию.
 */
export function ScenariosHub() {
  const [tab, setTab] = useState('compare')
  const Active = (TABS.find((t) => t.id === tab) ?? TABS[0]).C
  return (
    <div className="shub">
      <div className="shub__tabs">
        {TABS.map((t) => (
          <button key={t.id}
                  className={t.id === tab ? 'shub__tab shub__tab--active' : 'shub__tab'}
                  onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="shub__body"><Active /></div>
    </div>
  )
}
