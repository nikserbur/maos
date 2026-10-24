/**
 * Состояния канваса схемы (X2 P-35): загрузка, «недоступно» (баннер с «Повторить» — не пустая
 * карта), первое использование и мировой уровень без карты (настоящие координаты меньше чем у
 * двух площадок — пины не выдумываются, список предприятий — в правой колонке).
 */
import { EmptyState, ErrorBanner } from '../../ui/kit'
import { ORG_UNITS_HREF } from './nsiLinks'

interface SceneCanvasStateProps {
  loading: boolean
  loaded: boolean
  error: unknown
  onRetry: () => void
  /** Схема загружена, но объектов нет совсем. */
  empty: boolean
  /** Мировой уровень без карты. */
  noMap: boolean
}

export function SceneCanvasState({ loading, loaded, error, onRetry, empty, noMap }: SceneCanvasStateProps) {
  if (error) {
    return (
      <div className="scene__overlay scene__overlay--top">
        <ErrorBanner title={loaded ? 'Схема не обновилась — показана последняя загруженная' : 'Схема недоступна'} error={error} onRetry={onRetry} />
      </div>
    )
  }
  if (!loaded && loading) return <div className="scene__overlay scene__status" role="status">Загрузка схемы из Справочников…</div>
  if (empty) {
    return (
      <div className="scene__overlay scene__overlay--center">
        <EmptyState size="md" kind="first-use" variant="flow" title="Заводов пока нет"
                    action={<a className="btn btn--primary" href={ORG_UNITS_HREF}>Открыть Справочники › Подразделения</a>}>
          Создайте подразделение в Справочниках — завод, цеха и станки появятся на схеме.
        </EmptyState>
      </div>
    )
  }
  if (noMap) {
    return (
      <div className="scene__overlay scene__overlay--center">
        <EmptyState size="sm" kind="unavailable" variant="flow" title="Карта не показана">
          Настоящие координаты заданы меньше чем у двух площадок. Выберите предприятие в списке справа или
          укажите расположение в <a className="ep-link" href={ORG_UNITS_HREF}>Справочниках › Подразделения</a>.
        </EmptyState>
      </div>
    )
  }
  return null
}
