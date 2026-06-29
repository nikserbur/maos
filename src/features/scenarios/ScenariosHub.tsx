import { ScenarioCompareScreen } from './ScenarioCompareScreen'

/**
 * Раздел «Сценарии» = реестр сценариев. Открыть сценарий → внешние условия
 * (инфляция/курс/спрос/корреляция/цель/режим/план/оверрайды) + стартовые графики и
 * распределения цен по нему. Выделить два + «Сравнить» → сравнение бок о бок.
 */
export function ScenariosHub() {
  return <ScenarioCompareScreen />
}
