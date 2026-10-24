/**
 * Схема ↔ адрес (X2 P-38): `#/scheme/<завод>/<цех>?sel=<объект>`. Вход/выход уровня — новая запись
 * истории («Назад» работает), выбор — замена адреса. После загрузки графа адрес восстанавливает
 * уровень и выбор (F5); ссылка `schemeHref(id)` с других экранов сама находит путь до объекта.
 */
import { useEffect, useRef, type Dispatch } from 'react'
import { navigateTo, replaceRoute, setHashParams, useHashRoute } from '../../shell/router'
import type { GraphAction, GraphState } from './graph/graphReducer'
import { SCHEME_SCREEN, resolveScenePath, sceneKey, schemeAnchor } from './schemeHref'

export function useSceneUrl(state: GraphState, dispatch: Dispatch<GraphAction>, loaded: boolean): void {
  const route = useHashRoute()
  const onScheme = route.screenId === SCHEME_SCREEN
  const pathIds = state.path.slice(1).map((c) => c.id).filter((id): id is string => id !== null)
  const stateAnchor = schemeAnchor(pathIds)
  const stateSel = state.selectedId
  /** Ключ, к которому сцена должна прийти после восстановления по адресу. */
  const pending = useRef<string | null>(null)
  const firstRestore = useRef(true)
  const graphRef = useRef(state.graph)
  graphRef.current = state.graph
  const stateKeyRef = useRef(sceneKey(stateAnchor, stateSel))
  stateKeyRef.current = sceneKey(stateAnchor, stateSel)

  // Адрес → сцена (загрузка, F5, «Назад», крошки-ссылки, переход с другого экрана).
  useEffect(() => {
    if (!loaded || !onScheme) return
    const target = resolveScenePath(graphRef.current, route.anchor, route.params.sel, firstRestore.current)
    firstRestore.current = false
    const targetKey = sceneKey(schemeAnchor(target.ids), target.selectedId)
    if (targetKey === stateKeyRef.current) return
    pending.current = targetKey
    dispatch({ type: 'SET_PATH', ids: target.ids, selectedId: target.selectedId })
  }, [loaded, onScheme, route.anchor, route.params.sel, dispatch])

  // Сцена → адрес (вход в цех, Esc, клик по объекту).
  useEffect(() => {
    if (!loaded || !onScheme) return
    const key = sceneKey(stateAnchor, stateSel)
    const urlKey = sceneKey(route.anchor ?? '', route.params.sel)
    if (pending.current !== null) {
      if (pending.current !== key) return          // сцена ещё не догнала адрес
      pending.current = null
      // Нормализация без новой записи истории (один завод, неизвестный сегмент, sel вне уровня).
      if (key !== urlKey) {
        replaceRoute(SCHEME_SCREEN, stateAnchor || null, { ...route.params, sel: stateSel })
        window.dispatchEvent(new HashChangeEvent('hashchange'))   // подписчики адреса видят нормализованный якорь
      }
      return
    }
    if (key === urlKey) return
    if (stateAnchor !== (route.anchor ?? '')) navigateTo(SCHEME_SCREEN, stateAnchor || null, { sel: stateSel })
    else setHashParams({ sel: stateSel }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, onScheme, stateAnchor, stateSel])
}
