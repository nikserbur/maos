/**
 * Экран «Сценарии» (UX-V2 §5.1, X2): слева реестр, справа открытый сценарий или сравнение.
 * Всё, к чему стоит вернуться, — в адресе: `#/scenarios/<id>/<вкладка>`, `#/scenarios/compare/<id>,<id>`
 * (F5 восстанавливает вид). Открытый сценарий: адрес → рабочий → первый; просмотр рабочий НЕ меняет —
 * только явное «Сделать рабочим» или переход к следующему шагу («Найти робастный портфель →»).
 * Удаление — в «⋯» с подтверждением, называющим объект и последствие, и с «Отменить» в тосте.
 */
import { useEffect, useRef, useState } from 'react'
import { setDecisionContext, useDecisionContext } from '../../shell/context'
import { setCrumbTitle } from '../../shell/crumbs'
import { navigateTo, replaceRoute, useHashRoute } from '../../shell/router'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { EmptyState, ErrorBanner, Skeleton, errorDetail, showUndo } from '../../ui/kit'
import { useRefs } from '../method-map/useMethodMapState'
import { ScenarioCompare } from './ScenarioCompare'
import { ScenarioCreateDialog } from './ScenarioCreateDialog'
import { ScenarioList } from './ScenarioList'
import { ScenarioTabs } from './ScenarioTabs'
import {
  compareAnchor, initialCompare, parseScenarioAnchor, resolveOpenId, scenarioAnchor, toggleCompare, workingIdOf, type ScenarioTab,
} from './scenarioRoute'
import type { ScenarioTemplate } from './scenarioTemplates'
import { useScenarioData } from './useScenarioData'
import './scenario-compare.css'
import './scenarios-v2.css'

const SCREEN = 'scenarios'

