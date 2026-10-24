/**
 * Реестр сценариев (левая колонка экрана «Сценарии»): имя и пресет одной строкой («◆ Как 2022 · что если»,
 * «◆ Базовый · что если · изменено 2», «◆ Кризисный режим весь срок · что если» — до ~28 знаков, полный
 * режим — в подсказке),
 * «● рабочий» у сценария, с которым считают Портфель и План. Просмотр рабочий не меняет — для этого
 * в шапке есть «Сделать рабочим». «Сравнить» переводит список в режим отметок (2–5 сценариев).
 * Создание — тихая кнопка «Новый» (главное действие экрана — следующий шаг конвейера, в шапке).
 */
import type { MacroRegimes, PriceScenario } from '../../lib/api'
import { num, pct } from '../../explain/format'
import { objectiveLabel } from '../../explain/labels'
import { Icon } from '../../shell/icons'
import { ErrorBanner, IconButton, Skeleton } from '../../ui/kit'
import { scenarioViewOf } from './scenarioPresets'
import { effectiveScenario } from './scenarioDefaults'
import { MAX_COMPARE } from './scenarioRoute'
import type { LoadStatus } from './useScenarioData'

interface Props {
  scenarios: readonly PriceScenario[]
  regimes: MacroRegimes | null
  status: LoadStatus
  loadError: unknown
  openId: string
  workingId: string
  compareMode: boolean
  compareIds: readonly string[]
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpen: (id: string) => void
  onToggleCompare: (id: string) => void
  onCompareMode: (on: boolean) => void
  onCreate: () => void
  onRetry: () => void
}

export function ScenarioList({
  scenarios, regimes, status, loadError, openId, workingId, compareMode, compareIds, collapsed,
  onToggleCollapsed, onOpen, onToggleCompare, onCompareMode, onCreate, onRetry,
}: Props) {
  return (
    <aside className={`scn__side${collapsed ? ' is-collapsed' : ''}`} aria-label="Реестр сценариев">
      <div className="scn__side-top">
        <button type="button" className="btn btn--ghost btn--icon btn--sm scn__collapse" aria-expanded={!collapsed}
          title={collapsed ? 'Показать список сценариев' : 'Свернуть список'} aria-label={collapsed ? 'Показать список сценариев' : 'Свернуть список'}
          onClick={onToggleCollapsed}>
          <Icon name={collapsed ? 'expand' : 'minus'} size={14} />
        </button>
        <span className="scn__side-title">Сценарии</span>
        <IconButton icon="plus" variant="ghost" size="sm" title="Создать сценарий из пресета: Базовый, как в истории, стресс-тест" onClick={onCreate}>Новый</IconButton>
      </div>
      <div className="scn__cmpwrap">
        <IconButton icon="shuffle" size="sm" pressed={compareMode} title="Сравнить 2–5 сценариев бок о бок" onClick={() => onCompareMode(!compareMode)}>
          {compareMode ? `Сравнение · ${num(compareIds.length, 0)} из ${num(MAX_COMPARE, 0)}` : 'Сравнить'}
        </IconButton>
      </div>
      <div className="scn__list">
        {status === 'loading' && scenarios.length === 0 && (
          <div className="scn__skel" aria-label="Загружаем сценарии">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={44} />)}
          </div>
        )}
        {status === 'error' && (
          <ErrorBanner title="Список сценариев не загрузился" error={loadError} onRetry={onRetry} />
        )}
        {scenarios.length > 0 && (
          <ul className="scn__ul">
            {scenarios.map((sc) => (
              <li key={sc.id}>
                <ScenarioItem sc={sc} regimes={regimes} active={compareMode ? compareIds.includes(sc.id) : sc.id === openId}
                  working={sc.id === workingId} compareMode={compareMode} checked={compareIds.includes(sc.id)}
                  full={compareMode && compareIds.length >= MAX_COMPARE && !compareIds.includes(sc.id)}
                  onClick={() => (compareMode ? onToggleCompare(sc.id) : onOpen(sc.id))} />
              </li>
            ))}
          </ul>
        )}
        {status === 'ready' && scenarios.length === 0 && (
          <p className="scn__empty">Сценариев пока нет. «Новый» — создать из пресета.</p>
        )}
      </div>
    </aside>
  )
}

interface ItemProps {
  sc: PriceScenario
  regimes: MacroRegimes | null
  active: boolean
  working: boolean
  compareMode: boolean
  checked: boolean
  full: boolean
  onClick: () => void
}

function ScenarioItem({ sc, regimes, active, working, compareMode, checked, full, onClick }: ItemProps) {
  const eff = effectiveScenario(sc)
  const view = scenarioViewOf(sc, regimes?.regimes.map((r) => r.label) ?? [], { lastObs: regimes?.last_obs })
  const sub = `${view.glyph} ${view.short} · ${view.kind}${view.edits > 0 ? ` · изменено ${num(view.edits, 0)}` : ''}`
  const tip = `${sc.name} — ${view.name}${view.edits > 0 ? ` · изменено условий: ${num(view.edits, 0)}` : ''}; критерий ${objectiveLabel(eff.objective)}, хвост ${pct(eff.alpha, 0)}`
  return (
    <button type="button" className={`scn__item${active ? ' scn__item--active' : ''}`} onClick={onClick}
      aria-current={!compareMode && active ? 'true' : undefined} aria-pressed={compareMode ? checked : undefined}
      title={full ? `В сравнении уже ${num(MAX_COMPARE, 0)} сценариев — снимите отметку с одного` : tip}>
      {compareMode && <span className={`scn__check${checked ? ' scn__check--on' : ''}`} aria-hidden="true">{checked && <Icon name="check" size={12} />}</span>}
      <span className="scn__item-main">
        <span className="scn__item-name">{sc.name || 'Без названия'}</span>
        <span className="scn__item-sub">{sub}</span>
      </span>
      {working && <span className="scn__working" title="С этим сценарием считают Портфель и План">● рабочий</span>}
    </button>
  )
}
