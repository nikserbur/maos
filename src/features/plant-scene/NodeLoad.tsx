/**
 * Блок «Загрузка по плану» в инспекторе (X2 P-27): шкала Meter с меткой 85 % (выше — ▲ «перегрузка»),
 * пик очереди, «Узкое место ▲», станки в ТО, и связь с соседними экранами — «Открыть в Плане →»,
 * «Карточка в Справочниках →». Без плана — «не рассчитано» и следующий шаг конвейера, а не ноль.
 */
import { Meter } from '../../ui/charts'
import { countText, pct } from '../../explain/format'
import type { SceneNode } from './graph/sceneModel'
import { OVERLOAD, planHref, planRef, queueText, type NodeOps, type OpsSource } from './sceneOps'
import { nsiHref } from './nsiLinks'

interface NodeLoadProps {
  node: SceneNode
  ops: NodeOps | undefined
  source: OpsSource | null
  /** История KPI не загрузилась. */
  unavailable: boolean
}

const MACHINE_FORMS = ['станок', 'станка', 'станков'] as const

export function NodeLoad({ node, ops, source, unavailable }: NodeLoadProps) {
  const util = ops?.util ?? null
  const container = node.refType !== 'machine'
  const nsi = nsiHref(node)
  return (
    <section className="ep-load" aria-label="Загрузка по плану">
      <div className="ep-load__head">
        <span className="ep-load__k text-caps">Загрузка</span>
        <span className="ep-load__src">
          {source ? planRef(source) : unavailable ? 'история планов недоступна' : 'плана ещё нет'}
        </span>
      </div>
      {util === null ? (
        <p className="ep-load__none">
          Не рассчитано{source && ops?.machines === 0 ? ' — в цехе нет станков' : source ? ' — тип оборудования не участвует в плане' : ''}.
        </p>
      ) : (
        <div className="ep-load__meter">
          <Meter value={util} max={Math.max(1, util)} mark={OVERLOAD} tone="neutral"
                 label={`Загрузка ${pct(util, 0)}; порог перегрузки ${pct(OVERLOAD, 0)}`} />
          <span className="ep-load__v num">{pct(util, 0)}</span>
          {util >= OVERLOAD && <span className="ep-load__flag glyph-setup">перегрузка</span>}
        </div>
      )}
      {util !== null && ops?.utilBy === 'type' && !container && (
        <p className="ep-load__note">по типу оборудования — загрузка станков этого типа в плане</p>
      )}
      <ul className="ep-load__facts">
        {ops?.queuePeak !== null && ops?.queuePeak !== undefined && <li>Очередь, {queueText(ops.queuePeak)}</li>}
        {ops?.bottleneck && <li className="glyph-setup">Узкое место{container ? ' внутри' : ''}</li>}
        {container && ops && ops.maintenance > 0 && <li className="glyph-setup">В ТО / ремонте {countText(ops.maintenance, MACHINE_FORMS)}</li>}
      </ul>
      <nav className="ep-links" aria-label="Связанные экраны">
        {source
          ? <a className="ep-link" href={planHref(source)}>Открыть в Плане →</a>
          : <a className="ep-link" href="#/plan/new">Построить план →</a>}
        {nsi && <a className="ep-link" href={nsi}>Карточка в Справочниках →</a>}
      </nav>
    </section>
  )
}
