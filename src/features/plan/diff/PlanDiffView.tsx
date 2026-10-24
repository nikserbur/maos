/**
 * Переключатель над Гантом (UX-V2 §4.8): «План» · «Диф» · «До» · «После» · «Маршрут» · «Таблица ходов».
 * Появляется, только когда есть настоящий пакет агента и решён хотя бы один ход (X2: пример и пустой
 * диф не выглядят результатом); пустые виды — одна строка, без оси дат и подсказок клавиш.
 * «После» строится на фронтенде из принятых/замороженных ходов (applyMoves), диф — diffSchedules.
 * Клавиатура на дифе (по физическим клавишам — работает и в русской раскладке): j/k — следующее /
 * предыдущее изменение, a — принять, x — отклонить, f — заморозить ход текущего изменения, Esc — снять.
 * Решения общие с панелью «Структурные ходы» (decisionsStore).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ScheduleResult } from '../../../lib/api'
import { num } from '../../../explain/format'
import { Legend, type LegendItem } from '../../../ui/charts'
import { Segmented, Switch, TabPanel, Tabs } from '../../../ui/kit'
import { buildPalette } from '../ganttModel'
import { parseIsoDate } from '../wizard/dates'
import { movesActions, useMovesSession } from '../moves/decisionsStore'
import { moveLabel } from '../moves/moveKinds'
import { statusOf } from '../moves/movesStore'
import type { MovesSource } from '../moves/movesSource'
import { MovesTable } from '../moves/MovesTable'
import { applyMoves } from './applyMoves'
import { diffRoutes, diffSchedules, stepChange } from './diffModel'
import { GanttDiff, type DiffMode } from './GanttDiff'
import { RouteDiff } from './RouteDiff'
import './diff.css'

export type PlanView = 'plan' | DiffMode | 'route' | 'table'

/** Разделы (другое содержимое) — вкладки; внутри «Изменений» — вид того же Ганта (до · различия · после) — переключатель. */
type PlanSection = 'plan' | 'changes' | 'route' | 'table'

const SECTIONS: ReadonlyArray<{ id: PlanSection; label: string }> = [
  { id: 'plan', label: 'План' }, { id: 'changes', label: 'Изменения' }, { id: 'route', label: 'Маршрут' }, { id: 'table', label: 'Таблица ходов' },
]

const DIFF_MODES: ReadonlyArray<{ id: DiffMode; label: string }> = [
  { id: 'before', label: 'До' }, { id: 'diff', label: 'Различия' }, { id: 'after', label: 'После' },
]

const DIFF_LEGEND: LegendItem[] = [
  { key: 'removed', label: 'удалено', color: 'var(--cinnabar)', swatchClass: 'gd-sw gd-sw--removed' },
  { key: 'added', label: 'добавлено', color: 'var(--verdigris)', swatchClass: 'gd-sw gd-sw--added' },
  { key: 'moved', label: 'перенесено (стрелка — откуда)', color: 'var(--ochre)', swatchClass: 'gd-sw gd-sw--moved' },
  { key: 'frozen', label: 'заморожено ■', color: 'var(--status-info)', swatchClass: 'gd-sw gd-sw--frozen' },
]

interface Props {
  result: ScheduleResult
  source: MovesSource
  startDate: string | null
  /** Обычный Гант (режим «План»). */
  plan: ReactNode
}