/** Заменить адрес без записи истории и оповестить подписчиков (отметки сравнения, нормализация). */
function replaceAnchor(anchor: string): void {
  replaceRoute(SCREEN, anchor)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function ScenarioCompareScreen() {
  const data = useScenarioData()
  const refs = useRefs()
  const ctx = useDecisionContext()
  const { anchor } = useHashRoute()
  const route = parseScenarioAnchor(anchor)
  const ids = data.scenarios.map((s) => s.id)
  const workingId = workingIdOf(ctx.scenarioId, ids)
  const openId = resolveOpenId(route.id, ctx.scenarioId, ids)
  const open = data.scenarios.find((s) => s.id === openId) ?? null
  const lastOpen = useRef('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  if (!route.compare && openId) lastOpen.current = openId

  // Имя открытого сценария — в крошки оболочки; адрес без id дополняется id (F5 вернёт тот же вид).
  useEffect(() => { if (open) setCrumbTitle(SCREEN, open.id, open.name || 'Без названия') }, [open?.id, open?.name]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (route.compare || !openId || route.id === openId) return
    replaceAnchor(scenarioAnchor(openId, route.tab))
  }, [route.compare, route.id, route.tab, openId])

  const openScenario = (id: string) => navigateTo(SCREEN, scenarioAnchor(id, route.tab))
  const onTab = (tab: ScenarioTab) => navigateTo(SCREEN, scenarioAnchor(openId, tab))
  const setCompareMode = (on: boolean) => {
    if (on) navigateTo(SCREEN, compareAnchor(initialCompare(workingId, openId)))
    else navigateTo(SCREEN, scenarioAnchor(lastOpen.current || workingId))
  }
  const makeWorking = (id: string) => setDecisionContext({ scenarioId: id })
  const goNext = (screen: 'optimization' | 'plan', anchorPart?: string) => {
    if (!open) return
    setDecisionContext({ scenarioId: open.id })
    navigateTo(screen, anchorPart)
  }

  const clone = async () => {
    if (!open) return
    const id = await data.clone(open.id)
    if (id) openScenario(id)
  }
  const remove = async (id: string) => {
    const sc = data.scenarios.find((s) => s.id === id)
    setRemoveId(null)
    if (!sc || !(await data.remove(id))) return
    if (ctx.scenarioId === id) setDecisionContext({ scenarioId: undefined })
    if (route.compare) replaceAnchor(compareAnchor(route.ids.filter((x) => x !== id)))
    else if (openId === id) navigateTo(SCREEN)
    showUndo({
      message: `Сценарий «${sc.name || 'Без названия'}» удалён`,
      onUndo: () => { void data.restore(sc).then((nid) => { if (nid) openScenario(nid) }) },
    })
  }
  const createScenario = async (name: string, description: string, tpl: ScenarioTemplate | null) => {
    setCreating(true)
    const id = await data.create(name, description, tpl)
    setCreating(false)
    setCreateOpen(false)
    if (id) openScenario(id)
  }

  const removing = data.scenarios.find((s) => s.id === removeId) ?? null
  return (
    <div className="scn">
      <ScenarioList scenarios={data.scenarios} regimes={data.regimes} status={data.status} loadError={data.loadError}
        openId={openId} workingId={workingId} compareMode={route.compare} compareIds={route.ids} collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)} onOpen={openScenario}
        onToggleCompare={(id) => replaceAnchor(compareAnchor(toggleCompare(route.ids, id)))}
        onCompareMode={setCompareMode} onCreate={() => setCreateOpen(true)} onRetry={() => { void data.reload() }} />

      <main className="scn__main" aria-label={route.compare ? 'Сравнение сценариев' : 'Сценарий'}>
        {data.actionError && (
          <ErrorBanner title={data.actionError.title} error={data.actionError.error} detail={errorDetail(data.actionError.error)}
            onRetry={data.actionError.retry} onDismiss={data.dismissError} />
        )}
        {route.compare ? (
          <ScenarioCompare scenarios={data.scenarios} ids={route.ids} workingId={workingId} products={data.products}
            regimeNames={data.regimes?.regimes.map((r) => r.label) ?? []} onMakeWorking={makeWorking}
            onDrop={(id) => replaceAnchor(compareAnchor(route.ids.filter((x) => x !== id)))} />
        ) : open ? (
          <ScenarioTabs key={open.id} sc={open} tab={route.tab} products={data.products} productsFailed={data.productsFailed}
            saveStatus={data.saveStatus[open.id]} regimes={data.regimes} macro={refs.macro} isWorking={open.id === workingId}
            onTab={onTab} onPatch={data.patch} onSetDist={data.setDist} onSetDists={data.setDists}
            onMakeWorking={() => makeWorking(open.id)} onFindPortfolio={() => goNext('optimization')} onBuildPlan={() => goNext('plan', 'new')}
            onClone={() => { void clone() }} onRemove={() => setRemoveId(open.id)} />
        ) : data.status === 'loading' ? (
          <div className="sc2" aria-busy="true" aria-label="Загружаем сценарий">
            <Skeleton h={16} w="30%" /><Skeleton h={64} /><Skeleton h={48} /><Skeleton h={320} />
          </div>
        ) : data.status === 'ready' ? (
          <EmptyState kind="first-use" title="Сценариев пока нет"
            action={<button type="button" className="btn btn--primary" onClick={() => setCreateOpen(true)}>Создать сценарий</button>}>
            Сценарий — внешние условия: инфляция, курс, спрос, режим генератора ставки и распределения цен. Создайте его из шаблона.
          </EmptyState>
        ) : null}
      </main>

      {createOpen && (
        <ScenarioCreateDialog busy={creating} existing={data.scenarios.map((s) => s.name)} onSubmit={createScenario} onCancel={() => setCreateOpen(false)} />
      )}
      {removing && (
        <ConfirmDialog title="Удалить сценарий?" objectName={removing.name || 'Без названия'} confirmLabel="Удалить" danger
          consequence={<>Удалятся условия и распределения цен этого сценария. Портфели и планы, посчитанные под него, останутся в истории прогонов.{removing.id === workingId ? ' Это рабочий сценарий — Портфель и План переключатся на первый в списке.' : ''}</>}
          onConfirm={() => { void remove(removing.id) }} onCancel={() => setRemoveId(null)} />
      )}
    </div>
  )
}