export function PlanDiffView({ result, source, startDate, plan }: Props) {
  const [view, setView] = useState<PlanView>('plan')
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  const session = useMovesSession(source.runKey)
  const boxRef = useRef<HTMLDivElement>(null)
  const moves = useMemo(() => source.moves?.moves ?? [], [source.moves])
  const after = useMemo(() => applyMoves(result, moves, (m) => statusOf(m, session.decisions)), [result, moves, session.decisions])
  const diff = useMemo(() => diffSchedules(result.gantt, after), [result.gantt, after])
  const routes = useMemo(() => diffRoutes(result.gantt, after), [result.gantt, after])
  const palette = useMemo(() => buildPalette(result.program, result.gantt), [result.program, result.gantt])
  const start = useMemo(() => parseIsoDate(startDate), [startDate])
  const name = (id: string) => { const m = moves.find((x) => x.id === id); return m ? moveLabel(m.kind) : id }

  // Выбор хода в панели → текущим становится первое его изменение на дифе.
  useEffect(() => {
    if (!session.selectedId) return
    const c = diff.changes.find((x) => x.moveId === session.selectedId)
    if (c) setCurrent(c.key)
  }, [session.selectedId, diff.changes])

  // Текущее изменение — в зону видимости (полоса помечена классом is-current).
  useEffect(() => {
    boxRef.current?.querySelector('.gd-bar.is-current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current, view])

  const decided = moves.some((m) => statusOf(m, session.decisions) !== 'proposed')
  if (!source.moves || moves.length === 0 || source.kind !== 'agent' || !decided) return <>{plan}</>

  const decideCurrent = (d: 'accept' | 'reject' | 'freeze') => {
    const c = diff.changes.find((x) => x.key === current)
    const id = c?.moveId ?? session.selectedId
    if (id) movesActions.decide(source.runKey, moves, id, d, d === 'reject' ? 'другое' : undefined)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const step = (dir: 1 | -1) => {
      const next = stepChange(diff.changes, current, dir)
      setCurrent(next)
      const mv = diff.changes.find((x) => x.key === next)?.moveId
      if (mv) movesActions.select(source.runKey, mv)
    }
    switch (e.code) {
      case 'KeyJ': step(1); break
      case 'KeyK': step(-1); break
      case 'KeyA': decideCurrent('accept'); break
      case 'KeyX': decideCurrent('reject'); break
      case 'KeyF': decideCurrent('freeze'); break
      case 'Escape': setCurrent(null); movesActions.select(source.runKey, null); break
      default: return
    }
    e.preventDefault()
  }
  const s = diff.summary
  const isGantt = view === 'diff' || view === 'before' || view === 'after'
  const section: PlanSection = isGantt ? 'changes' : (view as PlanSection)
  const pickSection = (id: PlanSection) => setView(id === 'changes' ? (isGantt ? view : 'diff') : id)
  const cur = diff.changes.findIndex((c) => c.key === current)

  return (
    <div className="pdv">
      <div className="pdv-tabs">
        <Tabs label="Разделы плана и ходов" size="panel" idBase="pdv" value={section} onChange={pickSection} items={SECTIONS} />
      </div>
      {view !== 'plan' && view !== 'table' && (
        <div className="pdv-bar">
          {isGantt && <Segmented label="Вид Ганта" size="sm" value={view as DiffMode} onChange={setView} options={DIFF_MODES} />}
          <span className="pdv-bar__sum num">
            перенесено {num(s.moved, 0)} · удалено {num(s.removed, 0)} · добавлено {num(s.added, 0)} · заморожено {num(s.frozen, 0)}
          </span>
          <Switch checked={showUnchanged} onChange={setShowUnchanged}>без изменений</Switch>
        </div>
      )}
      <TabPanel idBase="pdv" id={section}>
        {view === 'plan' && plan}
        {view !== 'plan' && (
          <div ref={boxRef} className="pdv-box" tabIndex={0} role="group" onKeyDown={onKey}
            aria-label="Изменения плана: j/k — следующее/предыдущее изменение, a — принять, x — отклонить, f — заморозить, Esc — снять выбор">
            {isGantt && diff.changes.length > 0 && <Legend items={DIFF_LEGEND} className="pdv-legend" />}
            {isGantt && <GanttDiff diff={diff} mode={view as DiffMode} palette={palette} start={start} showUnchanged={showUnchanged}
              currentKey={current} selectedMove={session.selectedId} moveName={name}
              onPick={(key, moveId) => { setCurrent(key); movesActions.select(source.runKey, moveId ?? null); boxRef.current?.focus({ preventScroll: true }) }} />}
            {view === 'route' && <RouteDiff rows={routes} showUnchanged={showUnchanged} />}
            {view === 'table' && <MovesTable moves={moves} decisions={session.decisions} gantt={result.gantt} rule={result.rule} demo={false} />}
            {view !== 'table' && diff.changes.length > 0 && (
              <p className="pdv-keys mono" aria-hidden="true">
                <kbd>j</kbd>/<kbd>k</kbd> изменение {cur >= 0 ? `${cur + 1} из ${diff.changes.length}` : `· ${diff.changes.length}`} · <kbd>a</kbd> принять · <kbd>x</kbd> отклонить · <kbd>f</kbd> заморозить · <kbd>Esc</kbd>
              </p>
            )}
          </div>
        )}
      </TabPanel>
    </div>
  )
}
